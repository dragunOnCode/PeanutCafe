# LangGraph Workflow 重新实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重新引入 LangGraph StateGraph，实现多 Agent 串行协作，支持 Human-in-the-loop、Error Recovery、Agent Handoff 三种条件分支

**Architecture:** 使用 LangGraph StateGraph 定义工作流节点和条件边，通过 `compiledGraph.stream()` 异步执行，产出 `WorkflowEvent` 通过 WebSocket 转发给前端，前端通过 HTTP API 决策后续操作。

**Tech Stack:** TypeScript, NestJS, LangGraph StateGraph, WebSocket

---

## File Structure

### 涉及文件

**Orchestration Layer (重写/新建):**

- Modify: `src/orchestration/state/workflow.state.ts` - 扩展状态字段
- Create: `src/orchestration/handoff/output-parser.ts` - 解析 Agent 输出标签
- Modify: `src/orchestration/graph/workflow.graph.ts` - 完整的 StateGraph 定义
- Modify: `src/orchestration/orchestration.service.ts` - 使用 compiledGraph
- Create: `src/orchestration/workflow.controller.ts` - Human review API
- Modify: `src/orchestration/orchestration.module.ts` - 导入新服务

**Gateway Layer (修改接入点):**

- Modify: `src/gateway/chat.gateway.ts` - 注入并调用 OrchestrationService
- Modify: `src/gateway/gateway.module.ts` - 导入 OrchestrationModule

**保留不变:**

- `src/orchestration/agents/planner.service.ts`
- `src/orchestration/agents/reactor.service.ts`
- `src/orchestration/chain-of-thought/cot-writer.service.ts`
- `src/orchestration/handoff/mention-parser.ts`
- `src/orchestration/state/workflow.state.spec.ts`

---

## Task 1: 扩展 WorkflowState

**Files:**

- Modify: `src/orchestration/state/workflow.state.ts`

- [ ] **Step 1: 查看现有 workflow.state.ts**

```typescript
// 查看当前状态定义
```

- [ ] **Step 2: 添加新字段**

在 `WorkflowState` 接口中添加：

```typescript
hasError: boolean;
errorMessage?: string;
needsReview: boolean;
reviewReason?: string;
lastOutput?: string;
```

在 `Task` 接口中添加：

```typescript
type TaskStatus = 'pending' | 'in_progress' | 'awaiting_review' | 'completed' | 'failed';
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- src/orchestration/state/workflow.state.spec.ts`
Expected: PASS (状态类型变更不影响现有测试)

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/state/workflow.state.ts
git commit -m "feat(orchestration): extend WorkflowState with error/review fields"
```

---

## Task 2: 创建 OutputParser

**Files:**

- Create: `src/orchestration/handoff/output-parser.ts`
- Create: `src/orchestration/handoff/output-parser.spec.ts`

- [ ] **Step 1: 创建 output-parser.ts**

```typescript
// src/orchestration/handoff/output-parser.ts

export interface ParseResult {
  needsReview: boolean;
  nextAgent: string | null;
  hasError: boolean;
  cleanOutput: string;
}

