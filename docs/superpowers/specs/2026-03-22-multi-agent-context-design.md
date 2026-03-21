# Multi-Agent 对话历史增强设计

> 版本：v1.0.0  
> 日期：2026-03-22  
> 状态：草稿

---

## 1. 目标

解决后端重启后 AgentContext 上下文丢失的问题，实现基于 Cache-Aside 模式的历史对话恢复机制，支持 Multi-Agent 协作系统的复杂上下文工程需求。

---

## 2. 问题分析

### 现状

1. **Redis 短期记忆**：5 分钟 TTL，仅存储最近 20 条消息
2. **PostgreSQL 持久化**：所有消息已持久化，但重启后未加载
3. **上下文丢失**：后端重启或 Redis TTL 过期后，Agent 无法获取历史上下文

### 根因

`ChatGateway.handleAgentResponse()` 构建 `AgentContext.conversationHistory` 时，仅从 Redis 读取，未实现缓存回源逻辑。

---

## 3. 设计方案

### 3.1 架构分层

```
┌─────────────────────────────────────────────────────┐
│                    ChatGateway                        │
│  - 消息路由、事件推送、WebSocket 管理                │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│           ConversationHistoryService                  │
│  - 对话历史编排                                     │
│  - 上下文加载策略                                  │
│  - 多 Agent 上下文隔离                             │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│             ShortTermMemoryService                   │
│  - Redis 缓存管理                                  │
│  - Cache-Aside 模式实现                           │
│  - TTL 管理                                        │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│              PostgreSQL (MessageEntity)             │
│  - 持久化存储                                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 ShortTermMemoryService 改动

#### 现有接口（不变）

```typescript
interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

class ShortTermMemoryService {
  async get(sessionId: string): Promise<MemoryEntry[]>;
  async append(sessionId: string, entry: MemoryEntry): Promise<void>;
  async save(sessionId: string, entries: MemoryEntry[]): Promise<void>;
  async clear(sessionId: string): Promise<void>;
}
```

#### 新增注入依赖

```typescript
constructor(
  private readonly configService: ConfigService,
  private readonly messageRepository: Repository<MessageEntity>,  // 新增
) {}
```

#### 内部逻辑改动

```
get(sessionId)
  ↓
查 Redis
  ↓
命中 → 返回
  ↓ 未命中
查 PostgreSQL (messageRepository.find)
  ↓
构建 MemoryEntry[]
  ↓
写回 Redis (TTL 刷新)
  ↓
返回
```

#### 配置项

| 配置键               | 默认值 | 说明                       |
| -------------------- | ------ | -------------------------- |
| `memory.redis.ttl`   | 300    | Redis TTL（秒）            |
| `memory.max.history` | 6      | 单次加载的最大历史消息条数 |

### 3.3 ConversationHistoryService 新建

#### 职责

- 管理多轮对话的结构化上下文
- 支持不同 Agent 看到不同的历史视图
- 提供对话摘要、上下文窗口管理等扩展能力

#### 接口设计

```typescript
interface ConversationContext {
  sessionId: string;
  messages: MemoryEntry[];
  summarizedUntil?: Date;
}

@Injectable()
export class ConversationHistoryService {
  constructor(
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly configService: ConfigService,
  ) {}

  async getContext(sessionId: string, agentId?: string): Promise<ConversationContext>;

  async append(sessionId: string, entry: MemoryEntry): Promise<void>;

  async summarize(sessionId: string, until: Date): Promise<void>;
}
```

#### getContext 逻辑

```
输入：sessionId, agentId (可选)
  ↓
从 ShortTermMemoryService 获取 MemoryEntry[]
  ↓
根据配置 memory.max.history 截取
  ↓
构建 ConversationContext 返回
```

### 3.4 ChatGateway 改动

#### 改动点

1. 注入 `ConversationHistoryService`
2. `handleAgentResponse` 中调用 `conversationHistoryService.getContext(sessionId)`
3. 移除直接调用 `shortTermMemory.get(sessionId)` 的逻辑

#### 改动前

```typescript
const shortTermMemory = await this.shortTermMemory.get(sessionId);
const conversationHistory = shortTermMemory.map(...);
```

#### 改动后

```typescript
const historyContext = await this.conversationHistoryService.getContext(sessionId, agent.id);
const conversationHistory = historyContext.messages.map(...);
```

---

## 4. 数据流

```
用户消息 → ChatGateway.handleMessage()
    ↓
MessageRouter.parseMessage() 解析 @mention
    ↓
AgentRouter.route() 确定目标 Agent
    ↓
For each Agent:
    ↓
ConversationHistoryService.getContext(sessionId, agent.id)
    ↓
ShortTermMemoryService.get(sessionId)
    ↓ (Redis miss)
    查询 PostgreSQL MessageEntity
    ↓
ShortTermMemoryService.append() 写回 Redis
    ↓
构建 AgentContext 返回
    ↓
Agent 生成响应
    ↓
ConversationHistoryService.append() 记录新消息
```

---

## 5. 错误处理

### Redis 不可用

- 降级：跳过 Redis，直接查 PG
- 日志警告：记录 Redis 连接失败

### PG 不可用

- 抛出异常：消息持久化失败应该阻断流程
- 不降级到 Redis：避免数据丢失

---

## 6. 配置项汇总

| 配置键               | 默认值    | 说明                       |
| -------------------- | --------- | -------------------------- |
| `memory.redis.ttl`   | 300       | Redis TTL（秒）            |
| `memory.max.history` | 6         | 单次加载的最大历史消息条数 |
| `redis.host`         | localhost | Redis 主机                 |
| `redis.port`         | 6379      | Redis 端口                 |
| `redis.password`     | -         | Redis 密码（可选）         |

---

## 7. 测试策略

### ShortTermMemoryService

- Redis hit 场景
- Redis miss + PG 回源场景
- TTL 刷新验证
- 并发 append 场景

### ConversationHistoryService

- getContext 正常场景
- getContext 带 agentId 过滤场景
- max.history 截断验证
- append 正常场景

### ChatGateway

- 集成测试：后端重启后发送消息，验证上下文恢复

---

## 8. 文件清单

### 新建

- `src/memory/services/conversation-history.service.ts`
- `src/memory/services/conversation-history.service.spec.ts`

### 修改

- `src/memory/memory.module.ts` - 导入 ConversationHistoryService
- `src/memory/services/short-term-memory.service.ts` - 注入 MessageRepository
- `src/gateway/chat.gateway.ts` - 使用 ConversationHistoryService

### 删除

无

---

## 9. 下一步

Phase 1 完成后再进行 Phase 2：上下文压缩与摘要功能。
