# Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现多 Agent 聊天室基础聊天功能，包括 @mention 驱动选择、动态优先级、记忆管理和持久化

**Architecture:** 采用 Hub-and-Spoke 架构，ChatGateway 作为中心协调者，通过 AgentRouter 分发消息给各个 Agent Adapter。记忆层分为 Redis 短期记忆和 PostgreSQL 长期记忆，WorkspaceService 负责 JSONL 记录和文件状态管理。

**Tech Stack:** NestJS, Socket.io, Redis, PostgreSQL, TypeORM, OpenRouter API

---

## File Structure

```
src/
├── agents/
│   ├── agents.module.ts                    # Agent 模块入口
│   ├── interfaces/
│   │   └── llm-adapter.interface.ts       # LLM 适配器接口（已存在）
│   ├── adapters/
│   │   ├── claude.adapter.ts              # Claude HTTP 适配器
│   │   ├── codex.adapter.ts                # Codex HTTP 适配器
│   │   └── gemini.adapter.ts              # Gemini HTTP 适配器
│   └── services/
│       ├── agent-config.service.ts         # Agent 配置加载（已存在）
│       └── agent-priority.service.ts       # 动态优先级服务
├── gateway/
│   ├── gateway.module.ts                   # Gateway 模块入口
│   ├── chat.gateway.ts                    # WebSocket 网关（修改）
│   ├── session.manager.ts                  # 会话管理（已存在）
│   └── message.router.ts                  # 消息路由（修改）
├── memory/
│   ├── memory.module.ts                    # Memory 模块入口
│   └── services/
│       └── short-term-memory.service.ts    # Redis 短期记忆
├── workspace/
│   ├── workspace.module.ts                # Workspace 模块入口
│   └── services/
│       ├── workspace.service.ts           # Workspace 状态管理
│       └── transcript.service.ts          # JSONL 对话记录
├── database/
│   ├── database.module.ts                  # Database 模块入口
│   └── entities/
│       └── message.entity.ts              # Message 实体
└── common/
    └── types/
        └── index.ts                       # 公共类型（已存在）
```

---

## Task 1: AgentPriorityService 实现

**Files:**

- Create: `src/agents/services/agent-priority.service.ts`
- Modify: `src/agents/agents.module.ts` (import AgentPriorityService)
- Test: `src/agents/services/agent-priority.service.spec.ts`

- [ ] **Step 1: 创建 AgentPriorityService**

```typescript
// src/agents/services/agent-priority.service.ts
import { Injectable } from '@nestjs/common';

export interface AgentPriority {
  agentId: string;
  basePriority: number;
  quotaUsedToday: number;
  quotaLimit: number;
  dynamicPriority: number;
}

export interface PriorityConfig {
  [agentId: string]: {
    basePriority: number;
    quotaLimit: number;
  };
}

@Injectable()
export class AgentPriorityService {
  private priorities: Map<string, AgentPriority> = new Map();
  private config: PriorityConfig = {};

  updateConfig(config: PriorityConfig): void {
    this.config = config;
    for (const [agentId, cfg] of Object.entries(config)) {
      const existing = this.priorities.get(agentId);
      this.priorities.set(agentId, {
        agentId,
        basePriority: cfg.basePriority,
        quotaUsedToday: existing?.quotaUsedToday ?? 0,
        quotaLimit: cfg.quotaLimit,
        dynamicPriority: this.calculateDynamicPriority(cfg.basePriority, existing?.quotaUsedToday ?? 0, cfg.quotaLimit),
      });
    }
  }

  private calculateDynamicPriority(basePriority: number, quotaUsed: number, quotaLimit: number): number {
    const quotaRatio = quotaLimit > 0 ? quotaUsed / quotaLimit : 0;
    return basePriority * (1 - quotaRatio * 0.5);
  }

  recordUsage(agentId: string, tokens: number): void {
    const priority = this.priorities.get(agentId);
    if (priority) {
      priority.quotaUsedToday += tokens;
      priority.dynamicPriority = this.calculateDynamicPriority(
        priority.basePriority,
        priority.quotaUsedToday,
        priority.quotaLimit,
      );
    }
  }

  getDynamicPriority(agentId: string): number {
    return this.priorities.get(agentId)?.dynamicPriority ?? 0;
  }

  getAllPriorities(): AgentPriority[] {
    return Array.from(this.priorities.values());
  }

  selectByPriority(agentIds: string[]): string {
    const candidates = agentIds
      .map((id) => ({
        id,
        priority: this.getDynamicPriority(id),
      }))
      .sort((a, b) => b.priority - a.priority);

    return candidates[0]?.id ?? '';
  }
}
```

