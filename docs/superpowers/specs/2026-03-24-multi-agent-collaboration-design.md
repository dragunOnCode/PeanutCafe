# Multi-Agent 协作与工作流编排设计

> **目标:** 引入 LangGraph StateGraph 实现多 Agent 串行协作，基于 @mention 的 Handoff 机制，Plan-And-Execute + ReAct 模式，思维链记录。

## 背景

当前 `ChatGateway` 通过 `AgentRouter` 路由消息到 Agent，各 `AgentAdapter` 独立处理工具调用。但缺乏：

1. 多 Agent 串行协作机制
2. Agent 任务规划与执行观察
3. 思维链记录（用于 debug、评测、知识库）
4. 基于 @mention 的 Handoff

## Architecture

```
User Message
    ↓
[Orchestration Layer - LangGraph StateGraph]
    ├─ hydrate_session_state
    ├─ route_current_message
    ├─ run_next_task
    │   ├─ plan (Plan-And-Execute)
    │   ├─ execute (ReAct 循环)
    │   └─ handoff (解析 @mention)
    └─ loop / exit
    ↓
Agent Adapters
    ↓
ToolExecutorService
```

## 核心组件

### 1. Orchestration Module (`src/orchestration/`)

```
src/orchestration/
├── orchestration.module.ts
├── orchestration.service.ts       # 工作流执行入口
├── state/
│   └── workflow.state.ts        # StateGraph 状态定义
├── graph/
│   └── workflow.graph.ts         # LangGraph StateGraph 定义
├── agents/
│   ├── planner.service.ts       # Plan-And-Execute 规划器
│   └── reactor.service.ts        # ReAct 执行观察器
├── chain-of-thought/
│   └── cot-writer.service.ts    # 思维链记录
└── handoff/
    └── mention-parser.ts         # @mention 解析
```

### 2. State 定义

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

### 3. LangGraph StateGraph 定义

```typescript
// src/orchestration/graph/workflow.graph.ts
import { StateGraph } from '@langchain/langgraph';
import { WorkflowState } from '../state/workflow.state';

const workflow = new StateGraph(WorkflowState)
  .addNode('hydrate_session_state', hydrateSessionStateNode)
  .addNode('route_current_message', routeMessageNode)
  .addNode('run_next_task', runTaskNode)
  .addEdge('__start__', 'hydrate_session_state')
  .addEdge('hydrate_session_state', 'route_current_message')
  .addEdge('route_current_message', 'run_next_task')
  .addConditionalEdges('run_next_task', hasNextAgent, {
    true: 'route_current_message',
    false: '__end__',
  });

export const compiledGraph = workflow.compile();
```

### 4. 工作流节点

#### hydrate_session_state

加载 session 历史消息、共享内存等到 state。

#### route_current_message

解析用户消息中的 @mention，确定首个（或下一个）Agent。

#### run_next_task

执行单个 Agent 任务：

1. **Plan** — Agent 生成子任务列表（Plan-And-Execute）
2. **Execute** — 按序执行子任务（ReAct 循环）
3. **Observe** — 每步执行后观察结果
4. **Handoff** — 检测 @mention，确定下一 Agent

### 5. Agent Adapter 改造

新增 `reasoning` 输出字段：

```typescript
// src/agents/interfaces/llm-adapter.interface.ts
export interface AgentResponse {
  content: string;
  reasoning?: string; // 新增：思维链内容
  tokenUsage?: TokenUsage;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}
```

`streamGenerate` 同步输出 reasoning 或通过回调记录。

### 6. 思维链记录

```typescript
// src/orchestration/chain-of-thought/cot-writer.service.ts
@Injectable()
export class CotWriterService {
  async writeAgentThinking(
    sessionId: string,
    agentId: string,
    agentName: string,
    plan: string,
    steps: ReasoningStep[],
    handoff?: string,
  ): Promise<void> {
    const content = this.formatCot(agentId, agentName, plan, steps, handoff);
    const path = `sessions/${sessionId}/chain-of-thought.md`;
    await this.appendToFile(path, content);
  }

  private formatCot(...): string {
    return `## Agent: ${agentName} (${timestamp})
