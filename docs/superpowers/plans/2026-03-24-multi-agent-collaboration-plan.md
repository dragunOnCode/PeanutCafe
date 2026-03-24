# Multi-Agent 协作与工作流编排实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 LangGraph StateGraph 实现多 Agent 串行协作，基于 @mention 的 Handoff 机制，Plan-And-Execute + ReAct 模式，思维链记录。

**Architecture:** 在 ChatGateway 之上新增 Orchestration Layer，使用 LangGraph StateGraph 管理工作流状态，Agent 串行执行，通过 @mention 触发 Handoff，思维链写入 session 目录。

**Tech Stack:** TypeScript, NestJS, LangGraph, WebSocket

---

## File Structure

```
src/orchestration/
├── orchestration.module.ts              # 新增：模块定义
├── orchestration.service.ts             # 新增：工作流执行入口
├── state/
│   └── workflow.state.ts              # 新增：状态类型定义
├── graph/
│   └── workflow.graph.ts               # 新增：LangGraph 定义
├── agents/
│   ├── planner.service.ts             # 新增：Plan-And-Execute 规划器
│   └── reactor.service.ts              # 新增：ReAct 执行器
├── chain-of-thought/
│   └── cot-writer.service.ts          # 新增：思维链记录
└── handoff/
    └── mention-parser.ts               # 新增：@mention 解析

src/agents/interfaces/
└── llm-adapter.interface.ts          # 修改：新增 reasoning 字段

src/agents/adapters/
├── claude.adapter.ts                  # 修改：输出 reasoning
└── codex.adapter.ts                   # 修改：输出 reasoning

src/gateway/
└── chat.gateway.ts                   # 修改：集成 OrchestrationService
```

---

## Task 1: 安装依赖 @langchain/langgraph

**Files:**

- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

Run: `npm install @langchain/langgraph`
Expected: 安装成功

- [ ] **Step 2: 提交**

```bash
git add package.json package-lock.json
git commit -m "deps: add @langchain/langgraph"
```

---

## Task 2: 定义 WorkflowState 类型

**Files:**

- Create: `src/orchestration/state/workflow.state.ts`

- [ ] **Step 1: 创建状态定义文件**

```typescript
// src/orchestration/state/workflow.state.ts
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  reasoning?: string;
}

export interface ReasoningStep {
  id: string;
  thought: string;
  action: string;
  observation: string;
}

export interface WorkflowState {
  sessionId: string;
  messages: Message[];
  pendingTasks: Task[];
  completedTasks: Task[];
  currentAgent: string | null;
  nextAgent: string | null;
  isComplete: boolean;
  chainOfThought: string[];
  metadata: Record<string, unknown>;
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// src/orchestration/state/workflow.state.spec.ts
import { WorkflowState, Task, ReasoningStep } from './workflow.state';

describe('WorkflowState', () => {
  it('should have correct initial state', () => {
    const state: WorkflowState = {
      sessionId: 'test-session',
      messages: [],
      pendingTasks: [],
      completedTasks: [],
      currentAgent: null,
      nextAgent: null,
      isComplete: false,
      chainOfThought: [],
      metadata: {},
    };
    expect(state.sessionId).toBe('test-session');
    expect(state.isComplete).toBe(false);
  });

  it('should track tasks correctly', () => {
    const task: Task = {
      id: '1',
      description: 'Test task',
      status: 'pending',
    };
    expect(task.status).toBe('pending');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- src/orchestration/state/workflow.state.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/state/
git commit -m "feat(orchestration): add WorkflowState type definitions"
```

---

## Task 3: 实现 @mention 解析器

**Files:**

- Create: `src/orchestration/handoff/mention-parser.ts`

- [ ] **Step 1: 创建 mention-parser.ts**