- [ ] **Step 2: 更新 agents.module.ts 导出 AgentPriorityService**

```typescript
// src/agents/agents.module.ts
import { Module } from '@nestjs/common';
import { AgentConfigService } from './services/agent-config.service';
import { AgentPriorityService } from './services/agent-priority.service';

@Module({
  providers: [AgentConfigService, AgentPriorityService],
  exports: [AgentConfigService, AgentPriorityService],
})
export class AgentsModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/services/agent-priority.service.ts src/agents/agents.module.ts
git commit -m "feat(agents): add AgentPriorityService for dynamic priority"
```

---

## Task 2: AgentAdapters 实现

**Files:**

- Create: `src/agents/adapters/claude.adapter.ts`
- Create: `src/agents/adapters/codex.adapter.ts`
- Create: `src/agents/adapters/gemini.adapter.ts`
- Modify: `src/agents/interfaces/llm-adapter.interface.ts` (更新 callType)
- Test: `src/agents/adapters/*.spec.ts`

- [ ] **Step 1: 更新 ILLMAdapter 接口**

```typescript
// src/agents/interfaces/llm-adapter.interface.ts
export interface ILLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly type: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly callType: 'http'; // 移除 'cli' 选项

  generate(prompt: string, context: AgentContext): Promise<AgentResponse>;
  streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string>;
  shouldRespond?(message: Message, context: AgentContext): Promise<DecisionResult>;
  healthCheck(): Promise<boolean>;
  getStatus(): AgentStatus;
}
```

- [ ] **Step 2: 创建 ClaudeAdapter**

```typescript
// src/agents/adapters/claude.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ILLMAdapter, AgentContext, AgentResponse, AgentStatus } from '../interfaces/llm-adapter.interface';

@Injectable()
export class ClaudeAdapter implements ILLMAdapter {
  private readonly logger = new Logger(ClaudeAdapter.name);

  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'anthropic/claude-3-sonnet';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private apiKey: string;
  private apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);

      const response = await firstValueFrom(
        this.httpService.post(
          this.apiUrl,
          {
            model: this.model,
            messages,
            temperature: 0.7,
            max_tokens: 4000,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://lobster.com',
              'X-Title': 'Lobster Coding Assistant',
            },
          },
        ),
      );

      const content = response.data.choices?.[0]?.message?.content ?? '';
      const usage = response.data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      return {
        content,
        tokenUsage: {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Claude generate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
  }

  async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    // 流式实现后续补充
    const response = await this.generate(prompt, context);
    yield response.content;
  }

  async healthCheck(): Promise<boolean> {
    return this.status !== AgentStatus.ERROR;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildMessages(prompt: string, context: AgentContext): Array<{ role: string; content: string }> {
    const systemPrompt = `你是 Claude，一个专业的软件架构师和编码专家。
你的职责是：
1. 设计系统架构
2. 编写高质量代码
3. 提供技术选型建议
4. 进行代码重构`;

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];

    if (context.conversationHistory?.length) {
      const recentMessages = context.conversationHistory.slice(-10);
      for (const msg of recentMessages) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    messages.push({ role: 'user', content: prompt });
    return messages;
  }
}
```

- [ ] **Step 3: 创建 CodexAdapter**

