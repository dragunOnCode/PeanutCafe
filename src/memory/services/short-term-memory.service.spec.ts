import { ShortTermMemoryService, MemoryEntry } from './short-term-memory.service';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { MessageEntity } from '../../database/entities/message.entity';
import Redis from 'ioredis';

jest.mock('ioredis', () => {
  const RedisMock = jest.requireActual('ioredis-mock');
  return RedisMock;
});

describe('ShortTermMemoryService', () => {
  let service: ShortTermMemoryService;
  let redis: InstanceType<typeof Redis>;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        'redis.host': 'localhost',
        'redis.port': 6379,
        'redis.password': undefined,
        'memory.redis.ttl': 300,
      };
      return config[key];
    }),
  };

  const mockMessageRepository = {
    find: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    service = new ShortTermMemoryService(
      mockConfigService as unknown as ConfigService,
      mockMessageRepository as unknown as Repository<MessageEntity>,
    );
    redis = (service as any).redis;
    await redis.flushall();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('save and get', () => {
    it('should store and retrieve messages', async () => {
      const sessionId = 'test-session-1';
      const messages: MemoryEntry[] = [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
        { role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:00:01.000Z' },
      ];

      await service.save(sessionId, messages);
      const retrieved = await service.get(sessionId);

      expect(retrieved).toEqual(messages);
    });

    it('should return empty array for non-existent session', async () => {
      const result = await service.get('non-existent-session');
      expect(result).toEqual([]);
    });
  });

  describe('append', () => {
    it('should add message to existing list', async () => {
      const sessionId = 'test-session-2';
      const initialMessages: MemoryEntry[] = [
        { role: 'user', content: 'First message', timestamp: '2024-01-01T00:00:00.000Z' },
      ];

      await service.save(sessionId, initialMessages);

      const newEntry: MemoryEntry = {
        role: 'assistant',
        content: 'Response',
        timestamp: '2024-01-01T00:00:01.000Z',
      };

      await service.append(sessionId, newEntry);

      const retrieved = await service.get(sessionId);
      expect(retrieved).toHaveLength(2);
      expect(retrieved[1]).toEqual(newEntry);
    });
  });

  describe('clear', () => {
    it('should delete memory', async () => {
      const sessionId = 'test-session-3';
      const messages: MemoryEntry[] = [{ role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' }];

      await service.save(sessionId, messages);
      await service.clear(sessionId);

      const result = await service.get(sessionId);
      expect(result).toEqual([]);
    });
  });

  describe('MAX_MESSAGES limit', () => {
    it('should only keep last 20 messages', async () => {
      const sessionId = 'test-session-4';
      const messages: MemoryEntry[] = [];

      for (let i = 0; i < 25; i++) {
        messages.push({
          role: 'user',
          content: `Message ${i}`,
          timestamp: new Date(i * 1000).toISOString(),
        });
      }

      await service.save(sessionId, messages);
      const retrieved = await service.get(sessionId);

      expect(retrieved).toHaveLength(20);
      expect(retrieved[0].content).toBe('Message 5');
      expect(retrieved[19].content).toBe('Message 24');
    });
  });

  describe('TTL behavior', () => {
    it('should set TTL of 5 minutes (300 seconds) on save', async () => {
      const sessionId = 'test-session-5';
      const messages: MemoryEntry[] = [{ role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' }];

      await service.save(sessionId, messages);

      const ttl = await redis.ttl(`memory:short:${sessionId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    });
  });

  describe('cache-aside pattern', () => {
    it('should load from database on cache miss', async () => {
      mockMessageRepository.find.mockResolvedValue([
        {
          role: 'user',
          content: 'Hello',
          agentId: null,
          agentName: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.get('test-session');

      expect(mockMessageRepository.find).toHaveBeenCalledWith({
        where: { sessionId: 'test-session' },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello');
    });

    it('should not query database on cache hit', async () => {
      const cachedData = [{ role: 'user', content: 'Cached', timestamp: '2024-01-01T00:00:00Z' }];
      await redis.set('memory:short:test-session', JSON.stringify(cachedData));

      const result = await service.get('test-session');

      expect(mockMessageRepository.find).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should populate cache after loading from database', async () => {
      const dbMessages = [
        {
          role: 'user',
          content: 'From DB',
          agentId: null,
          agentName: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ];
      mockMessageRepository.find.mockResolvedValue(dbMessages);

      await service.get('test-session');

      const cached = await redis.get('memory:short:test-session');
      expect(cached).toBeTruthy();
      const parsed = JSON.parse(cached as string);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe('From DB');
    });
  });
});