```typescript
// src/orchestration/handoff/mention-parser.ts
export function parseMention(content: string): string | null {
  const match = content.match(/@(\w+)/);
  return match ? match[1] : null;
}

export function removeMentions(content: string): string {
  return content.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// src/orchestration/handoff/mention-parser.spec.ts
import { parseMention, removeMentions } from './mention-parser';

describe('parseMention', () => {
  it('should extract @mention from content', () => {
    const result = parseMention('请 @Claude 实现这个功能');
    expect(result).toBe('Claude');
  });

  it('should return null when no mention found', () => {
    const result = parseMention('请实现这个功能');
    expect(result).toBeNull();
  });

  it('should extract last mention when multiple', () => {
    const result = parseMention('@Claude 完成后交给 @Codex');
    expect(result).toBe('Codex');
  });
});

describe('removeMentions', () => {
  it('should remove all @mentions', () => {
    const result = removeMentions('@Claude 请 @Codex 检视');
    expect(result).toBe('请 检视');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- src/orchestration/handoff/mention-parser.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/handoff/
git commit -m "feat(orchestration): add mention parser for handoff"
```

---

## Task 4: 实现思维链记录服务

**Files:**

- Create: `src/orchestration/chain-of-thought/cot-writer.service.ts`
- Create: `src/orchestration/chain-of-thought/cot-writer.service.spec.ts`

- [ ] **Step 1: 创建 cot-writer.service.ts**

```typescript
// src/orchestration/chain-of-thought/cot-writer.service.ts
import { Injectable } from '@nestjs/common';
import { WorkspaceService } from '../../workspace/services/workspace.service';
import { ReasoningStep } from '../state/workflow.state';

@Injectable()
export class CotWriterService {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async writeAgentThinking(
    sessionId: string,
    agentId: string,
    agentName: string,
    plan: string,
    steps: ReasoningStep[],
    handoff?: string,
  ): Promise<void> {
    const content = this.formatCot(agentId, agentName, plan, steps, handoff);
    const path = `${sessionId}/chain-of-thought.md`;
    await this.appendToFile(path, content);
  }

  private formatCot(
    agentId: string,
    agentName: string,
    plan: string,
    steps: ReasoningStep[],
    handoff?: string,
  ): string {
    const timestamp = new Date().toISOString();
    const stepsContent = steps
      .map(
        (s) =>
          `**Step ${s.id}**: Thought - ${s.thought}\n         Action - ${s.action}\n         Observation - ${s.observation}`,
      )
      .join('\n\n');

    return `## Agent: ${agentName} (${timestamp})
### Plan
${plan}

### ReAct Execution
${stepsContent}

### Handoff
${handoff ?? '无'}

---\n\n`;
  }

  private async appendToFile(path: string, content: string): Promise<void> {
    const fullPath = `sessions/${path}`;
    const existing = await this.workspaceService.readFile(fullPath).catch(() => '');
    await this.workspaceService.writeFile(fullPath, existing + content);
  }
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// src/orchestration/chain-of-thought/cot-writer.service.spec.ts
import { CotWriterService } from './cot-writer.service';
import { WorkspaceService } from '../../../workspace/services/workspace.service';

describe('CotWriterService', () => {
  let cotWriter: CotWriterService;
  let mockWorkspace: jest.Mocked<WorkspaceService>;

  beforeEach(() => {
    mockWorkspace = {
      readFile: jest.fn().mockResolvedValue(''),
      writeFile: jest.fn().mockResolvedValue(undefined),
    } as any;
    cotWriter = new CotWriterService(mockWorkspace);
  });

  it('should format chain of thought correctly', async () => {
    await cotWriter.writeAgentThinking(
      'sess_123',
      'claude-001',
      'Claude',
      '1. 实现功能\n2. 编写测试',
      [{ id: '1', thought: '需要先创建文件', action: 'write_file', observation: '文件创建成功' }],
      '@Codex 请检视',
    );

    expect(mockWorkspace.writeFile).toHaveBeenCalledWith(
      'sessions/sess_123/chain-of-thought.md',
      expect.stringContaining('## Agent: Claude'),
    );
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- src/orchestration/chain-of-thought/cot-writer.service.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/chain-of-thought/
git commit -m "feat(orchestration): add chain-of-thought writer service"
```

---

## Task 5: 实现 Planner Service (Plan-And-Execute)

**Files:**