```typescript
// src/agents/adapters/codex.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ILLMAdapter, AgentContext, AgentResponse, AgentStatus } from '../interfaces/llm-adapter.interface';

@Injectable()
export class CodexAdapter implements ILLMAdapter {
  private readonly logger = new Logger(CodexAdapter.name);

  readonly id = 'codex-001';
  readonly name = 'Codex';
  readonly model = 'codex';
  readonly type = 'codex';
  readonly role = '代码审查与质量把控';
  readonly capabilities = ['代码审查', '测试建议', '性能优化', '安全检测'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private apiKey: string;
  private apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);

      const response = await firstValueFrom(
        this.httpService.post(
          this.apiUrl,
          {
            model: this.model,
            messages,
            temperature: 0.7,
            max_tokens: 4000,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const content = response.data.choices?.[0]?.message?.content ?? '';

      return {
        content,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Codex generate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
  }

  async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    const response = await this.generate(prompt, context);
    yield response.content;
  }

  async healthCheck(): Promise<boolean> {
    return this.status !== AgentStatus.ERROR;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildMessages(prompt: string, context: AgentContext): Array<{ role: string; content: string }> {
    const systemPrompt = `你是 Codex，一个专业的代码审查专家。
你的职责是：
1. 审查代码质量
2. 发现潜在问题
3. 提供优化建议
4. 确保代码安全`;

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];

    if (context.conversationHistory?.length) {
      const recentMessages = context.conversationHistory.slice(-10);
      for (const msg of recentMessages) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    messages.push({ role: 'user', content: prompt });
    return messages;
  }
}
```

- [ ] **Step 4: 创建 GeminiAdapter**

```typescript
// src/agents/adapters/gemini.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ILLMAdapter, AgentContext, AgentResponse, AgentStatus } from '../interfaces/llm-adapter.interface';

@Injectable()
export class GeminiAdapter implements ILLMAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);

  readonly id = 'gemini-001';
  readonly name = 'Gemini';
  readonly model = 'gemini-2.0-flash-thinking';
  readonly type = 'gemini';
  readonly role = '创意发散与视觉设计';
  readonly capabilities = ['创意建议', 'UI/UX设计', '视觉方案', '用户体验'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private apiKey: string;
  private apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.GEMINI_API_KEY || '';
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);

      const response = await firstValueFrom(
        this.httpService.post(
          this.apiUrl,
          {
            model: this.model,
            messages,
            temperature: 0.8,
            max_tokens: 4000,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const content = response.data.choices?.[0]?.message?.content ?? '';

      return {
        content,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Gemini generate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
  }

  async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    const response = await this.generate(prompt, context);
    yield response.content;
  }

  async healthCheck(): Promise<boolean> {
    return this.status !== AgentStatus.ERROR;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildMessages(prompt: string, context: AgentContext): Array<{ role: string; content: string }> {
    const systemPrompt = `你是 Gemini，一个富有创意的设计师和产品顾问。
你的职责是：
1. 提供创意建议
2. 设计UI/UX方案
3. 优化用户体验
4. 提出产品改进方向`;

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];

    if (context.conversationHistory?.length) {
      const recentMessages = context.conversationHistory.slice(-10);
      for (const msg of recentMessages) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    messages.push({ role: 'user', content: prompt });
    return messages;
  }
}
```

- [ ] **Step 5: 更新 agents.module.ts**

```typescript
// src/agents/agents.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AgentConfigService } from './services/agent-config.service';
import { AgentPriorityService } from './services/agent-priority.service';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';

@Module({
  imports: [HttpModule],
  providers: [AgentConfigService, AgentPriorityService, ClaudeAdapter, CodexAdapter, GeminiAdapter],
  exports: [AgentConfigService, AgentPriorityService, ClaudeAdapter, CodexAdapter, GeminiAdapter],
})
export class AgentsModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/agents/adapters/ src/agents/interfaces/llm-adapter.interface.ts src/agents/agents.module.ts
git commit -m "feat(agents): implement HTTP adapters for Claude, Codex, Gemini"
```

---

## Task 3: AgentRouter 实现

**Files:**

- Create: `src/gateway/agent-router.ts`
- Modify: `src/gateway/gateway.module.ts` (import AgentsModule)
- Test: `src/gateway/agent-router.spec.ts`

- [ ] **Step 1: 创建 AgentRouter**

