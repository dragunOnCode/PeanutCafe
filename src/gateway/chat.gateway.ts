import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';
import { AgentRouter } from './agent-router';
import { SendMessageDto } from './dto/send-message.dto';
import { ShortTermMemoryService, MemoryEntry } from '../memory/services/short-term-memory.service';
import { TranscriptService, TranscriptEntry } from '../workspace/services/transcript.service';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { MessagePersistenceService } from '../database/services/message-persistence.service';
import { AgentPriorityService } from '../agents/services/agent-priority.service';
import { ClaudeAdapter } from '../agents/adapters/claude.adapter';
import { CodexAdapter } from '../agents/adapters/codex.adapter';
import { GeminiAdapter } from '../agents/adapters/gemini.adapter';
import { AgentContext } from '../agents/interfaces/llm-adapter.interface';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly messageRouter: MessageRouter,
    private readonly agentRouter: AgentRouter,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly transcriptService: TranscriptService,
    private readonly workspaceService: WorkspaceService,
    private readonly messagePersistence: MessagePersistenceService,
    private readonly priorityService: AgentPriorityService,
    private readonly claudeAdapter: ClaudeAdapter,
    private readonly codexAdapter: CodexAdapter,
    private readonly geminiAdapter: GeminiAdapter,
  ) {}

  afterInit(): void {
    this.agentRouter.registerAgent(this.claudeAdapter);
    this.agentRouter.registerAgent(this.codexAdapter);
    this.agentRouter.registerAgent(this.geminiAdapter);

    this.priorityService.updateConfig({
      'claude-001': { basePriority: 100, quotaLimit: 100000 },
      'codex-001': { basePriority: 80, quotaLimit: 80000 },
      'gemini-001': { basePriority: 80, quotaLimit: 80000 },
    });

    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    const sessionId = client.handshake.query.sessionId as string;
    const userId = client.handshake.query.userId as string;

    if (!sessionId || !userId) {
      this.logger.warn(`客户端 ${client.id} 缺少 sessionId 或 userId，断开连接`);
      client.emit('error', { message: '缺少 sessionId 或 userId 参数' });
      client.disconnect();
      return;
    }

    void client.join(`session:${sessionId}`);
    this.sessionManager.addClient(sessionId, client);

    this.logger.log(`客户端连接: ${client.id} (User: ${userId}, Session: ${sessionId})`);

    client.emit('connection:established', {
      clientId: client.id,
      sessionId,
      userId,
      timestamp: new Date(),
    });

    this.server.to(`session:${sessionId}`).emit('user:joined', {
      userId,
      clientId: client.id,
      timestamp: new Date(),
    });
  }

  handleDisconnect(client: Socket) {
    const sessionId = this.sessionManager.removeClient(client.id);

    if (sessionId) {
      this.server.to(`session:${sessionId}`).emit('user:left', {
        clientId: client.id,
        timestamp: new Date(),
      });
    }

    this.logger.log(`客户端断开: ${client.id}`);
  }

  @SubscribeMessage('message:send')
  @UsePipes(new ValidationPipe({ transform: true }))
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendMessageDto,
  ): Promise<{ success: boolean; messageId: string }> {
    const userId = client.handshake.query.userId as string;
    const sessionId = data.sessionId;

    const parsed = this.messageRouter.parseMessage(data.content);
    const routeResult = this.agentRouter.route(parsed.mentionedAgents, data.content);

    const userMessage = {
      id: this.generateMessageId(),
      sessionId,
      userId,
      role: 'user' as const,
      content: data.content,
      mentionedAgents: parsed.mentionedAgents,
      timestamp: new Date(),
    };

    this.server.to(`session:${sessionId}`).emit('message:received', userMessage);

    await this.messagePersistence.save({
      sessionId,
      userId,
      role: 'user',
      content: data.content,
      mentionedAgents: parsed.mentionedAgents,
    });

    await this.shortTermMemory.append(sessionId, {
      role: 'user',
      content: data.content,
      timestamp: new Date().toISOString(),
    });

    await this.transcriptService.appendEntry(sessionId, {
      role: 'user',
      content: data.content,
      timestamp: new Date().toISOString(),
    });

    for (const agent of routeResult.targetAgents) {
      await this.handleAgentResponse(sessionId, agent, parsed.processedContent);
    }

    return { success: true, messageId: userMessage.id };
  }

  @SubscribeMessage('session:history')
  handleHistoryRequest(@ConnectedSocket() client: Socket, @MessageBody() data: { sessionId: string; limit?: number }) {
    // TODO: 集成数据库查询 (Task 8)
    client.emit('chat:history', {
      sessionId: data.sessionId,
      messages: [],
      total: 0,
    });
  }

  @SubscribeMessage('session:status')
  handleSessionStatus(@ConnectedSocket() client: Socket) {
    const sessions = this.sessionManager.getActiveSessions();
    client.emit('session:status', {
      activeSessions: sessions.length,
      activeClients: this.sessionManager.getActiveClientCount(),
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        clientCount: s.clients.size,
        createdAt: s.createdAt,
      })),
    });
  }

  private async handleAgentResponse(
    sessionId: string,
    agent: {
      id: string;
      name: string;
      generate: (prompt: string, context: AgentContext) => Promise<{ content: string; tokenUsage?: { total: number } }>;
    },
    prompt: string,
  ): Promise<void> {
    this.server.to(`session:${sessionId}`).emit('agent:thinking', {
      agentId: agent.id,
      agentName: agent.name,
      reason: 'Processing request',
      timestamp: new Date(),
    });

    try {
      const shortTermMemory = await this.shortTermMemory.get(sessionId);
      const conversationHistory = shortTermMemory.map((m, idx) => ({
        id: `msg_mem_${idx}`,
        sessionId,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        agentId: m.agentId,
        agentName: m.agentName,
        createdAt: new Date(m.timestamp),
      }));

      const context: AgentContext = {
        sessionId,
        conversationHistory,
      };

      const response = await agent.generate(prompt, context);

      if (response.tokenUsage?.total) {
        this.priorityService.recordUsage(agent.id, response.tokenUsage.total);
      }

      this.server.to(`session:${sessionId}`).emit('agent:stream', {
        agentId: agent.id,
        agentName: agent.name,
        delta: response.content,
        timestamp: new Date(),
      });

      this.server.to(`session:${sessionId}`).emit('agent:stream:end', {
        agentId: agent.id,
        agentName: agent.name,
        fullContent: response.content,
        timestamp: new Date(),
      });

      await this.messagePersistence.save({
        sessionId,
        agentId: agent.id,
        agentName: agent.name,
        role: 'assistant',
        content: response.content,
      });

      await this.shortTermMemory.append(sessionId, {
        role: 'assistant',
        content: response.content,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });

      await this.transcriptService.appendEntry(sessionId, {
        role: 'assistant',
        content: response.content,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.server.to(`session:${sessionId}`).emit('agent:error', {
        agentId: agent.id,
        agentName: agent.name,
        error: error.message,
        timestamp: new Date(),
      });
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