- Create: `src/orchestration/agents/planner.service.ts`
- Create: `src/orchestration/agents/planner.service.spec.ts`

- [ ] **Step 1: 创建 planner.service.ts**

```typescript
// src/orchestration/agents/planner.service.ts
import { Injectable } from '@nestjs/common';
import { ILLMAdapter, AgentContext } from '../../agents/interfaces/llm-adapter.interface';
import { Task } from '../state/workflow.state';

@Injectable()
export class PlannerService {
  constructor(private readonly llmAdapter: ILLMAdapter) {}

  async plan(agentId: string, task: string, context: AgentContext): Promise<Task[]> {
    const prompt = `你是一个任务规划专家。对于以下任务，请分解为可执行的子任务列表：

任务：${task}

请按顺序列出子任务，每个子任务应该：
1. 清晰可执行
2. 有明确的完成标准
3. 适合作为独立步骤

输出格式（JSON数组）：
[{"id": "1", "description": "子任务描述"}, ...]`;

    const response = await this.llmAdapter.generate(prompt, context);

    try {
      const tasks = JSON.parse(response.content) as Task[];
      return tasks.map((t) => ({ ...t, status: 'pending' as const }));
    } catch {
      return [{ id: '1', description: task, status: 'pending' }];
    }
  }
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// src/orchestration/agents/planner.service.spec.ts
import { PlannerService } from './planner.service';
import { ILLMAdapter } from '../../agents/interfaces/llm-adapter.interface';

describe('PlannerService', () => {
  let planner: PlannerService;
  let mockAdapter: jest.Mocked<ILLMAdapter>;

  beforeEach(() => {
    mockAdapter = {
      generate: jest.fn(),
    } as any;
    planner = new PlannerService(mockAdapter);
  });

  it('should parse tasks from LLM response', async () => {
    mockAdapter.generate.mockResolvedValue({
      content: '[{"id":"1","description":"创建文件"},{"id":"2","description":"编写测试"}]',
      timestamp: new Date(),
    });

    const tasks = await planner.plan('claude', '实现功能', {} as any);

    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe('pending');
  });

  it('should return single task on parse error', async () => {
    mockAdapter.generate.mockResolvedValue({ content: 'invalid', timestamp: new Date() });

    const tasks = await planner.plan('claude', '实现功能', {} as any);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe('实现功能');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- src/orchestration/agents/planner.service.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/agents/
git commit -m "feat(orchestration): add planner service for Plan-And-Execute"
```

---

## Task 6: 实现 Reactor Service (ReAct)

**Files:**

- Create: `src/orchestration/agents/reactor.service.ts`
- Create: `src/orchestration/agents/reactor.service.spec.ts`

- [ ] **Step 1: 创建 reactor.service.ts**

```typescript
// src/orchestration/agents/reactor.service.ts
import { Injectable } from '@nestjs/common';
import { ILLMAdapter, AgentContext } from '../../agents/interfaces/llm-adapter.interface';
import { Task, ReasoningStep } from '../state/workflow.state';

@Injectable()
export class ReactorService {
  constructor(private readonly llmAdapter: ILLMAdapter) {}

  async *execute(task: Task, context: AgentContext): AsyncGenerator<ReasoningStep> {
    let stepId = 1;
    let observation = '';

    while (!this.isComplete(task, observation)) {
      const thought = await this.reason(task, observation, context);
      const action = await this.act(thought, task, context);
      observation = await this.observe(action, context);

      yield {
        id: String(stepId++),
        thought,
        action,
        observation,
      };

      if (stepId > 10) break;
    }
  }

  private async reason(task: Task, observation: string, context: AgentContext): Promise<string> {
    const prompt = `任务：${task.description}
当前进度：${observation || '刚开始'}

请思考下一步应该做什么。`;

    const response = await this.llmAdapter.generate(prompt, context);
    return response.content;
  }

  private async act(thought: string, task: Task, context: AgentContext): Promise<string> {
    const prompt = `任务：${task.description}
思考：${thought}