```typescript
// src/gateway/agent-router.ts
import { Injectable, Logger } from '@nestjs/common';
import { ILLMAdapter } from '../agents/interfaces/llm-adapter.interface';
import { AgentPriorityService } from '../agents/services/agent-priority.service';

export interface RouteResult {
  targetAgents: ILLMAdapter[];
  processedContent: string;
}

@Injectable()
export class AgentRouter {
  private readonly logger = new Logger(AgentRouter.name);

  private agents: Map<string, ILLMAdapter> = new Map();
  private nameToAgent: Map<string, ILLMAdapter> = new Map();

  constructor(private readonly priorityService: AgentPriorityService) {}

  registerAgent(agent: ILLMAdapter): void {
    this.agents.set(agent.id, agent);
    this.nameToAgent.set(agent.name.toLowerCase(), agent);
    this.nameToAgent.set(agent.id.toLowerCase(), agent);
  }

  route(mentionedAgents: string[], content: string): RouteResult {
    const mentioned = mentionedAgents
      .map((name) => name.toLowerCase())
      .map((name) => this.nameToAgent.get(name))
      .filter((agent): agent is ILLMAdapter => agent !== undefined);

    if (mentioned.length > 0) {
      this.logger.log(`Route to mentioned agents: ${mentioned.map((a) => a.name).join(', ')}`);
      return {
        targetAgents: mentioned,
        processedContent: this.removeMentions(content),
      };
    }

    // 无 @，按优先级选择
    const selectedId = this.priorityService.selectByPriority(Array.from(this.agents.keys()));
    const selectedAgent = this.agents.get(selectedId);

    if (selectedAgent) {
      this.logger.log(`Route to highest priority agent: ${selectedAgent.name}`);
      return {
        targetAgents: [selectedAgent],
        processedContent: content,
      };
    }

    return {
      targetAgents: [],
      processedContent: content,
    };
  }

  getAgentById(id: string): ILLMAdapter | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): ILLMAdapter[] {
    return Array.from(this.agents.values());
  }

  private removeMentions(content: string): string {
    return content.replace(/@(\w+)/g, '').trim();
  }
}
```

- [ ] **Step 2: 更新 gateway.module.ts**

```typescript
// src/gateway/gateway.module.ts
import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ChatGateway } from './chat.gateway';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';
import { AgentRouter } from './agent-router';

@Module({
  imports: [AgentsModule],
  providers: [ChatGateway, SessionManager, MessageRouter, AgentRouter],
  exports: [ChatGateway, AgentRouter],
})
export class GatewayModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/gateway/agent-router.ts src/gateway/gateway.module.ts
git commit -m "feat(gateway): add AgentRouter for @mention and priority routing"
```

---

## Task 4: ShortTermMemoryService 实现

**Files:**

- Create: `src/memory/services/short-term-memory.service.ts`
- Modify: `src/memory/memory.module.ts`
- Test: `src/memory/services/short-term-memory.service.spec.ts`

- [ ] **Step 1: 创建 ShortTermMemoryService**

```typescript
// src/memory/services/short-term-memory.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
  private readonly TTL_SECONDS = 300; // 5 minutes
  private readonly MAX_MESSAGES = 20;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
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
```

- [ ] **Step 2: 更新 memory.module.ts**

```typescript
// src/memory/memory.module.ts
import { Module } from '@nestjs/common';
import { ShortTermMemoryService } from './services/short-term-memory.service';

@Module({
  providers: [ShortTermMemoryService],
  exports: [ShortTermMemoryService],
})
export class MemoryModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/memory/services/short-term-memory.service.ts src/memory/memory.module.ts
git commit -m "feat(memory): add ShortTermMemoryService with Redis 5min TTL"
```

---

## Task 5: WorkspaceService 和 TranscriptService 实现

**Files:**

- Create: `src/workspace/services/workspace.service.ts`
- Create: `src/workspace/services/transcript.service.ts`
- Modify: `src/workspace/workspace.module.ts`
- Test: `src/workspace/services/*.spec.ts`

- [ ] **Step 1: 创建 TranscriptService**

