import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageRole } from '../entities/message.entity';

export interface SaveMessageParams {
  sessionId: string;
  userId?: string;
  agentId?: string;
  agentName?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mentionedAgents?: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class MessagePersistenceService {
  private readonly logger = new Logger(MessagePersistenceService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async save(params: SaveMessageParams): Promise<Message> {
    const message = this.messageRepo.create({
      sessionId: params.sessionId,
      userId: params.userId,
      agentId: params.agentId,
      agentName: params.agentName,
      role: params.role as MessageRole,
      content: params.content,
      mentionedAgents: params.mentionedAgents ?? [],
      metadata: params.metadata,
    });

    try {
      return await this.messageRepo.save(message);
    } catch (error) {
      this.logger.error(`Failed to save message: ${error.message}`);
      throw error;
    }
  }

  async getHistory(sessionId: string, limit: number = 50, offset: number = 0): Promise<Message[]> {
    return this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}