请决定执行什么操作来推进任务。`;

    const response = await this.llmAdapter.generate(prompt, context);
    return response.content;
  }

  private async observe(action: string, context: AgentContext): Promise<string> {
    return `观察：${action} 已执行`;
  }

  private isComplete(task: Task, observation: string): boolean {
    return observation.includes('完成') || observation.includes('completed');
  }
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// src/orchestration/agents/reactor.service.spec.ts
import { ReactorService } from './reactor.service';

describe('ReactorService', () => {
  let reactor: ReactorService;
  let mockAdapter: jest.Mocked<any>;

  beforeEach(() => {
    mockAdapter = {
      generate: jest.fn().mockResolvedValue({ content: '思考内容', timestamp: new Date() }),
    };
    reactor = new ReactorService(mockAdapter);
  });

  it('should yield reasoning steps', async () => {
    const task = { id: '1', description: '测试任务', status: 'pending' };
    const steps: any[] = [];

    for await (const step of reactor.execute(task, {} as any)) {
      steps.push(step);
      break;
    }

    expect(steps).toHaveLength(1);
    expect(steps[0]).toHaveProperty('thought');
    expect(steps[0]).toHaveProperty('action');
    expect(steps[0]).toHaveProperty('observation');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- src/orchestration/agents/reactor.service.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/agents/
git commit -m "feat(orchestration): add reactor service for ReAct pattern"
```

---

## Task 7: 定义 LangGraph StateGraph

**Files:**

- Create: `src/orchestration/graph/workflow.graph.ts`

- [ ] **Step 1: 创建 workflow.graph.ts**

```typescript
// src/orchestration/graph/workflow.graph.ts
import { StateGraph } from '@langchain/langgraph';
import { WorkflowState } from '../state/workflow.state';

type WorkflowNode = (state: WorkflowState) => Promise<WorkflowState>;

const hydrateSessionStateNode: WorkflowNode = async (state) => {
  return { ...state };
};

const routeMessageNode: WorkflowNode = async (state) => {
  return { ...state };
};

const runTaskNode: WorkflowNode = async (state) => {
  return { ...state, isComplete: true };
};

const workflow = new StateGraph<WorkflowState>({
  channels: {
    sessionId: { value: null },
    messages: { value: null },
    pendingTasks: { value: null },
    completedTasks: { value: null },
    currentAgent: { value: null },
    nextAgent: { value: null },
    isComplete: { value: null },
    chainOfThought: { value: null },
    metadata: { value: null },
  },
})
  .addNode('hydrate_session_state', hydrateSessionStateNode)
  .addNode('route_current_message', routeMessageNode)
  .addNode('run_next_task', runTaskNode)
  .addEdge('__start__', 'hydrate_session_state')
  .addEdge('hydrate_session_state', 'route_current_message')
  .addEdge('route_current_message', 'run_next_task')
  .addConditionalEdges('run_next_task', (state: WorkflowState) => {
    return state.isComplete ? '__end__' : 'route_current_message';
  });

export const compiledGraph = workflow.compile();
```

- [ ] **Step 2: 验证语法**

