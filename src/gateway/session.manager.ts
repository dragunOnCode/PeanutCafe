import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';

export interface SessionInfo {
  sessionId: string;
  clients: Set<string>;
  createdAt: Date;
}

@Injectable()
export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);

  private sessions: Map<string, SessionInfo> = new Map();
  private clients: Map<string, Socket> = new Map();
  private clientSessionMap: Map<string, string> = new Map();

  addClient(sessionId: string, client: Socket): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        clients: new Set(),
        createdAt: new Date(),
      });
    }

    const session = this.sessions.get(sessionId)!;
    session.clients.add(client.id);
    this.clients.set(client.id, client);
    this.clientSessionMap.set(client.id, sessionId);

    this.logger.log(`会话 ${sessionId} 当前成员数: ${session.clients.size}`);
  }

  removeClient(clientId: string): string | undefined {
    const sessionId = this.clientSessionMap.get(clientId);
    if (!sessionId) return undefined;

    const session = this.sessions.get(sessionId);
    if (session) {
      session.clients.delete(clientId);
      if (session.clients.size === 0) {
        this.sessions.delete(sessionId);
        this.logger.log(`会话 ${sessionId} 已无成员，已清理`);
      }
    }

    this.clients.delete(clientId);
    this.clientSessionMap.delete(clientId);

    return sessionId;
  }

  getSessionClients(sessionId: string): Socket[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return Array.from(session.clients)
      .map((id) => this.clients.get(id))
      .filter(Boolean) as Socket[];
  }

  getClientSessionId(clientId: string): string | undefined {
    return this.clientSessionMap.get(clientId);
  }

  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  getActiveClientCount(): number {
    return this.clients.size;
  }

  broadcastToSession(sessionId: string, event: string, data: unknown): void {
    const clients = this.getSessionClients(sessionId);
    clients.forEach((client) => {
      client.emit(event, data);
    });
  }

  isClientInSession(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.clients.has(clientId) ?? false;
  }
}
