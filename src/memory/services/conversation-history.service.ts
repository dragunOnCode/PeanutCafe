import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShortTermMemoryService, MemoryEntry } from './short-term-memory.service';
import { SessionContextService } from '../../orchestration/context/session-context.service';

const MAX_HISTORY_SIZE = 10;

export interface ConversationContext {
  sessionId: string;
  messages: MemoryEntry[];
  summarizedUntil?: Date;
}

@Injectable()
export class ConversationHistoryService {
  private readonly logger = new Logger(ConversationHistoryService.name);
  private readonly maxHistory: number;

  constructor(
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly configService: ConfigService,
    private readonly sessionContextService: SessionContextService,
  ) {
    this.maxHistory = this.configService.get<number>('memory.maxHistory') || MAX_HISTORY_SIZE;
  }

  async getContext(sessionId: string, agentId?: string): Promise<ConversationContext> {
    const context = await this.sessionContextService.getContext(sessionId);
    const limitedMessages = context.turns.slice(-this.maxHistory).map((turn) => ({
      role: turn.role,
      content: turn.content,
      agentId: turn.agentId,
      agentName: turn.agentName,
      timestamp: turn.createdAt.toISOString(),
    }));

    this.logger.debug(
      `Context for session ${sessionId}, agent ${agentId}: ${limitedMessages.length} messages (of ${context.turns.length} total)`,
    );

    return {
      sessionId,
      messages: limitedMessages,
    };
  }

  async append(sessionId: string, entry: MemoryEntry): Promise<void> {
    if (entry.role === 'assistant') {
      await this.sessionContextService.appendAssistantTurn(sessionId, {
        content: entry.content,
        agentId: entry.agentId,
        agentName: entry.agentName,
        createdAt: new Date(entry.timestamp),
      });
      return;
    }

    if (entry.role === 'system') {
      await this.sessionContextService.appendHandoffSummary(sessionId, {
        content: entry.content,
        agentId: entry.agentId,
        agentName: entry.agentName,
        createdAt: new Date(entry.timestamp),
      });
      return;
    }

    await this.sessionContextService.appendUserTurn(sessionId, {
      content: entry.content,
      agentId: entry.agentId,
      agentName: entry.agentName,
      createdAt: new Date(entry.timestamp),
    });
  }

  summarize(sessionId: string, until: Date): Promise<void> {
    this.logger.log(`Summarize not yet implemented for session ${sessionId} until ${until.toISOString()}`);
    return Promise.resolve();
  }
}
