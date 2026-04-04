import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ShortTermMemoryService, type MemoryEntry } from '../../memory/services/short-term-memory.service';
import { type SessionContext, type SessionTurn, type SessionTurnKind } from './session-context.types';

const MAX_HISTORY_SIZE = 10;

export interface AppendTurnInput {
  content: string;
  agentId?: string;
  agentName?: string;
  createdAt?: Date;
}

@Injectable()
export class SessionContextService {
  private readonly maxHistory: number;

  constructor(
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly configService: ConfigService,
  ) {
    this.maxHistory = this.configService.get<number>('memory.maxHistory') || MAX_HISTORY_SIZE;
  }

  async getContext(sessionId: string): Promise<SessionContext> {
    const entries = await this.shortTermMemory.get(sessionId);
    const turns = entries.slice(-this.maxHistory).map((entry) => this.toSessionTurn(sessionId, entry));

    return {
      sessionId,
      turns,
    };
  }

  async appendUserTurn(sessionId: string, input: AppendTurnInput): Promise<SessionTurn> {
    return this.appendTurn(sessionId, 'user', 'user', input);
  }

  async appendAssistantTurn(sessionId: string, input: AppendTurnInput): Promise<SessionTurn> {
    return this.appendTurn(sessionId, 'assistant', 'assistant', input);
  }

  async appendHandoffSummary(sessionId: string, input: AppendTurnInput): Promise<SessionTurn> {
    return this.appendTurn(sessionId, 'system', 'handoff_summary', input);
  }

  private async appendTurn(
    sessionId: string,
    role: MemoryEntry['role'],
    kind: SessionTurnKind,
    input: AppendTurnInput,
  ): Promise<SessionTurn> {
    const createdAt = input.createdAt ?? new Date();
    const entry: MemoryEntry = {
      role,
      content: input.content,
      agentId: input.agentId,
      agentName: input.agentName,
      timestamp: createdAt.toISOString(),
    };

    await this.shortTermMemory.append(sessionId, entry);

    return {
      id: randomUUID(),
      sessionId,
      role,
      kind,
      content: input.content,
      agentId: input.agentId,
      agentName: input.agentName,
      createdAt,
    };
  }

  private toSessionTurn(sessionId: string, entry: MemoryEntry): SessionTurn {
    return {
      id: randomUUID(),
      sessionId,
      role: entry.role,
      kind: this.toTurnKind(entry),
      content: entry.content,
      agentId: entry.agentId,
      agentName: entry.agentName,
      createdAt: new Date(entry.timestamp),
    };
  }

  private toTurnKind(entry: MemoryEntry): SessionTurnKind {
    if (entry.role === 'system') {
      return 'handoff_summary';
    }

    return entry.role;
  }
}
