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
import { Logger, UsePipes, ValidationPipe, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';
import { AgentRouter } from './agent-router';
import { SendMessageDto } from './dto/send-message.dto';
import { ShortTermMemoryService, MemoryEntry } from '../memory/services/short-term-memory.service';
import { TranscriptService, TranscriptEntry } from '../workspace/services/transcript.service';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { MessageEntity } from '../database/entities/message.entity';
import { SessionEntity } from '../database/entities/session.entity';
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
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
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
    const userId = (client.handshake.query.userId as string | undefined) ?? null;

    if (!sessionId) {
      this.logger.warn(`客户端 ${client.id} 缺少 sessionId，断开连接`);
      client.emit('error', { message: '缺少 sessionId 参数' });
      client.disconnect();
      return;
    }

    void client.join(`session:${sessionId}`);
    this.sessionManager.addClient(sessionId, client);

    this.logger.log(`客户端连接: ${client.id} (User: ${userId ?? '—'}, Session: ${sessionId})`);

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
    const userId = (client.handshake.query.userId as string | undefined) ?? null;
    const sessionId = data.sessionId.trim();

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

    await this.ensureSessionRow(sessionId);

    const messageEntity = this.messageRepository.create({
      id: userMessage.id,
      sessionId,
      userId: null,
      role: 'user',
      content: data.content,
      mentionedAgents: parsed.mentionedAgents,
    });
    await this.messageRepository.save(messageEntity);

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
    const messages = this.messageRepository.find({
      where: { sessionId: data.sessionId },
      order: { createdAt: 'DESC' },
      take: data.limit || 50,
    });
    void messages.then((msgs) => {
      client.emit('chat:history', {
        sessionId: data.sessionId,
        messages: msgs.reverse(),
        total: msgs.length,
      });
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
      streamGenerate: (prompt: string, context: AgentContext) => AsyncGenerator<string>;
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

      let fullContent = '';
      for await (const chunk of agent.streamGenerate(prompt, context)) {
        fullContent += chunk;
        this.server.to(`session:${sessionId}`).emit('agent:stream', {
          agentId: agent.id,
          agentName: agent.name,
          delta: chunk,
          timestamp: new Date(),
        });
      }

      this.server.to(`session:${sessionId}`).emit('agent:stream:end', {
        agentId: agent.id,
        agentName: agent.name,
        fullContent,
        timestamp: new Date(),
      });

      if (!fullContent.trim()) {
        return;
      }

      const estimatedUsage = this.estimateStreamTokenUsage(fullContent);
      if (estimatedUsage > 0) {
        this.priorityService.recordUsage(agent.id, estimatedUsage);
      }

      await this.ensureSessionRow(sessionId);

      const messageEntity = this.messageRepository.create({
        sessionId,
        userId: null,
        agentId: agent.id,
        agentName: agent.name,
        role: 'assistant',
        content: fullContent,
      });
      await this.messageRepository.save(messageEntity);

      await this.shortTermMemory.append(sessionId, {
        role: 'assistant',
        content: fullContent,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });

      await this.transcriptService.appendEntry(sessionId, {
        role: 'assistant',
        content: fullContent,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.server.to(`session:${sessionId}`).emit('agent:error', {
        agentId: agent.id,
        agentName: agent.name,
        error: this.getErrorMessage(error),
        timestamp: new Date(),
      });
    }
  }

  private estimateStreamTokenUsage(content: string): number {
    const normalized = content.trim();
    if (!normalized) {
      return 0;
    }

    // Streaming adapters do not expose token usage, so use a simple character-based estimate.
    return Math.ceil(normalized.length / 4);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    if (error === null || error === undefined) {
      return 'Unknown error';
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  /** 调试对话：不依赖 users 表；messages.user_id 存 null。并确保 sessions 存在以满足 session 外键。 */
  private async ensureSessionRow(sessionId: string): Promise<void> {
    const exists = await this.sessionRepository.exist({ where: { id: sessionId } });
    if (exists) return;
    await this.sessionRepository.save(
      this.sessionRepository.create({
        id: sessionId,
        title: 'Conversation',
        ownerId: null,
        participants: [],
        status: 'active',
      }),
    );
  }

  private generateMessageId(): string {
    return randomUUID();
  }
}
