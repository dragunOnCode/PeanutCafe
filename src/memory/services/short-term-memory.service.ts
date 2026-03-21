import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { MessageEntity } from '../../database/entities/message.entity';

export interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

@Injectable()
export class ShortTermMemoryService implements OnModuleDestroy {
  private readonly logger = new Logger(ShortTermMemoryService.name);
  private readonly redis: Redis;
  private readonly TTL_SECONDS: number;
  private readonly MAX_MESSAGES = 20;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
  ) {
    this.TTL_SECONDS = this.configService.get<number>('memory.redis.ttl') || 300;

    const host = this.configService.get<string>('redis.host') || 'localhost';
    const port = this.configService.get<number>('redis.port') || 6379;
    const password = this.configService.get<string>('redis.password');

    this.redis = new Redis({
      host,
      port,
      password: password || undefined,
    });

    this.redis.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private getKey(sessionId: string): string {
    return `memory:short:${sessionId}`;
  }

  async get(sessionId: string): Promise<MemoryEntry[]> {
    const key = this.getKey(sessionId);
    const data = await this.redis.get(key);

    if (data) {
      try {
        return JSON.parse(data) as MemoryEntry[];
      } catch {
        return [];
      }
    }

    return this.loadFromDatabase(sessionId);
  }

  private async loadFromDatabase(sessionId: string): Promise<MemoryEntry[]> {
    this.logger.log(`Cache miss for session ${sessionId}, loading from PostgreSQL`);

    const messages = await this.messageRepository.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
      take: this.MAX_MESSAGES,
    });

    const entries: MemoryEntry[] = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      agentId: msg.agentId || undefined,
      agentName: msg.agentName || undefined,
      timestamp: msg.createdAt.toISOString(),
    }));

    if (entries.length > 0) {
      await this.save(sessionId, entries);
    }

    return entries;
  }

  async save(sessionId: string, messages: MemoryEntry[]): Promise<void> {
    const key = this.getKey(sessionId);
    const recentMessages = messages.slice(-this.MAX_MESSAGES);
    await this.redis.setex(key, this.TTL_SECONDS, JSON.stringify(recentMessages));
  }

  async append(sessionId: string, entry: MemoryEntry): Promise<void> {
    const messages = await this.get(sessionId);
    messages.push(entry);
    await this.save(sessionId, messages);
  }

  async clear(sessionId: string): Promise<void> {
    const key = this.getKey(sessionId);
    await this.redis.del(key);
  }
}