export function parseAgentOutput(output: string): ParseResult {
  const needsReview = /<NEED_REVIEW>/i.test(output);
  const handoffMatch = output.match(/@(\w+)/);
  const nextAgent = handoffMatch ? handoffMatch[1] : null;

  const cleanOutput = output
    .replace(/<NEED_REVIEW>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();

  return {
    needsReview,
    nextAgent,
    hasError: false,
    cleanOutput,
  };
}
```

- [ ] **Step 2: 创建 output-parser.spec.ts**

```typescript
// src/orchestration/handoff/output-parser.spec.ts
import { parseAgentOutput } from './output-parser';

describe('parseAgentOutput', () => {
  it('should detect NEED_REVIEW tag', () => {
    const result = parseAgentOutput('设计文档完成 <NEED_REVIEW>');
    expect(result.needsReview).toBe(true);
  });

  it('should extract handoff agent', () => {
    const result = parseAgentOutput('完成啦 @Codex');
    expect(result.nextAgent).toBe('Codex');
  });

  it('should clean output', () => {
    const result = parseAgentOutput('<NEED_REVIEW>设计完成@Codex');
    expect(result.cleanOutput).toBe('设计完成@Codex');
  });

  it('should handle multiple agents return last', () => {
    const result = parseAgentOutput('@Claude @Codex');
    expect(result.nextAgent).toBe('Codex');
  });

  it('should handle no tags', () => {
    const result = parseAgentOutput('普通输出');
    expect(result.needsReview).toBe(false);
    expect(result.nextAgent).toBeNull();
    expect(result.cleanOutput).toBe('普通输出');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- src/orchestration/handoff/output-parser.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/orchestration/handoff/output-parser.ts src/orchestration/handoff/output-parser.spec.ts
git commit -m "feat(orchestration): add output parser for NEED_REVIEW and handoff"
```

---

## Task 3: 重写 workflow.graph.ts

**Files:**

- Modify: `src/orchestration/graph/workflow.graph.ts`
- Create: `src/orchestration/graph/workflow.graph.spec.ts`

- [ ] **Step 1: 查看当前 workflow.graph.ts**

```typescript
// 当前只有常量定义
export const WORKFLOW_NODES = { ... }
```

- [ ] **Step 2: 重写为完整 StateGraph**

```typescript
// src/orchestration/graph/workflow.graph.ts
import { StateGraph, END, START } from '@langchain/langgraph';
import type { WorkflowState } from '../state/workflow.state';
import type { AgentRouter } from '../../gateway/agent-router';
import type { CotWriterService } from '../chain-of-thought/cot-writer.service';
import type { PlannerService } from '../agents/planner.service';
import type { ReactorService } from '../agents/reactor.service';
import { parseAgentOutput } from '../handoff/output-parser';
import { parseMention } from '../handoff/mention-parser';

export const WORKFLOW_NODES = {
  HYDRATE: 'hydrate_session_state',
  ROUTE: 'route_message',
  RUN_TASK: 'run_task',
  CHECK_OUTPUT: 'check_output',
  AWAIT_REVIEW: 'await_human_review',
  ROUTE_AGENT: 'route_to_next_agent',
  HANDLE_ERROR: 'handle_error',
} as const;

export type WorkflowNodeName = (typeof WORKFLOW_NODES)[keyof typeof WORKFLOW_NODES];

function buildWorkflowGraph() {
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
      hasError: { value: null },
      errorMessage: { value: null },
      needsReview: { value: null },
      reviewReason: { value: null },
      lastOutput: { value: null },
      metadata: { value: null },
    },
  });

  workflow.addNode(WORKFLOW_NODES.HYDRATE, async (state) => {
    return { ...state };
  });

  workflow.addNode(WORKFLOW_NODES.ROUTE, async (state) => {
    const mention = parseMention(state.messages.at(-1)?.content || '');
    const nextAgent = mention || (state.metadata.mentionedAgents as string[])?.[0] || 'Claude';
    return { ...state, nextAgent, currentAgent: nextAgent };
  });

  workflow.addNode(WORKFLOW_NODES.RUN_TASK, async (state) => {
    return { ...state, hasError: false, errorMessage: undefined };
  });

  workflow.addNode(WORKFLOW_NODES.CHECK_OUTPUT, async (state) => {
    const output = state.lastOutput || '';
    const parsed = parseAgentOutput(output);
    return {
      ...state,
      needsReview: parsed.needsReview,
      nextAgent: parsed.nextAgent,
      lastOutput: parsed.cleanOutput,
    };
  });

  workflow.addNode(WORKFLOW_NODES.AWAIT_REVIEW, async (state) => {
    return { ...state };
  });

  workflow.addNode(WORKFLOW_NODES.ROUTE_AGENT, async (state) => {
    return { ...state, currentAgent: state.nextAgent };
  });

  workflow.addNode(WORKFLOW_NODES.HANDLE_ERROR, async (state) => {
    return { ...state };
  });

  workflow.addEdge(START, WORKFLOW_NODES.HYDRATE);
  workflow.addEdge(WORKFLOW_NODES.HYDRATE, WORKFLOW_NODES.ROUTE);
  workflow.addEdge(WORKFLOW_NODES.ROUTE, WORKFLOW_NODES.RUN_TASK);
  workflow.addEdge(WORKFLOW_NODES.RUN_TASK, WORKFLOW_NODES.CHECK_OUTPUT);
  workflow.addEdge(WORKFLOW_NODES.AWAIT_REVIEW, WORKFLOW_NODES.ROUTE_AGENT);
  workflow.addEdge(WORKFLOW_NODES.ROUTE_AGENT, WORKFLOW_NODES.RUN_TASK);
  workflow.addEdge(WORKFLOW_NODES.HANDLE_ERROR, WORKFLOW_NODES.AWAIT_REVIEW);

  workflow.addConditionalEdges(WORKFLOW_NODES.CHECK_OUTPUT, (state: WorkflowState): string => {
    if (state.hasError) return WORKFLOW_NODES.HANDLE_ERROR;
    if (state.needsReview) return WORKFLOW_NODES.AWAIT_REVIEW;
    if (state.nextAgent) return WORKFLOW_NODES.ROUTE_AGENT;
    return END;
  });

  return workflow.compile();
}

export const compiledGraph = buildWorkflowGraph();
```

- [ ] **Step 3: 验证语法**

Run: `npx tsc --noEmit src/orchestration/graph/workflow.graph.ts`
Expected: 无错误

- [ ] **Step 4: 创建 workflow.graph.spec.ts**

```typescript
// src/orchestration/graph/workflow.graph.spec.ts
import { WORKFLOW_NODES } from './workflow.graph';

describe('WORKFLOW_NODES', () => {
  it('should have all required node names', () => {
    expect(WORKFLOW_NODES.HYDRATE).toBe('hydrate_session_state');
    expect(WORKFLOW_NODES.ROUTE).toBe('route_message');
    expect(WORKFLOW_NODES.RUN_TASK).toBe('run_task');
    expect(WORKFLOW_NODES.CHECK_OUTPUT).toBe('check_output');
    expect(WORKFLOW_NODES.AWAIT_REVIEW).toBe('await_human_review');
    expect(WORKFLOW_NODES.ROUTE_AGENT).toBe('route_to_next_agent');
    expect(WORKFLOW_NODES.HANDLE_ERROR).toBe('handle_error');
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `npm test -- src/orchestration/graph/workflow.graph.spec.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/orchestration/graph/workflow.graph.ts src/orchestration/graph/workflow.graph.spec.ts
git commit -m "feat(orchestration): rewrite workflow.graph with full StateGraph"
```

---

## Task 4: 重写 OrchestrationService

**Files:**

- Modify: `src/orchestration/orchestration.service.ts`
- Modify: `src/orchestration/orchestration.service.spec.ts`

- [ ] **Step 1: 查看现有 orchestration.service.ts**

```typescript
// 当前使用简单的 while 循环
```

- [ ] **Step 2: 重写 OrchestrationService**

```typescript
// src/orchestration/orchestration.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { AgentRouter } from '../gateway/agent-router';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import type { WorkflowState, ReasoningStep } from './state/workflow.state';
import { compiledGraph, WORKFLOW_NODES } from './graph/workflow.graph';

export type WorkflowEvent =
  | { type: 'task_start'; agentName: string; task: string }
  | { type: 'task_complete'; output: string }
  | { type: 'needs_review'; reason: string }
  | { type: 'needs_decision'; error?: string }
  | { type: 'handoff'; from: string; to: string }
  | { type: 'complete'; finalOutput: string };

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly agentRouter: AgentRouter,
    private readonly cotWriter: CotWriterService,
    private readonly planner: PlannerService,
    private readonly reactor: ReactorService,
  ) {}

  async *streamExecute(
    sessionId: string,
    userMessage: string,
    mentionedAgents: string[],
  ): AsyncGenerator<WorkflowEvent> {
    let state = this.createInitialState(sessionId, userMessage, mentionedAgents);

    for await (const step of compiledGraph.stream(state)) {
      state = { ...state, ...Object.values(step)[0] };
      const event = this.stateToEvent(state);
      if (event) yield event;
    }
  }

  async executeWorkflow(sessionId: string, userMessage: string, mentionedAgents: string[]): Promise<void> {
    for await (const _ of this.streamExecute(sessionId, userMessage, mentionedAgents)) {
      // consume stream
    }
  }

  private createInitialState(sessionId: string, userMessage: string, mentionedAgents: string[]): WorkflowState {
    return {
      sessionId,
      messages: [{ id: '1', role: 'user', content: userMessage, timestamp: new Date().toISOString() }],
      pendingTasks: [],
      completedTasks: [],
      currentAgent: null,
      nextAgent: null,
      isComplete: false,
      chainOfThought: [],
      hasError: false,
      needsReview: false,
      metadata: { mentionedAgents },
    };
  }

  private stateToEvent(state: WorkflowState): WorkflowEvent | null {
    if (state.currentAgent && state.nextAgent === state.currentAgent && !state.lastOutput) {
      return { type: 'task_start', agentName: state.currentAgent, task: '任务执行中' };
    }
    if (state.lastOutput && !state.needsReview && !state.hasError && !state.nextAgent) {
      return { type: 'complete', finalOutput: state.lastOutput };
    }
    if (state.needsReview) {
      return { type: 'needs_review', reason: '任务需要人工审核' };
    }
    if (state.hasError) {
      return { type: 'needs_decision', error: state.errorMessage };
    }
    return null;
  }

  getCompiledGraph() {
    return compiledGraph;
  }
}
```

- [ ] **Step 3: 更新 orchestration.service.spec.ts**

```typescript
// src/orchestration/orchestration.service.spec.ts
// 保持现有测试，更新以适配新接口
```

- [ ] **Step 4: 运行测试**

Run: `npm test -- src/orchestration/orchestration.service.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/orchestration/orchestration.service.ts
git commit -m "feat(orchestration): rewrite to use compiledGraph.stream()"
```

---

## Task 5: 创建 WorkflowController

**Files:**

- Create: `src/orchestration/workflow.controller.ts`

- [ ] **Step 1: 创建 workflow.controller.ts**

```typescript
// src/orchestration/workflow.controller.ts
import { Controller, Post, Param, Body, HttpCode } from '@nestjs/common';
import { OrchestrationService } from './orchestration.service';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly orchestrationService: OrchestrationService) {}

  @Post(':sessionId/review/approve')
  @HttpCode(200)
  approveReview(@Param('sessionId') sessionId: string) {
    this.logger.log(`Review approved for session: ${sessionId}`);
    return { success: true, action: 'approved' };
  }

  @Post(':sessionId/review/reject')
  @HttpCode(200)
  rejectReview(@Param('sessionId') sessionId: string, @Body() dto: { reason?: string }) {
    this.logger.log(`Review rejected for session: ${sessionId}, reason: ${dto.reason}`);
    return { success: true, action: 'rejected', reason: dto.reason };
  }

  @Post(':sessionId/error/retry')
  @HttpCode(200)
  retryTask(@Param('sessionId') sessionId: string) {
    this.logger.log(`Retry requested for session: ${sessionId}`);
    return { success: true, action: 'retry' };
  }

  @Post(':sessionId/error/skip')
  @HttpCode(200)
  skipTask(@Param('sessionId') sessionId: string) {
    this.logger.log(`Skip requested for session: ${sessionId}`);
    return { success: true, action: 'skipped' };
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/orchestration/workflow.controller.ts
git commit -m "feat(orchestration): add workflow controller for human review decisions"
```

---

## Task 5.5: 注册 WorkflowController 到 OrchestrationModule

**Files:**

- Modify: `src/orchestration/orchestration.module.ts`

- [ ] **Step 1: 查看现有 orchestration.module.ts**

```typescript
// 查看当前模块定义
```

- [ ] **Step 2: 添加 WorkflowController 到 providers**

```typescript
import { WorkflowController } from './workflow.controller';

@Module({
  providers: [OrchestrationService, CotWriterService, PlannerService, ReactorService, WorkflowController],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
```

- [ ] **Step 3: 提交**

```bash
git add src/orchestration/orchestration.module.ts
git commit -m "feat(orchestration): register WorkflowController in module"
```

---

## Task 6: 扩展 ChatGateway

**Files:**

- Modify: `src/gateway/chat.gateway.ts`

- [ ] **Step 1: 注入 OrchestrationService**

在 constructor 中添加：

```typescript
private readonly orchestrationService: OrchestrationService,
```

- [ ] **Step 2: 替换 handleMessage 中的 for 循环**

将 (line 176-178):

```typescript
for (const agent of routeResult.targetAgents) {
  await this.handleAgentResponse(sessionId, agent);
}
```

替换为:

```typescript
await this.orchestrationService.executeWorkflow(sessionId, routeResult.processedContent, parsed.mentionedAgents);
```

- [ ] **Step 3: 添加 WebSocket 事件转发**

在 `executeWorkflow` 中，遍历 streamExecute 并转发事件：

```typescript
for await (const event of this.orchestrationService.streamExecute(
  sessionId,
  routeResult.processedContent,
  parsed.mentionedAgents,
)) {
  const eventName = `workflow:${event.type}`;
  this.server.to(`session:${sessionId}`).emit(eventName, {
    sessionId,
    ...event,
  });
}
```

根据 `event.type` 发送不同的事件名称：

| event.type       | WebSocket Event            |
| ---------------- | -------------------------- |
| `task_start`     | `workflow:task_start`      |
| `task_complete`  | `workflow:task_complete`   |
| `needs_review`   | `workflow:review_required` |
| `needs_decision` | `workflow:error`           |
| `handoff`        | `workflow:handoff`         |
| `complete`       | `workflow:complete`        |

- [ ] **Step 4: 提交**

```bash
git add src/gateway/chat.gateway.ts
git commit -m "feat(gateway): integrate OrchestrationService via streamExecute"
```

---

## Task 7: 修改 GatewayModule

**Files:**

- Modify: `src/gateway/gateway.module.ts`

- [ ] **Step 1: 导入 OrchestrationModule**

```typescript
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [OrchestrationModule],
  // ...
})
export class GatewayModule {}
```

- [ ] **Step 2: 提交**

```bash
git add src/gateway/gateway.module.ts
git commit -m "feat(gateway): import OrchestrationModule"
```

---

## Task 8: 运行测试

- [ ] **Step 1: 运行所有测试**

Run: `npm test 2>&1`
Expected: 全部测试通过

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "test: pass all tests after LangGraph integration"
```

---

## Task 9: Lint & Typecheck

- [ ] **Step 1: 运行 lint**

Run: `npm run lint`
Expected: 无新增 lint 错误

- [ ] **Step 2: 运行 typecheck**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: pass lint and typecheck"
```

---

## 验证清单

- [ ] `workflow.graph.ts` 使用 `StateGraph` 定义节点
- [ ] `checkOutputRouter` 条件边正确路由
- [ ] `orchestrationService.streamExecute()` 产出 `WorkflowEvent`
- [ ] `ChatGateway.handleMessage` 调用 `orchestrationService.streamExecute()`
- [ ] `WorkflowController` 提供 approve/reject/retry/skip API
- [ ] `OrchestrationModule` 注册了 `WorkflowController`
- [ ] WebSocket 转发 workflow 事件到前端（带 sessionId）