### Plan
${plan}

### ReAct Execution
${steps.map(s => `**Step ${s.id}**: Thought - ${s.thought}
         Action - ${s.action}
         Observation - ${s.observation}`).join('\n\n')}

### Handoff
${handoff ?? '无'}

---\n\n`;
  }
}
```

### 7. Handoff 解析

```typescript
// src/orchestration/handoff/mention-parser.ts
export function parseMention(output: string): string | null {
  const match = output.match(/@(\w+)/);
  return match ? match[1] : null;
}
```

### 8. Planner Service (Plan-And-Execute)

```typescript
// src/orchestration/agents/planner.service.ts
async plan(agentId: string, task: string, context: AgentContext): Promise<Task[]> {
  const prompt = `你是一个任务规划专家。对于以下任务，请分解为可执行的子任务列表：

  任务：${task}

  请按顺序列出子任务，每个子任务应该：
  1. 清晰可执行
  2. 有明确的完成标准
  3. 适合作为独立步骤

  输出格式（JSON数组）：
  [{"id": "1", "description": "子任务描述"}]`;

  const response = await this.llmAdapter.generate(prompt, context);
  return JSON.parse(response.content);
}
```

### 9. Reactor Service (ReAct)

```typescript
// src/orchestration/agents/reactor.service.ts
async *execute(task: Task, context: AgentContext): AsyncGenerator<ReasoningStep> {
  let observation = '';

  while (!this.isComplete(task, observation)) {
    const thought = await this.reason(task, observation, context);
    const action = await this.act(thought, task, context);
    observation = await this.observe(action, context);

    yield { thought, action, observation };
  }
}
```

## 工作流图

```
     __start__
        │
        ▼
hydrate_session_state
        │
        ▼
route_current_message ──→ 确定首个/下一 Agent
        │
        ▼
   run_next_task
        │
        ├─→ plan (Planner)
        │
        ├─→ execute steps (ReAct 循环)
        │
        └─→ parse @mention (Handoff)
        │
        ▼
  has_next_agent?
    │         │
   Yes        No
    │         │
    ▼         ▼
route    __end__
```

## 文件变更清单

| 文件                                                       | 操作                            |
| ---------------------------------------------------------- | ------------------------------- |
| `src/orchestration/`                                       | 新增目录及模块                  |
| `src/orchestration/state/workflow.state.ts`                | 新增：状态定义                  |
| `src/orchestration/graph/workflow.graph.ts`                | 新增：LangGraph 定义            |
| `src/orchestration/agents/planner.service.ts`              | 新增：规划器                    |
| `src/orchestration/agents/reactor.service.ts`              | 新增：执行器                    |
| `src/orchestration/chain-of-thought/cot-writer.service.ts` | 新增：思维链记录                |
| `src/orchestration/handoff/mention-parser.ts`              | 新增：@mention 解析             |
| `src/orchestration/orchestration.service.ts`               | 新增：工作流执行入口            |
| `src/agents/interfaces/llm-adapter.interface.ts`           | 修改：新增 reasoning 字段       |
| `src/agents/adapters/claude.adapter.ts`                    | 修改：输出 reasoning            |
| `src/agents/adapters/codex.adapter.ts`                     | 修改：输出 reasoning            |
| `src/gateway/chat.gateway.ts`                              | 修改：集成 OrchestrationService |
| `sessions/{sessionId}/chain-of-thought.md`                 | 新增：思维链文件                |

## 测试策略

### 单元测试

- `mention-parser` — @mention 提取正确性
- `planner.service` — 任务分解正确性
- `reactor.service` — ReAct 循环正确性
- `cot-writer.service` — 格式化输出正确性

### 集成测试

- LangGraph 工作流端到端执行
- Agent Handoff 链路验证
- 思维链文件生成验证

## 依赖

```json
{
  "@langchain/langgraph": "latest"
}
```

## 约束

1. **串行协作** — Agent 顺序执行，不使用 supervisor 模式
2. **@mention 触发** — Handoff 通过 @mention 自然触发
3. **不展示思维链** — 思维链仅记录，不推送前端
4. **Session 隔离** — 每个 session 独立记录