```typescript
// src/workspace/services/transcript.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);
  private readonly baseDir = 'workspace/sessions';

  private getTranscriptPath(sessionId: string): string {
    return join(this.baseDir, sessionId, 'transcript.jsonl');
  }

  async appendEntry(sessionId: string, entry: TranscriptEntry): Promise<void> {
    const filePath = this.getTranscriptPath(sessionId);
    const dir = dirname(filePath);

    try {
      await fs.mkdir(dir, { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(filePath, line, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to append transcript: ${error.message}`);
    }
  }

  async getEntries(sessionId: string, limit: number = 100): Promise<TranscriptEntry[]> {
    const filePath = this.getTranscriptPath(sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      const entries = lines.slice(-limit).map((line) => JSON.parse(line) as TranscriptEntry);
      return entries;
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 2: 创建 WorkspaceService**

```typescript
// src/workspace/services/workspace.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  completedAt?: string;
}

export interface FileItem {
  path: string;
  language: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceState {
  sessionId: string;
  files: FileItem[];
  tasks: TaskItem[];
  lastUpdate: string;
}

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly baseDir = 'workspace/sessions';

  private getWorkspacePath(sessionId: string): string {
    return join(this.baseDir, sessionId, 'workspace.json');
  }

  async getWorkspace(sessionId: string): Promise<WorkspaceState> {
    const filePath = this.getWorkspacePath(sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as WorkspaceState;
    } catch {
      return this.createDefaultWorkspace(sessionId);
    }
  }

  async updateWorkspace(sessionId: string, workspace: WorkspaceState): Promise<void> {
    const filePath = this.getWorkspacePath(sessionId);
    const dir = join(this.baseDir, sessionId);

    await fs.mkdir(dir, { recursive: true });
    workspace.lastUpdate = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(workspace, null, 2), 'utf-8');
  }

  async addFile(sessionId: string, file: Omit<FileItem, 'createdAt' | 'updatedAt'>): Promise<void> {
    const workspace = await this.getWorkspace(sessionId);
    const now = new Date().toISOString();

    workspace.files.push({
      ...file,
      createdAt: now,
      updatedAt: now,
    });

    await this.updateWorkspace(sessionId, workspace);
  }

  async addTask(sessionId: string, task: Omit<TaskItem, 'id' | 'createdAt'>): Promise<string> {
    const workspace = await this.getWorkspace(sessionId);
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    workspace.tasks.push({
      ...task,
      id,
      createdAt: new Date().toISOString(),
    });

    await this.updateWorkspace(sessionId, workspace);
    return id;
  }

  private async createDefaultWorkspace(sessionId: string): Promise<WorkspaceState> {
    const workspace: WorkspaceState = {
      sessionId,
      files: [],
      tasks: [],
      lastUpdate: new Date().toISOString(),
    };

    await this.updateWorkspace(sessionId, workspace);
    return workspace;
  }
}
```

- [ ] **Step 3: 更新 workspace.module.ts**

```typescript
// src/workspace/workspace.module.ts
import { Module } from '@nestjs/common';
import { WorkspaceService } from './services/workspace.service';
import { TranscriptService } from './services/transcript.service';

@Module({
  providers: [WorkspaceService, TranscriptService],
  exports: [WorkspaceService, TranscriptService],
})
export class WorkspaceModule {}
```

- [ ] **Step 4: Commit**

```bash
git add src/workspace/services/ src/workspace/workspace.module.ts
git commit -m "feat(workspace): add WorkspaceService and TranscriptService"
```

---

## Task 6: Message Entity 和 Persistence

**Files:**

- Create: `src/database/entities/message.entity.ts`
- Modify: `src/database/database.module.ts`
- Test: `src/database/entities/message.entity.spec.ts`

- [ ] **Step 1: 创建 Message Entity**

```typescript
// src/database/entities/message.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

@Entity('messages')
@Index(['sessionId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  sessionId: string;

  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  agentId: string;

  @Column({ nullable: true })
  agentName: string;

  @Column({
    type: 'enum',
    enum: MessageRole,
    default: MessageRole.USER,
  })
  role: MessageRole;

  @Column('text')
  content: string;

  @Column('text', { array: true, default: [] })
  mentionedAgents: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: 创建 MessagePersistenceService**

```typescript
// src/database/services/message-persistence.service.ts
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
```

- [ ] **Step 3: 更新 database.module.ts**

```typescript
// src/database/database.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { MessagePersistenceService } from './services/message-persistence.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'lobster',
      entities: [Message],
      synchronize: true, // 开发环境使用，生产环境使用迁移
    }),
    TypeOrmModule.forFeature([Message]),
  ],
  providers: [MessagePersistenceService],
  exports: [MessagePersistenceService],
})
export class DatabaseModule {}
```

- [ ] **Step 4: Commit**

```bash
git add src/database/entities/message.entity.ts src/database/services/message-persistence.service.ts src/database/database.module.ts
git commit -m "feat(database): add Message entity and persistence service"
```

---

## Task 7: ChatGateway 集成

**Files:**

- Modify: `src/gateway/chat.gateway.ts` (完整重写 handleMessage)
- Modify: `src/gateway/message.router.ts` (解析 @mention)

- [ ] **Step 1: 更新 message.router.ts 解析 @mention**

```typescript
// src/gateway/message.router.ts
import { Injectable } from '@nestjs/common';

