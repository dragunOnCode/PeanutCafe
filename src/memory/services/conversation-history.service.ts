import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShortTermMemoryService, MemoryEntry } from './short-term-memory.service';

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
  ) {
    this.maxHistory = this.configService.get<number>('memory.maxHistory') || 6;
  }

  async getContext(sessionId: string, agentId?: string): Promise<ConversationContext> {
    const messages = await this.shortTermMemory.get(sessionId);

    const limitedMessages = messages.slice(-this.maxHistory);

    this.logger.debug(
      `Context for session ${sessionId}, agent ${agentId}: ${limitedMessages.length} messages (of ${messages.length} total)`,
    );

    return {
      sessionId,
      messages: limitedMessages,
    };
  }

  async append(sessionId: string, entry: MemoryEntry): Promise<void> {
    await this.shortTermMemory.append(sessionId, entry);
  }

  async summarize(sessionId: string, until: Date): Promise<void> {
    this.logger.log(`Summarize not yet implemented for session ${sessionId} until ${until}`);
  }
}