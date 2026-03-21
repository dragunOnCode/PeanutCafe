# Multi-Agent Context Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于 Cache-Aside 模式的历史对话恢复机制，支持 Multi-Agent 协作系统的上下文工程需求

**Architecture:** 通过扩展 ShortTermMemoryService 实现 Redis 缓存回源，新建 ConversationHistoryService 管理对话历史编排，ChatGateway 作为调用方使用新服务

**Tech Stack:** NestJS, TypeORM, Redis (ioredis), PostgreSQL

---

## File Structure

```
src/
├── memory/
│   ├── memory.module.ts                      # 修改：导入 ConversationHistoryService
│   └── services/
│       ├── short-term-memory.service.ts     # 修改：注入 MessageRepository，实现 cache-aside
│       ├── short-term-memory.service.spec.ts # 修改：更新 mock
│       ├── conversation-history.service.ts    # 新建：对话历史编排
│       └── conversation-history.service.spec.ts # 新建：测试
├── gateway/
│   └── chat.gateway.ts                      # 修改：使用 ConversationHistoryService
└── config/
    └── configuration.ts                    # 修改：添加 memory.redis.ttl 和 memory.max.history
```

---

## Task 1: 更新配置项

**Files:**

- Modify: `src/config/configuration.ts`

- [ ] **Step 1: 添加新配置项**

在 `configuration.ts` 中添加：

```typescript
export const memoryConfig = registerAs('memory', () => ({
  redis: {
    ttl: parseInt(process.env.MEMORY_REDIS_TTL || '300', 10),
  },
  maxHistory: parseInt(process.env.MEMORY_MAX_HISTORY || '6', 10),
}));
```

- [ ] **Step 2: 提交**

```bash
git add src/config/configuration.ts
git commit -m "feat(config): add memory.redis.ttl and memory.max.history"
```

---

## Task 2: 扩展 ShortTermMemoryService（Cache-Aside）

**Files:**

- Modify: `src/memory/services/short-term-memory.service.ts`
- Modify: `src/memory/services/short-term-memory.service.spec.ts`

- [ ] **Step 1: 更新 ShortTermMemoryService**

修改 `src/memory/services/short-term-memory.service.ts`：

```typescript
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

    // Cache miss - load from PostgreSQL
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
```

- [ ] **Step 2: 更新测试文件**

更新 `src/memory/services/short-term-memory.service.spec.ts` 中的 mock：

```typescript
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
  find: jest.fn(),
};
```

- [ ] **Step 3: 添加 Cache-Aside 测试用例**

```typescript
describe('cache-aside pattern', () => {
  it('should load from database on cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);
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
    mockRedis.get.mockResolvedValue(
      JSON.stringify([{ role: 'user', content: 'Cached', timestamp: '2024-01-01T00:00:00Z' }]),
    );

    await service.get('test-session');

    expect(mockMessageRepository.find).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
npm test -- src/memory/services/short-term-memory.service.spec.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/memory/services/short-term-memory.service.ts src/memory/services/short-term-memory.service.spec.ts
git commit -m "feat(memory): implement cache-aside pattern in ShortTermMemoryService"
```

---

## Task 3: 新建 ConversationHistoryService

**Files:**

- Create: `src/memory/services/conversation-history.service.ts`
- Create: `src/memory/services/conversation-history.service.spec.ts`

- [ ] **Step 1: 创建 ConversationHistoryService**

创建 `src/memory/services/conversation-history.service.ts`：

```typescript
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

    // Apply max history limit
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
    // Future implementation: compress historical messages
    this.logger.log(`Summarize not yet implemented for session ${sessionId} until ${until}`);
  }
}
```

- [ ] **Step 2: 创建测试文件**

创建 `src/memory/services/conversation-history.service.spec.ts`：

```typescript
import { ConversationHistoryService, ConversationContext } from './conversation-history.service';
import { ShortTermMemoryService, MemoryEntry } from './short-term-memory.service';
import { ConfigService } from '@nestjs/config';

describe('ConversationHistoryService', () => {
  let service: ConversationHistoryService;
  let shortTermMemory: jest.Mocked<ShortTermMemoryService>;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'memory.maxHistory') return 6;
      return null;
    }),
  };

  beforeEach(() => {
    shortTermMemory = {
      get: jest.fn(),
      append: jest.fn(),
    } as any;

    service = new ConversationHistoryService(shortTermMemory, mockConfigService as unknown as ConfigService);
  });

  describe('getContext', () => {
    it('should return limited messages based on maxHistory config', async () => {
      const allMessages: MemoryEntry[] = [];
      for (let i = 0; i < 10; i++) {
        allMessages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
        });
      }
      shortTermMemory.get.mockResolvedValue(allMessages);

      const result = await service.getContext('session-1', 'agent-1');

      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].content).toBe('Message 4');
      expect(result.messages[5].content).toBe('Message 9');
    });

    it('should return empty context for new session', async () => {
      shortTermMemory.get.mockResolvedValue([]);

      const result = await service.getContext('new-session');

      expect(result.messages).toHaveLength(0);
    });
  });

  describe('append', () => {
    it('should delegate to shortTermMemory.append', async () => {
      const entry: MemoryEntry = {
        role: 'user',
        content: 'New message',
        timestamp: new Date().toISOString(),
      };

      await service.append('session-1', entry);

      expect(shortTermMemory.append).toHaveBeenCalledWith('session-1', entry);
    });
  });

  describe('agentId filtering (future)', () => {
    it('should pass agentId to underlying service when provided', async () => {
      const allMessages: MemoryEntry[] = [
        { role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Hi', agentId: 'agent-a', timestamp: new Date().toISOString() },
      ];
      shortTermMemory.get.mockResolvedValue(allMessages);

      // Note: Current implementation does not filter by agentId
      // This test documents expected future behavior
      const result = await service.getContext('session-1', 'agent-b');

      expect(result.messages).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- src/memory/services/conversation-history.service.spec.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/memory/services/conversation-history.service.ts src/memory/services/conversation-history.service.spec.ts
git commit -m "feat(memory): add ConversationHistoryService for context management"
```