Run: `npx tsc --noEmit src/orchestration/graph/workflow.graph.ts`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/orchestration/graph/
git commit -m "feat(orchestration): add LangGraph StateGraph definition"
```

---

## Task 8: 实现 OrchestrationService

**Files:**

- Create: `src/orchestration/orchestration.service.ts`
- Create: `src/orchestration/orchestration.service.spec.ts`

- [ ] **Step 1: 创建 orchestration.service.ts**

```typescript
// src/orchestration/orchestration.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { AgentRouter } from '../gateway/agent-router';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import { parseMention } from './handoff/mention-parser';
import { WorkflowState, Message, Task, ReasoningStep } from './state/workflow.state';
import { compiledGraph } from './graph/workflow.graph';

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly agentRouter: AgentRouter,
    private readonly cotWriter: CotWriterService,
    private readonly planner: PlannerService,
    private readonly reactor: ReactorService,
  ) {}

  async executeWorkflow(sessionId: string, userMessage: string, mentionedAgents: string[]): Promise<void> {
    let state: WorkflowState = {
      sessionId,
      messages: [],
      pendingTasks: [],
      completedTasks: [],
      currentAgent: null,
      nextAgent: null,
      isComplete: false,
      chainOfThought: [],
      metadata: {},
    };

    state = await this.hydrateSessionState(state);
    state = await this.routeMessage(state, userMessage, mentionedAgents);

    while (!state.isComplete && state.currentAgent) {
      state = await this.runTask(state);
    }
  }

  private async hydrateSessionState(state: WorkflowState): Promise<WorkflowState> {
    this.logger.log(`Hydrating session state for ${state.sessionId}`);
    return state;
  }

  private async routeMessage(
    state: WorkflowState,
    userMessage: string,
    mentionedAgents: string[],
  ): Promise<WorkflowState> {
    const mention = parseMention(userMessage);
    const nextAgent = mention || mentionedAgents[0] || 'Claude';

    return {
      ...state,
      nextAgent,
      currentAgent: nextAgent,
    };
  }

  private async runTask(state: WorkflowState): Promise<WorkflowState> {
    const agent = this.agentRouter.getAgentById(state.currentAgent!);
    if (!agent) {
      return { ...state, isComplete: true };
    }

    const tasks = await this.planner.plan(agent.id, state.messages.at(-1)?.content || '', {
      sessionId: state.sessionId,
    });

    const steps: ReasoningStep[] = [];
    for await (const step of this.reactor.execute(tasks[0], { sessionId: state.sessionId })) {
      steps.push(step);
    }

    const handoffMention = parseMention('');

    await this.cotWriter.writeAgentThinking(
      state.sessionId,
      agent.id,
      agent.name,
      tasks.map((t) => t.description).join('\n'),
      steps,
      handoffMention ? `@${handoffMention}` : undefined,
    );

    const nextAgent = handoffMention;

    return {
      ...state,
      completedTasks: [...state.completedTasks, ...tasks],
      nextAgent,
      currentAgent: nextAgent,
      isComplete: !nextAgent,
    };
  }
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// src/orchestration/orchestration.service.spec.ts
import { OrchestrationService } from './orchestration.service';
import { AgentRouter } from '../gateway/agent-router';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';

