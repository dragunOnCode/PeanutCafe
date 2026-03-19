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
import { SendMessageDto } from './dto/send-message.dto';

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
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway 初始化完成');
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
  handleMessage(@ConnectedSocket() client: Socket, @MessageBody() data: SendMessageDto) {
    const userId = client.handshake.query.userId as string;

    this.logger.log(`收到消息 [Session: ${data.sessionId}] [User: ${userId}]: ${data.content.substring(0, 50)}...`);

    const parsed = this.messageRouter.parseMessage(data.content);
    const routeResult = this.messageRouter.route(parsed);

    const userMessage = {
      id: this.generateMessageId(),
      sessionId: data.sessionId,
      userId,
      role: 'user' as const,
      content: data.content,
      mentionedAgents: parsed.mentionedAgents,
      timestamp: new Date(),
    };

    if (routeResult.shouldBroadcast) {
      this.server.to(`session:${data.sessionId}`).emit('message:received', userMessage);
    }

    // TODO: 集成数据库持久化 (Task 8)
    // TODO: 集成 Agent 响应 (Task 7)

    if (routeResult.targetAgentIds.length > 0) {
      this.handleAgentResponse(data.sessionId, routeResult);
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

  private handleAgentResponse(sessionId: string, routeResult: { targetAgentIds: string[]; processedContent: string }) {
    for (const agentId of routeResult.targetAgentIds) {
      this.server.to(`session:${sessionId}`).emit('agent:typing', {
        agentId,
        timestamp: new Date(),
      });

      // MVP 占位: 后续 Task 7 接入真实 Agent
      const mockResponse = {
        id: this.generateMessageId(),
        sessionId,
        agentId,
        agentName: this.getAgentName(agentId),
        role: 'assistant' as const,
        content: `[${this.getAgentName(agentId)}] 收到您的消息。Agent 响应功能将在后续任务中实现。`,
        timestamp: new Date(),
      };

      this.server.to(`session:${sessionId}`).emit('message:received', mockResponse);

      this.server.to(`session:${sessionId}`).emit('agent:done', {
        agentId,
        timestamp: new Date(),
      });
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private getAgentName(agentId: string): string {
    const nameMap: Record<string, string> = {
      'claude-001': 'Claude',
      'codex-001': 'Codex',
      'gemini-001': 'Gemini',
    };
    return nameMap[agentId] || agentId;
  }
}
