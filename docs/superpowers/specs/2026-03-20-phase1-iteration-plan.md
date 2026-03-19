# Phase 1 迭代计划设计

> 版本：v1.0.0  
> 日期：2026-03-20  
> 状态：已批准

---

## 目标

实现多 Agent 聊天室的基础聊天功能，包括：

- @mention 驱动的 Agent 选择机制
- 动态优先级调度（预留配额感知能力）
- 短期记忆（Redis）+ 长期记忆（PostgreSQL）
- Workspace 状态管理 + JSONL 对话记录

---

## 核心流程

```
用户发消息 → Gateway 接收 → 解析 @mention
  ├─ 有 @ → 指定 Agent 响应
  └─ 无 @ → 按优先级选择 Agent

Agent 响应 → Redis 短期记忆 → JSONL 记录 → 落数据库 → 推送前端
```

---

## 组件设计

### 1. ChatGateway

**职责**：消息路由、事件推送、WebSocket 连接管理

**Socket 事件**：

- `message:send` → 接收用户消息
- `message:received` → 推送消息给前端
- `agent:thinking` → Agent 正在思考
- `agent:stream` → Agent 流式响应
- `agent:stream:end` → Agent 响应结束
- `agent:error` → Agent 错误
- `agent:skip` → Agent 跳过

### 2. AgentRouter

**职责**：@mention 解析 + Agent 选择

**选择逻辑**：

```typescript
function selectAgents(mentioned: string[], allAgents: Agent[], context: RouteContext): Agent[] {
  // 1. 有 @mention，按 @ 选择
  if (mentioned.length > 0) {
    return allAgents.filter((a) => mentioned.includes(a.name));
  }

  // 2. 无 @，按优先级选择
  return selectByPriority(allAgents);
}

function selectByPriority(agents: Agent[]): Agent[] {
  // 动态计算优先级：basePriority - quotaUsedToday
  // 选优先级最高的
  return agents.sort((a, b) => b.dynamicPriority - a.dynamicPriority).slice(0, 1);
}
```

### 3. AgentAdapters

**职责**：OpenRouter API 调用

**实现**：

- `ClaudeAdapter` - OpenRouter HTTP
- `CodexAdapter` - OpenRouter HTTP
- `GeminiAdapter` - OpenRouter HTTP

**接口**：

```typescript
interface ILLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly callType: 'http';

  generate(prompt: string, context: AgentContext): Promise<AgentResponse>;
  streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string>;
  healthCheck(): Promise<boolean>;
  getStatus(): AgentStatus;
}
```

### 4. ShortTermMemory (Redis)

**职责**：短期记忆（5分钟 TTL）

**Redis Key**：

- `memory:short:{sessionId}` - 最近 20 条消息

```typescript
interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}
```

### 5. WorkspaceService

**职责**：Workspace 状态管理

**目录结构**：

```
workspace/
└── sessions/
    └── {sessionId}/
        ├── code/           # 代码文件
        ├── docs/           # 文档
        ├── tasks.md        # 任务列表
        └── transcript.jsonl # 对话记录（每行一轮）
```

**transcript.jsonl 格式**：

```jsonl
{"role":"user","content":"@Claude 设计一个登录系统","timestamp":"2026-03-20T10:00:00Z"}
{"role":"assistant","agentId":"claude-001","agentName":"Claude","content":"我来设计...","timestamp":"2026-03-20T10:00:01Z"}
```

### 6. MessagePersistence (PostgreSQL)

**职责**：长期记忆持久化

**Entity**：

```typescript
@Entity()
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  agentId: string;

  @Column({ nullable: true })
  agentName: string;

  @Column({ type: 'enum', enum: ['user', 'assistant', 'system'] })
  role: string;

  @Column('text')
  content: string;

  @Column('text', { array: true, default: [] })
  mentionedAgents: string[];

  @CreateDateColumn()
  createdAt: Date;
}
```

### 7. AgentPriorityService

**职责**：动态优先级管理（预留）

```typescript
interface AgentPriority {
  agentId: string;
  basePriority: number; // 基础优先级（配置文件）
  quotaUsedToday: number; // 今日已用配额
  quotaLimit: number; // 每日配额上限
  dynamicPriority: number; // 计算后优先级
}

interface PriorityConfig {
  [agentId: string]: {
    basePriority: number;
    quotaLimit: number;
  };
}
```

**优先级计算**：

```typescript
function calculateDynamicPriority(priority: AgentPriority): number {
  const quotaRatio = priority.quotaUsedToday / priority.quotaLimit;
  // 配额用得越多，优先级越低
  return priority.basePriority * (1 - quotaRatio * 0.5);
}
```

---

## 验收标准

| ID   | 标准                              | 验证方式                                 |
| ---- | --------------------------------- | ---------------------------------------- |
| P1-1 | `@Claude xxx` → Claude 响应       | 发送消息测试                             |
| P1-2 | `@Claude @Codex xxx` → 两者都响应 | 发送消息测试                             |
| P1-3 | 无 @ → 优先级最高的 Agent 响应    | 观察日志                                 |
| P1-4 | Redis 中有短期记忆（5分钟TTL）    | `redis-cli get memory:short:{sessionId}` |
| P1-5 | JSONL 文件每行一轮对话            | 检查文件内容                             |
| P1-6 | PostgreSQL 有持久化消息           | 数据库查询                               |

---

## 实现顺序

### Step 1: 基础设施

1. 创建 `agents.config.json` 配置文件
2. 实现 `AgentPriorityService`（预留动态优先级）
3. 实现 `AgentConfigService`（从 JSON 加载配置）

### Step 2: Agent 调用

1. 实现 `ClaudeAdapter`（HTTP OpenRouter）
2. 实现 `CodexAdapter`（HTTP OpenRouter）
3. 实现 `GeminiAdapter`（HTTP OpenRouter）
4. 实现 `AgentRouter`（@解析 + 优先级选择）

### Step 3: 记忆层

1. 实现 `ShortTermMemoryService`（Redis）
2. 实现 `WorkspaceService`（JSONL + 文件管理）
3. 实现 `MessagePersistenceService`（PostgreSQL）

### Step 4: Gateway 集成

1. 修改 `ChatGateway.handleMessage()` 集成 AgentRouter
2. 集成 AgentAdapters 生成响应
3. 集成记忆层（写 Redis、JSONL、DB）
4. 实现流式推送（agent:stream、agent:stream:end）

---

## 文件结构

```
src/
├── agents/
│   ├── agents.module.ts
│   ├── interfaces/
│   │   └── llm-adapter.interface.ts
│   ├── adapters/
│   │   ├── claude.adapter.ts
│   │   ├── codex.adapter.ts
│   │   └── gemini.adapter.ts
│   └── services/
│       ├── agent-config.service.ts
│       └── agent-priority.service.ts
├── gateway/
│   ├── gateway.module.ts
│   ├── chat.gateway.ts
│   ├── session.manager.ts
│   └── message.router.ts
├── memory/
│   ├── memory.module.ts
│   └── services/
│       └── short-term-memory.service.ts
├── workspace/
│   ├── workspace.module.ts
│   └── services/
│       ├── workspace.service.ts
│       └── transcript.service.ts
├── database/
│   ├── database.module.ts
│   └── entities/
│       └── message.entity.ts
└── common/
    └── types/
        └── index.ts
```

---

## 下一步

Phase 1 实现完成后，进入 Phase 2：集成 LangGraph 实现 ReAct/Plan-And-Execute 框架。