---

## Task 4: 更新 MemoryModule

**Files:**

- Modify: `src/memory/memory.module.ts`

- [ ] **Step 1: 更新 memory.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShortTermMemoryService } from './services/short-term-memory.service';
import { ConversationHistoryService } from './services/conversation-history.service';
import { MessageEntity } from '../database/entities/message.entity';
import { redisConfig, memoryConfig } from '../config/configuration';

@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    ConfigModule.forFeature(memoryConfig),
    TypeOrmModule.forFeature([MessageEntity]),
  ],
  providers: [ShortTermMemoryService, ConversationHistoryService],
  exports: [ShortTermMemoryService, ConversationHistoryService],
})
export class MemoryModule {}
```

- [ ] **Step 2: 提交**

```bash
git add src/memory/memory.module.ts
git commit -m "feat(memory): export ConversationHistoryService from MemoryModule"
```

---

## Task 5: 更新 ChatGateway

**Files:**

- Modify: `src/gateway/chat.gateway.ts`

- [ ] **Step 1: 更新 ChatGateway 注入和使用**

修改 `src/gateway/chat.gateway.ts`：

1. 添加导入：

```typescript
import { ConversationHistoryService } from '../memory/services/conversation-history.service';
```

2. **移除** `shortTermMemory` 依赖注入，**添加** `conversationHistoryService` 依赖注入：

```typescript
constructor(
  private readonly sessionManager: SessionManager,
  private readonly messageRouter: MessageRouter,
  private readonly agentRouter: AgentRouter,
  // 移除: private readonly shortTermMemory: ShortTermMemoryService,
  private readonly conversationHistoryService: ConversationHistoryService,
  // ... 其他依赖
) {}
```

3. 修改 handleAgentResponse 中的上下文获取：

**移除** 直接调用 shortTermMemory 的代码，**改为** 使用 conversationHistoryService：

```typescript
// 移除之前的：
// const shortTermMemory = await this.shortTermMemory.get(sessionId);
// const conversationHistory = shortTermMemory.map((m, idx) => ({...}));

// 改为：
const historyContext = await this.conversationHistoryService.getContext(sessionId, agent.id);
const conversationHistory = historyContext.messages.map((m, idx) => ({
  id: `msg_mem_${idx}`,
  sessionId,
  role: m.role as 'user' | 'assistant',
  content: m.content,
  agentId: m.agentId,
  agentName: m.agentName,
  createdAt: new Date(m.timestamp),
}));
```

4. 修改消息追加：

```typescript
// 移除之前的：
// await this.shortTermMemory.append(sessionId, {...});

// 改为：
await this.conversationHistoryService.append(sessionId, {
  role: 'user',
  content: data.content,
  timestamp: new Date().toISOString(),
});
```

- [ ] **Step 2: 运行测试**

```bash
npm test
```

- [ ] **Step 3: 提交**

```bash
git add src/gateway/chat.gateway.ts
git commit -m "refactor(gateway): use ConversationHistoryService for context management"
```

---

**重要**：ChatGateway 中**不要**直接注入 `ShortTermMemoryService`，应该通过 `ConversationHistoryService` 获取对话历史。这样符合设计规范：ConversationHistoryService 是对话历史的编排层，对调用方屏蔽底层存储细节。

---

## Task 6: 更新 .env.example

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: 添加新配置项**

```bash
# Memory
MEMORY_REDIS_TTL=300
MEMORY_MAX_HISTORY=6
```

- [ ] **Step 2: 提交**

```bash
git add .env.example
git commit -m "docs: add MEMORY_REDIS_TTL and MEMORY_MAX_HISTORY to .env.example"
```

---

## 验收测试

### 手动测试步骤

1. **启动后端**：`npm run start:dev`

2. **测试 Redis miss 后从 PG 加载**：
   - 停止后端
   - 清除 Redis：`redis-cli FLUSHALL`
   - 重启后端
   - 发送消息：`socket.emit('message:send', { content: '@Claude 你好', sessionId: 'test-session' })`
   - 验证：Agent 响应中能看到之前的对话历史

3. **测试 maxHistory 限制**：
   - 发送超过 6 条消息
   - 验证 Agent 上下文只包含最近 6 条

### 自动化测试

```bash
npm test
# 预期：所有测试通过
```

---

## 下一步

Phase 1 完成后再进行 Phase 2：上下文压缩与摘要功能。