describe('OrchestrationService', () => {
  let service: OrchestrationService;
  let mockRouter: jest.Mocked<AgentRouter>;
  let mockCotWriter: jest.Mocked<CotWriterService>;
  let mockPlanner: jest.Mocked<PlannerService>;
  let mockReactor: jest.Mocked<ReactorService>;

  beforeEach(() => {
    mockRouter = { getAgentById: jest.fn() } as any;
    mockCotWriter = { writeAgentThinking: jest.fn() } as any;
    mockPlanner = { plan: jest.fn().mockResolvedValue([]) } as any;
    mockReactor = { execute: jest.fn() } as any;
    service = new OrchestrationService(mockRouter, mockCotWriter, mockPlanner, mockReactor);
  });

  it('should parse mention for handoff', async () => {
    mockRouter.getAgentById.mockReturnValue({ id: 'claude', name: 'Claude' } as any);

    await service.executeWorkflow('sess_123', '请 @Codex 检视代码', []);

    expect(mockRouter.getAgentById).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- src/orchestration/orchestration.service.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/
git commit -m "feat(orchestration): add orchestration service for workflow execution"
```

---

## Task 9: 改造 Agent 接口，新增 reasoning 字段

**Files:**

- Modify: `src/agents/interfaces/llm-adapter.interface.ts`
- Modify: `src/agents/adapters/claude.adapter.ts`
- Modify: `src/agents/adapters/codex.adapter.ts`

- [ ] **Step 1: 修改 AgentResponse 接口**

```typescript
// src/agents/interfaces/llm-adapter.interface.ts
export interface AgentResponse {
  content: string;
  reasoning?: string;
  tokenUsage?: TokenUsage;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}
```

- [ ] **Step 2: 修改 ClaudeAdapter 输出 reasoning**

在 `claude.adapter.ts` 的 `generate` 方法中，提取 reasoning：

```typescript
async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
  // ... existing code ...
  const response = await this.client.chat.completions.create({...});
  const content = response.choices[0]?.message?.content ?? '';

  // 提取 <reasoning>...</reasoning> 标签内容
  const reasoningMatch = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
  const reasoning = reasoningMatch ? reasoningMatch[1] : undefined;
  const cleanContent = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '').trim();

  return {
    content: cleanContent,
    reasoning,
    tokenUsage: {...},
    timestamp: new Date(),
  };
}
```

- [ ] **Step 3: 修改 CodexAdapter（同样逻辑）**

- [ ] **Step 4: 提交**

```bash
git add src/agents/
git commit -m "feat(agent): add reasoning field and extract from LLM response"
```

---

## Task 10: 创建 OrchestrationModule

**Files:**

- Create: `src/orchestration/orchestration.module.ts`

- [ ] **Step 1: 创建模块文件**

```typescript
// src/orchestration/orchestration.module.ts
import { Module } from '@nestjs/common';
import { OrchestrationService } from './orchestration.service';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [AgentsModule],
  providers: [OrchestrationService, CotWriterService, PlannerService, ReactorService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
```

- [ ] **Step 2: 提交**

```bash
git add src/orchestration/orchestration.module.ts
git commit -m "feat(orchestration): add OrchestrationModule"
```

---

## Task 11: 集成 OrchestrationService 到 ChatGateway

**Files:**

- Modify: `src/gateway/chat.gateway.ts`
- Modify: `src/gateway/gateway.module.ts`

- [ ] **Step 1: 修改 ChatGateway.handleMessage**

在 `handleMessage` 方法中，将：

```typescript
for (const agent of routeResult.targetAgents) {
  await this.handleAgentResponse(sessionId, agent);
}
```

替换为：

```typescript
const orchestrationService = this.orchestrationService;
await orchestrationService.executeWorkflow(sessionId, routeResult.processedContent, parsed.mentionedAgents);
```

- [ ] **Step 2: 修改 GatewayModule 导入 OrchestrationModule**

在 `src/gateway/gateway.module.ts` 中添加 OrchestrationModule：

```typescript
// src/gateway/gateway.module.ts
import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [OrchestrationModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class GatewayModule {}
```

同时在 `ChatGateway` 构造函数中注入 `OrchestrationService`：

```typescript
constructor(
  private readonly orchestrationService: OrchestrationService,
  // ... existing dependencies
) {}
```

- [ ] **Step 3: 运行测试验证**

Run: `npm run test -- src/gateway/chat.gateway.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/gateway/
git commit -m "feat(gateway): integrate OrchestrationService for multi-agent workflow"
```

---

## Task 12: 端到端集成测试

- [ ] **Step 1: 启动 docker-compose 服务**

Run: `docker-compose -f docker/docker-compose.yml up -d`

- [ ] **Step 2: 启动 NestJS 应用**

Run: `npm run start:dev`

- [ ] **Step 3: 通过 WebSocket 发送测试消息**

使用 `socket.io` 客户端或 wscat：

```bash
npx wscat -c ws://localhost:3000/chat?sessionId=test
> {"event":"message:send","data":{"content":"@Claude 用 python 实现贪吃蛇","sessionId":"test"}}
```

- [ ] **Step 4: 检查思维链文件**

Run: `cat sessions/test/chain-of-thought.md`
Expected: 包含 Claude 的 Plan、ReAct Steps

- [ ] **Step 5: 验证多 Agent 协作**

发送：`@Claude 实现排序算法，完成后交给 @Codex 检视`
检查思维链文件是否包含两个 Agent 的记录

- [ ] **Step 6: 提交测试**

```bash
git add -A
git commit -m "test: add end-to-end integration test for multi-agent workflow"
```

---

## Task 13: Lint 和 TypeCheck

- [ ] **Step 1: 运行 lint**

Run: `npm run lint`
Expected: 无新增 lint 错误

- [ ] **Step 2: 运行 typecheck**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交最终更改**

```bash
git add -A
git commit -m "feat: complete multi-agent collaboration with LangGraph workflow"
```
