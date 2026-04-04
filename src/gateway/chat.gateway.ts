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
import { DebugPromptDto } from './dto/debug-prompt.dto';
import { TranscriptService, TranscriptEntry } from '../workspace/services/transcript.service';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { MessageEntity } from '../database/entities/message.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { AgentPriorityService } from '../agents/services/agent-priority.service';
import { ClaudeAdapter } from '../agents/adapters/claude.adapter';
import { CodexAdapter } from '../agents/adapters/codex.adapter';
import { GeminiAdapter } from '../agents/adapters/gemini.adapter';
import { AgentContext } from '../agents/interfaces/llm-adapter.interface';
import { SessionDeletionQueue } from '../queue/session-deletion.queue';
import { SessionDeletionService } from '../session/session-deletion.service';
import { PromptTemplateService } from '../agents/prompts/prompt-template.service';
import { PromptBuilder } from '../agents/prompts/prompt-builder';
import { OrchestrationService } from '../orchestration/orchestration.service';
import { SessionContextService } from '../orchestration/context/session-context.service';
import { Message } from '../common/types/message.types';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly debugConversationHistory = new Map<string, Message[]>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly messageRouter: MessageRouter,
    private readonly agentRouter: AgentRouter,
    private readonly sessionContextService: SessionContextService,
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
    private readonly deletionService: SessionDeletionService,
    private readonly deletionQueue: SessionDeletionQueue,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly promptBuilder: PromptBuilder,
    private readonly orchestrationService: OrchestrationService,
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

  async handleConnection(client: Socket) {
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

    const sessionAgents = this.agentRouter.getAllAgents().map((a) => ({ name: a.name, role: a.role }));
    await this.promptTemplateService.initializeSessionPrompts(sessionId, sessionAgents);

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

    // 必须先 append 再写入 PostgreSQL：Redis 未命中时 shortTermMemory.get 会从 DB 拉取，
    // 若用户行已存在，append 会再 push 一次同一条，导致上下文里用户话重复。
    await this.sessionContextService.appendUserTurn(sessionId, {
      content: data.content,
    });

    const messageEntity = this.messageRepository.create({
      id: userMessage.id,
      sessionId,
      userId: null,
      role: 'user',
      content: data.content,
      mentionedAgents: parsed.mentionedAgents,
    });
    await this.messageRepository.save(messageEntity);

    await this.transcriptService.appendEntry(sessionId, {
      role: 'user',
      content: data.content,
      timestamp: new Date().toISOString(),
    });

    // 使用 OrchestrationService 执行多 Agent 工作流
    for await (const event of this.orchestrationService.streamExecute(
      sessionId,
      routeResult.processedContent,
      parsed.mentionedAgents,
    )) {
      // 将工作流事件通过 WebSocket 转发给前端
      const eventName = `workflow:${event.type}`;
      this.server.to(`session:${sessionId}`).emit(eventName, {
        sessionId,
        ...event,
      });

      // chunk：实时 delta（与 handleAgentResponse 对齐）
      if (event.type === 'chunk') {
        const streamAgent = this.agentRouter.getAgentByName(event.agentName);
        this.server.to(`session:${sessionId}`).emit('agent:stream', {
          agentId: streamAgent?.id,
          agentName: event.agentName,
          delta: event.delta,
          timestamp: new Date(),
        });
      }

      // 每个 Agent 单轮 run_task 结束后一条 end（Claude → Codex 会分别收到）
      // 同时在此处持久化到 DB 和 transcript，确保 handoff 中间轮次也能落盘
      if (event.type === 'agent_stream_end') {
        const endAgent = this.agentRouter.getAgentByName(event.agentName);
        this.server.to(`session:${sessionId}`).emit('agent:stream:end', {
          agentId: endAgent?.id,
          agentName: endAgent?.name ?? event.agentName,
          fullContent: event.fullContent,
          timestamp: new Date(),
        });
        await this.mirrorAssistantTurnToStorage(sessionId, event.fullContent, event.agentName);
      }

      // complete 事件：通知前端 workflow 结束（持久化已在 agent_stream_end 完成，无需重复写）
      if (event.type === 'complete') {
        // no-op: message already persisted in agent_stream_end
      }
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

  @SubscribeMessage('session:delete')
  async handleSessionDelete(@ConnectedSocket() client: Socket, @MessageBody() data: { sessionId: string }) {
    const { sessionId } = data;

    this.server.to(`session:${sessionId}`).emit('session:delete:started', { sessionId });

    try {
      await this.deletionService.deleteSession(sessionId);

      this.server.to(`session:${sessionId}`).emit('session:deleted', { sessionId });
      this.sessionManager.getSessionClients(sessionId).forEach((c) => c.disconnect());

      return { success: true };
    } catch (error) {
      await this.deletionQueue.add({ sessionId });

      this.server.to(`session:${sessionId}`).emit('session:delete:queued', {
        sessionId,
        message: 'Deletion queued for retry',
      });

      return { success: true, queued: true };
    }
  }

  /**
   * 调试接口：验证 system prompt 拼接是否正确，并支持多轮对话
   * 1. 构建 system prompt 并通过 debug:system-prompt 事件返回给客户端
   * 2. 维护会话历史，支持多轮对话测试 system prompt 效果
   */
  @SubscribeMessage('debug:prompt')
  async handleDebugPrompt(@ConnectedSocket() client: Socket, @MessageBody() dto: DebugPromptDto): Promise<void> {
    this.logger.log(`[DebugPrompt] sessionId=${dto.sessionId}, agentId=${dto.agentId}`);

    const agent = this.agentRouter.getAgentById(dto.agentId);
    if (!agent) {
      this.logger.warn(`[DebugPrompt] Unknown agent: ${dto.agentId}`);
      client.emit('agent:error', {
        agentId: dto.agentId,
        agentName: 'unknown',
        error: `Unknown agent: ${dto.agentId}`,
        timestamp: new Date(),
      });
      return;
    }

    await this.ensureSessionRow(dto.sessionId);

    const history = this.debugConversationHistory.get(dto.sessionId) ?? [];

    const userMessage: Message = {
      id: this.generateMessageId(),
      sessionId: dto.sessionId,
      role: 'user',
      content: dto.prompt,
      createdAt: new Date(),
    };
    history.push(userMessage);

    const context: AgentContext = {
      sessionId: dto.sessionId,
      conversationHistory: history,
    };

    const messages = await this.promptBuilder.buildMessages(
      {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        role: agent.role,
        capabilities: agent.capabilities,
        model: agent.model,
      },
      context as any,
    );

    const systemPrompt = messages[0].content;
    this.logger.debug(`[DebugPrompt] System prompt built, content=${systemPrompt}`);
    client.emit('debug:system-prompt', {
      agentId: agent.id,
      systemPrompt,
    });

    this.server.to(`session:${dto.sessionId}`).emit('agent:thinking', {
      agentId: agent.id,
      agentName: agent.name,
      reason: 'Processing request',
      timestamp: new Date(),
    });

    try {
      let fullContent = '';
      for await (const chunk of agent.streamGenerate(dto.prompt, context)) {
        fullContent += chunk;
        this.server.to(`session:${dto.sessionId}`).emit('agent:stream', {
          agentId: agent.id,
          agentName: agent.name,
          delta: chunk,
          timestamp: new Date(),
        });
      }

      this.server.to(`session:${dto.sessionId}`).emit('agent:stream:end', {
        agentId: agent.id,
        agentName: agent.name,
        fullContent,
        timestamp: new Date(),
      });

      const assistantMessage: Message = {
        id: this.generateMessageId(),
        sessionId: dto.sessionId,
        role: 'assistant',
        content: fullContent,
        agentId: agent.id,
        agentName: agent.name,
        createdAt: new Date(),
      };
      history.push(assistantMessage);
      this.debugConversationHistory.set(dto.sessionId, history);

      this.logger.log(`[DebugPrompt] LLM response received, length=${fullContent.length}`);
    } catch (error) {
      this.logger.error(`[DebugPrompt] LLM调用失败: ${error instanceof Error ? error.message : String(error)}`);
      this.server.to(`session:${dto.sessionId}`).emit('agent:error', {
        agentId: agent.id,
        agentName: agent.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      });
    }
  }

  private async handleAgentResponse(
    sessionId: string,
    agent: {
      id: string;
      name: string;
      streamGenerate: (prompt: string, context: AgentContext) => AsyncGenerator<string>;
    },
  ): Promise<void> {
    this.server.to(`session:${sessionId}`).emit('agent:thinking', {
      agentId: agent.id,
      agentName: agent.name,
      reason: 'Processing request',
      timestamp: new Date(),
    });

    try {
      const sessionContext = await this.sessionContextService.getContext(sessionId);
      const conversationHistory = sessionContext.turns.map((turn, idx) => ({
        id: turn.id || `msg_mem_${idx}`,
        sessionId,
        role: turn.role,
        content: turn.content,
        agentId: turn.agentId,
        agentName: turn.agentName,
        createdAt: turn.createdAt,
      }));

      const context: AgentContext = {
        sessionId,
        conversationHistory,
      };

      let fullContent = '';
      for await (const chunk of agent.streamGenerate('', context)) {
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

      await this.sessionContextService.appendAssistantTurn(sessionId, {
        content: fullContent,
        agentId: agent.id,
        agentName: agent.name,
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

  /**
   * 将 Orchestration 路径产生的 assistant 回复持久化到 PostgreSQL 和 transcript。
   * conversationHistory 的写入已在 run_task 节点完成，此处只补 DB 存储。
   */
  private async mirrorAssistantTurnToStorage(sessionId: string, content: string, agentName: string): Promise<void> {
    if (!content.trim()) return;

    const agent = this.agentRouter.getAgentByName(agentName);

    await this.ensureSessionRow(sessionId);

    const entity = this.messageRepository.create({
      sessionId,
      userId: null,
      agentId: agent?.id,
      agentName,
      role: 'assistant',
      content,
    });
    await this.messageRepository.save(entity);

    await this.transcriptService.appendEntry(sessionId, {
      role: 'assistant',
      content,
      agentId: agent?.id,
      agentName,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`[ChatGateway] Mirrored assistant message: agentName=${agentName}, length=${content.length}`);
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
