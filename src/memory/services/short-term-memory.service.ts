import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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
  private readonly TTL_SECONDS = 300;
  private readonly MAX_MESSAGES = 20;

  constructor(private readonly configService: ConfigService) {
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

  async save(sessionId: string, messages: MemoryEntry[]): Promise<void> {
    const key = this.getKey(sessionId);
    const recentMessages = messages.slice(-this.MAX_MESSAGES);

    await this.redis.setex(key, this.TTL_SECONDS, JSON.stringify(recentMessages));
  }

  async get(sessionId: string): Promise<MemoryEntry[]> {
    const key = this.getKey(sessionId);
    const data = await this.redis.get(key);

    if (!data) {
      return [];
    }

    try {
      return JSON.parse(data) as MemoryEntry[];
    } catch {
      return [];
    }
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