export interface ParseResult {
  mentionedAgents: string[];
  processedContent: string;
}

@Injectable()
export class MessageRouter {
  parseMessage(content: string): ParseResult {
    const mentionPattern = /@(\w+)/g;
    const mentionedAgents: string[] = [];
    let match;

    while ((match = mentionPattern.exec(content)) !== null) {
      mentionedAgents.push(match[1]);
    }

    return {
      mentionedAgents,
      processedContent: content.replace(/@\w+/g, '').trim(),
    };
  }

  route(parsed: ParseResult): { shouldBroadcast: boolean; targetAgentIds: string[] } {
    return {
      shouldBroadcast: true,
      targetAgentIds: parsed.mentionedAgents,
    };
  }
}
```

- [ ] **Step 2: 重写 chat.gateway.ts handleMessage**

```typescript
// src/gateway/chat.gateway.ts (关键修改)
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';
import { AgentRouter } from './agent-router';
import { SendMessageDto } from './dto/send-message.dto';
import { ShortTermMemoryService, MemoryEntry } from '../memory/services/short-term-memory.service';
import { TranscriptService, TranscriptEntry } from '../workspace/services/transcript.service';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { MessagePersistenceService } from '../database/services/message-persistence.service';
import { AgentPriorityService } from '../agents/services/agent-priority.service';
import { ClaudeAdapter } from '../agents/adapters/claude.adapter';
import { CodexAdapter } from '../agents/adapters/codex.adapter';
import { GeminiAdapter } from '../agents/adapters/gemini.adapter';
import { AgentContext } from '../agents/interfaces/llm-adapter.interface';

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*', credentials: true },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly messageRouter: MessageRouter,
    private readonly agentRouter: AgentRouter,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly transcriptService: TranscriptService,
    private readonly workspaceService: WorkspaceService,
    private readonly messagePersistence: MessagePersistenceService,
    private readonly priorityService: AgentPriorityService,
    private readonly claudeAdapter: ClaudeAdapter,
    private readonly codexAdapter: CodexAdapter,
    private readonly geminiAdapter: GeminiAdapter,
  ) {}

  afterInit(): void {
    // 注册 Agent
    this.agentRouter.registerAgent(this.claudeAdapter);
    this.agentRouter.registerAgent(this.codexAdapter);
    this.agentRouter.registerAgent(this.geminiAdapter);

    // 初始化优先级配置
    this.priorityService.updateConfig({
      'claude-001': { basePriority: 100, quotaLimit: 100000 },
      'codex-001': { basePriority: 80, quotaLimit: 80000 },
      'gemini-001': { basePriority: 80, quotaLimit: 80000 },
    });

    this.logger.log('WebSocket Gateway 初始化完成');
  }

  async handleConnection(client: Socket): Promise<void> {
    const sessionId = client.handshake.query.sessionId as string;
    const userId = client.handshake.query.userId as string;

    if (!sessionId || !userId) {
      client.emit('error', { message: '缺少 sessionId 或 userId 参数' });
      client.disconnect();
      return;
    }

    await client.join(`session:${sessionId}`);
    this.sessionManager.addClient(sessionId, client);

    client.emit('connection:established', { clientId: client.id, sessionId, userId, timestamp: new Date() });
    this.server.to(`session:${sessionId}`).emit('user:joined', { userId, clientId: client.id, timestamp: new Date() });
  }

  handleDisconnect(client: Socket): void {
    const sessionId = this.sessionManager.removeClient(client.id);
    if (sessionId) {
      this.server.to(`session:${sessionId}`).emit('user:left', { clientId: client.id, timestamp: new Date() });
    }
  }

  @SubscribeMessage('message:send')
  @UsePipes(new ValidationPipe({ transform: true }))
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendMessageDto,
  ): Promise<{ success: boolean; messageId: string }> {
    const userId = client.handshake.query.userId as string;
    const sessionId = data.sessionId;

    const parsed = this.messageRouter.parseMessage(data.content);
    const routeResult = this.agentRouter.route(parsed.mentionedAgents, data.content);

    const userMessage = {
      id: this.generateMessageId(),
      sessionId,
      userId,
      role: 'user' as const,
      content: data.content,
      mentionedAgents: parsed.mentionedAgents,
      timestamp: new Date(),
    };

    // 广播用户消息
    this.server.to(`session:${sessionId}`).emit('message:received', userMessage);

    // 持久化
    await this.messagePersistence.save({
      sessionId,
      userId,
      role: 'user',
      content: data.content,
      mentionedAgents: parsed.mentionedAgents,
    });

    // 写入短期记忆
    await this.shortTermMemory.append(sessionId, {
      role: 'user',
      content: data.content,
      timestamp: new Date().toISOString(),
    });

    // 写入 JSONL
    await this.transcriptService.appendEntry(sessionId, {
      role: 'user',
      content: data.content,
      timestamp: new Date().toISOString(),
    });

    // Agent 响应
    for (const agent of routeResult.targetAgents) {
      await this.handleAgentResponse(sessionId, agent, parsed.processedContent);
    }

    return { success: true, messageId: userMessage.id };
  }

  private async handleAgentResponse(
    sessionId: string,
    agent: {
      id: string;
      name: string;
      generate: (prompt: string, context: AgentContext) => Promise<{ content: string; tokenUsage?: { total: number } }>;
    },
    prompt: string,
  ): Promise<void> {
    this.server.to(`session:${sessionId}`).emit('agent:thinking', {
      agentId: agent.id,
      agentName: agent.name,
      reason: '处理请求中',
      timestamp: new Date(),
    });

    try {
      const shortTermMemory = await this.shortTermMemory.get(sessionId);
      const conversationHistory = shortTermMemory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        agentId: m.agentId,
        agentName: m.agentName,
        createdAt: m.timestamp,
      }));

      const context: AgentContext = {
        sessionId,
        conversationHistory,
      };

      const response = await agent.generate(prompt, context);

      // 记录配额使用
      if (response.tokenUsage?.total) {
        this.priorityService.recordUsage(agent.id, response.tokenUsage.total);
      }

      // 推送流式响应（这里简化处理，实际需要流式）
      this.server.to(`session:${sessionId}`).emit('agent:stream', {
        agentId: agent.id,
        agentName: agent.name,
        delta: response.content,
        timestamp: new Date(),
      });

      this.server.to(`session:${sessionId}`).emit('agent:stream:end', {
        agentId: agent.id,
        agentName: agent.name,
        fullContent: response.content,
        timestamp: new Date(),
      });

      // 持久化 Agent 响应
      await this.messagePersistence.save({
        sessionId,
        agentId: agent.id,
        agentName: agent.name,
        role: 'assistant',
        content: response.content,
      });

      // 写入短期记忆
      await this.shortTermMemory.append(sessionId, {
        role: 'assistant',
        content: response.content,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });

      // 写入 JSONL
      await this.transcriptService.appendEntry(sessionId, {
        role: 'assistant',
        content: response.content,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.server.to(`session:${sessionId}`).emit('agent:error', {
        agentId: agent.id,
        agentName: agent.name,
        error: error.message,
        timestamp: new Date(),
      });
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
```

- [ ] **Step 3: 更新 gateway.module.ts 导入所有依赖**

```typescript
// src/gateway/gateway.module.ts
import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { MemoryModule } from '../memory/memory.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { DatabaseModule } from '../database/database.module';
import { ChatGateway } from './chat.gateway';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';
import { AgentRouter } from './agent-router';

@Module({
  imports: [AgentsModule, MemoryModule, WorkspaceModule, DatabaseModule],
  providers: [ChatGateway, SessionManager, MessageRouter, AgentRouter],
  exports: [ChatGateway, AgentRouter],
})
export class GatewayModule {}
```

- [ ] **Step 4: Commit**

```bash
git add src/gateway/chat.gateway.ts src/gateway/message.router.ts src/gateway/gateway.module.ts
git commit -m "feat(gateway): integrate all services into ChatGateway"
```

---

## Task 8: 配置文件创建

**Files:**

- Create: `config/agents.config.json`

- [ ] **Step 1: 创建 agents.config.json**

```json
{
  "agents": [
    {
      "id": "claude-001",
      "name": "Claude",
      "type": "claude",
      "model": "anthropic/claude-3-sonnet",
      "role": "架构设计与编码实现",
      "capabilities": ["架构设计", "代码生成", "技术选型", "重构"],
      "callType": "http",
      "enabled": true,
      "priority": {
        "basePriority": 100,
        "quotaLimit": 100000
      }
    },
    {
      "id": "codex-001",
      "name": "Codex",
      "type": "codex",
      "model": "codex",
      "role": "代码审查与质量把控",
      "capabilities": ["代码审查", "测试建议", "性能优化", "安全检测"],
      "callType": "http",
      "enabled": true,
      "priority": {
        "basePriority": 80,
        "quotaLimit": 80000
      }
    },
    {
      "id": "gemini-001",
      "name": "Gemini",
      "type": "gemini",
      "model": "gemini-2.0-flash-thinking",
      "role": "创意发散与视觉设计",
      "capabilities": ["创意建议", "UI/UX设计", "视觉方案", "用户体验"],
      "callType": "http",
      "enabled": true,
      "priority": {
        "basePriority": 80,
        "quotaLimit": 80000
      }
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add config/agents.config.json
git commit -m "feat(config: add agents.config.json with priority settings"
```

---

## Task 9: AppModule 组装

**Files:**

- Modify: `src/app.module.ts`

- [ ] **Step 1: 更新 app.module.ts**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GatewayModule } from './gateway/gateway.module';
import { AgentsModule } from './agents/agents.module';
import { MemoryModule } from './memory/memory.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AgentsModule,
    MemoryModule,
    WorkspaceModule,
    GatewayModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(app): assemble all modules in AppModule"
```

---

## 验收测试

### P1-1: @Claude xxx → Claude 响应

```bash
# 启动后端
npm run start:dev

# 使用前端或 socket.io-client 发送消息
socket.emit('message:send', { content: '@Claude 你好', sessionId: 'test-session' })

# 预期：收到 agent:stream 事件，agentName 为 Claude
```

### P1-2: @Claude @Codex xxx → 两者都响应

```bash
socket.emit('message:send', { content: '@Claude @Codex 你们好', sessionId: 'test-session' })

# 预期：收到两个 agent:stream 事件
```

### P1-3: 无 @ → 优先级最高的 Agent 响应

```bash
socket.emit('message:send', { content: '你好', sessionId: 'test-session' })

# 预期：只有 Claude（优先级最高）响应
```

### P1-4: Redis 短期记忆

```bash
redis-cli get memory:short:test-session
# 预期：返回 JSON 数组
```

### P1-5: JSONL 文件

```bash
cat workspace/sessions/test-session/transcript.jsonl
# 预期：每行一个 JSON 对象
```

### P1-6: PostgreSQL 持久化

```sql
SELECT * FROM messages WHERE session_id = 'test-session' ORDER BY created_at DESC LIMIT 10;
# 预期：返回消息记录
```

---

## 下一步

Phase 1 完成后再进行 Phase 2：集成 LangGraph 实现 ReAct/Plan-And-Execute 框架。
