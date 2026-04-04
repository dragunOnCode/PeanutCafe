# Claude Code Multi-Agent Collaboration Patterns Analysis

> 分析 Claude Code 的多 Agent 协作模式，为 PeanutCafe 提供最佳实践参考  
> 版本：v1.0.0  
> 日期：2026-04-03

---

## 目录

1. [Claude Code 协作模式概述](#1-claude-code-协作模式概述)
2. [Subagent 驱动开发模式](#2-subagent-驱动开发模式)
3. [并行 Agent 分派模式](#3-并行-agent-分派模式)
4. [Agent 间通信机制](#4-agent-间通信机制)
5. [PeanutCafe 当前实现](#5-peanutcafe-当前实现)
6. [差距分析与建议](#6-差距分析与建议)
7. [实施建议](#7-实施建议)

---

## 1. Claude Code 协作模式概述

Claude Code 采用了多种多 Agent 协作模式，核心设计理念是**隔离上下文 + 精确分派 + 层级审查**。

### 1.1 核心协作模式分类

| 模式                            | 描述                        | 使用场景           |
| ------------------------------- | --------------------------- | ------------------ |
| **Subagent-Driven Development** | 单任务单 Agent + 两阶段审查 | 顺序执行的独立任务 |
| **Parallel Agent Dispatch**     | 多 Agent 并行处理独立问题   | 多个不相关的问题域 |
| **Sequential Review Chain**     | 多个审查 Agent 按顺序审核   | 质量把关流程       |

### 1.2 Subagent 关键特性

从 Claude Code 的 subagent 会话文件 (`C:\Users\Administrator\.claude\projects\F--AIProject-Lobster-be\ff235bb8-14cf-4d06-91ec-76d1933f4ed5\subagents\agent-a3fb42a4b704f5abf.jsonl`) 分析，subagent 具有以下特征：

```json
{
  "parentUuid": "c38a52bc-2cae-49bc-9f62-0119de5aea8b",
  "isSidechain": true,
  "userType": "external",
  "cwd": "F:\\AIProject\\Lobster-be",
  "sessionId": "ff235bb8-14cf-4d06-91ec-76d1933f4ed5",
  "agentId": "a3fb42a4b704f5abf",
  "type": "user",
  "message": {
    "role": "user",
    "content": "Explore the frontend project..."
  }
}
```

**关键字段说明**：

- `parentUuid`: 父 Agent 的 UUID，用于追踪协作关系
- `isSidechain`: 标识这是 sidechain（并行）执行
- `sessionId`: 共享会话 ID，多 Agent 在同一会话中协作
- `agentId`: 子 Agent 的唯一标识

---

## 2. Subagent 驱动开发模式

### 2.1 模式架构

Claude Code 的 **superpowers** 插件实现了完整的 subagent-driven-development 模式，源码位于：

`C:\Users\Administrator\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.5\skills\subagent-driven-development\SKILL.md`

#### 2.1.1 核心流程图

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Per Task Pipeline                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌───────────────┐    ┌────────────────┐    ┌───────────────────┐  │
│  │   Implementer  │───▶│  Spec Reviewer │───▶│ Code Quality      │  │
│  │   Subagent    │    │  Subagent      │    │ Reviewer         │  │
│  └───────────────┘    └────────────────┘    └───────────────────┘  │
│         │                    │                         │              │
│         ▼                    ▼                         ▼              │
│  ┌───────────────┐    ┌────────────────┐    ┌───────────────────┐  │
│  │ - 实现任务    │    │ - 验证规格     │    │ - 代码质量检查    │  │
│  │ - 编写测试    │    │ - 检查遗漏     │    │ - 风格规范        │  │
│  │ - 自检        │    │ - 检查多余     │    │ - 最佳实践        │  │
│  │ - 提交        │    └────────────────┘    └───────────────────┘  │
│  └───────────────┘           │                       │              │
│         │                    │                       │              │
│         ▼                    ▼                       ▼              │
│  ┌───────────────┐    ┌────────────────┐    ┌───────────────────┐  │
│  │ 状态: DONE    │    │ ✅/❌          │    │ ✅/❌             │  │
│  │ WITH_CONCERNS │    │                │    │                   │  │
│  │ NEEDS_CONTEXT │    │ 如需修复       │    │ 如需修复          │  │
│  │ BLOCKED       │    │ 循环审查       │    │ 循环审查          │  │
│  └───────────────┘    └────────────────┘    └───────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1.2 实施者 Subagent 状态机制

```typescript
// 实施者返回四种状态
type ImplementerStatus =
  | 'DONE' // 完成，提交审查
  | 'DONE_WITH_CONCERNS' // 完成但有疑虑
  | 'NEEDS_CONTEXT' // 需要更多上下文
  | 'BLOCKED'; // 被阻塞

// 审查者返回两种状态
type ReviewStatus =
  | 'APPROVED' // 通过
  | 'ISSUES_FOUND'; // 发现问题
```

### 2.1.3 模型选择策略

```typescript
// 机械性任务 → 快速便宜模型
if (taskComplexity === 'mechanical') {
  model = 'haiku'; // 简单明确，1-2 文件
}

// 整合和判断任务 → 标准模型
if (taskComplexity === 'integration') {
  model = 'sonnet'; // 多文件协调，模式匹配
}

// 架构和设计任务 → 最强模型
if (taskComplexity === 'architecture') {
  model = 'opus'; // 设计判断，广泛理解
}
```

### 2.1.4 任务复杂度信号

| 触达文件数          | 规格完整性 | 模型选择 |
| ------------------- | ---------- | -------- |
| 1-2 文件 + 完整规格 | →          | `haiku`  |
| 多文件 + 整合关注   | →          | `sonnet` |
| 需要设计判断        | →          | `opus`   |

---

## 3. 并行 Agent 分派模式

### 3.1 模式架构

源码位于：`C:\Users\Administrator\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.5\skills\dispatching-parallel-agents\SKILL.md`

### 3.1.1 决策流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    并行分派决策树                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  "存在多个故障？"                                               │
│         │                                                        │
│         ▼                                                        │
│  "它们是否独立？"──────────────No───────────────────┐            │
│         │                                          │            │
│         │ Yes                                      ▼            │
│         ▼                                    单个 Agent        │
│  "可以并行工作？"──────No──▶ 顺序 Agent 分派       调查所有       │
│         │                                                        │
│         │ Yes                                                    │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    并行分派                               │    │
│  │                                                          │    │
│  │   Task("Fix agent-tool-abort.test.ts failures")         │    │
│  │   Task("Fix batch-completion-behavior.test.ts failures")  │    │
│  │   Task("Fix tool-approval-race-conditions.test.ts")       │    │
│  │                                                          │    │
│  │   // 三个 Agent 同时运行                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1.2 Agent 分派结构

```typescript
// 好的 Agent 任务描述
const agentTask = {
  scope: 'Fix agent-tool-abort.test.ts', // 明确范围
  goal: 'Make these tests pass', // 清晰目标
  constraints: 'Do NOT change production code', // 约束条件
  expectedOutput: 'Summary of root cause and fixes',
};
```

### 3.1.3 分派模板示例

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output capture" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:

1. Read the test file and understand what each test verifies
2. Identify root cause - timing issues or actual bugs?
3. Fix by:
   - Replacing arbitrary timeouts with event-based waiting
   - Fixing bugs in abort implementation if found
   - Adjusting test expectations if testing changed behavior

Do NOT just increase timeouts - find the real issue.

Return: Summary of what you found and what you fixed.
```

---

## 4. Agent 间通信机制

### 4.1 消息格式

Claude Code 的 subagent 消息格式（从 JSONL 分析）：

```json
{
  "parentUuid": "uuid-of-parent-agent",
  "isSidechain": true,
  "userType": "external",
  "cwd": "F:\\AIProject\\Lobster-be",
  "sessionId": "shared-session-id",
  "agentId": "subagent-unique-id",
  "type": "user",
  "message": {
    "role": "user",
    "content": "Task instructions..."
  },
  "uuid": "subagent-unique-uuid",
  "timestamp": "2026-03-04T16:04:09.618Z"
}
```

### 4.2 通信协议特点

| 特性           | 实现                     |
| -------------- | ------------------------ |
| **父子关系**   | `parentUuid` 追踪        |
| **隔离执行**   | `isSidechain: true`      |
| **共享会话**   | `sessionId` 统一         |
| **上下文构建** | 精确构建，不继承父上下文 |
| **结果聚合**   | 父 Agent 收集并整合      |

### 4.3 协作流程示例

```
┌─────────────────────────────────────────────────────────────────┐
│                     多 Agent 协作时序                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User ──────▶ "实现登录功能"                                     │
│                  │                                               │
│                  ▼                                               │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    Orchestrator                           │   │
│  │  1. 阅读计划，提取任务                                     │   │
│  │  2. 分派 Implementer Agent                               │   │
│  │  3. 收集结果                                             │   │
│  │  4. 分派 Spec Reviewer                                   │   │
│  │  5. 如有问题 → 修复循环                                  │   │
│  │  6. 分派 Code Quality Reviewer                          │   │
│  │  7. 如有问题 → 修复循环                                  │   │
│  │  8. 标记任务完成                                         │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Implementer:    Implementer:    Reviewer:     Reviewer:        │
│  ┌──────┐      │                │            │                 │
│  │ 任务1 │      │                │            │                 │
│  └──┬───┘      │                │            │                 │
│     │          │                │            │                 │
│     ▼          │                │            │                 │
│  ┌──────┐      │                │            │                 │
│  │ 实现 │ ────▶ │                │            │                 │
│  └──┬───┘      │                │            │                 │
│     │          │                │            │                 │
│     ▼          │                │            │                 │
│  ┌──────┐      │                │            │                 │
│  │ 自检 │      │                │            │                 │
│  └──┬───┘      │                │            │                 │
│     │          │                │            │                 │
│     ▼          │                ▼            │                 │
│  ┌──────┐      │         ┌──────────┐     │                 │
│  │ 提交 │      │         │ Spec     │     │                 │
│  └──┬───┘      │         │ Reviewer │     │                 │
│     │          │         └────┬─────┘     │                 │
│     │          │              │           │                 │
│     │          │              ▼           ▼                 │
│     │          │         ┌──────────┐ ┌──────────┐         │
│     │          │         │ Issues?  │ │ Code    │         │
│     │          │         │   Yes    │ │ Quality │         │
│     │          │         └────┬─────┘ │ Reviewer│         │
│     │          │              │       └────┬─────┘         │
│     │          │              │            │               │
│     ▼          │              ▼            ▼               │
│  ┌──────┐      │         ┌──────────┐ ┌──────────┐         │
│  │ 修复 │◀─────┼─────────│   No    │ │ Issues?  │         │
│  └──┬───┘      │         └──────────┘ │   Yes    │         │
│     │          │                       └────┬─────┘         │
│     │          │                            │               │
│     │          │                            ▼               │
│     │          │                       ┌──────────┐         │
│     │          │                       │  修复    │         │
│     │          │                       └────┬─────┘         │
│     │          │                            │               │
│     │          │                            ▼               │
│     │          │                       ┌──────────┐         │
│     │          │                       │   Done   │         │
│     │          │                       └──────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. PeanutCafe 当前实现

### 5.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PeanutCafe Orchestration                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────────┐   │
│  │ Orchestration │───▶│ WorkflowGraph │───▶│    LangGraph      │   │
│  │   Service    │    │               │    │   StateMachine    │   │
│  └───────────────┘    └───────────────┘    └───────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Node Types                                 │  │
│  │                                                               │  │
│  │  HYDRATE → ROUTE → RUN_TASK → CHECK_OUTPUT                  │  │
│  │                              ↓                                │  │
│  │                    ┌───────┼───────┐                        │  │
│  │                    ↓       ↓       ↓                        │  │
│  │              AWAIT_REVIEW  HANDLE_ERROR  ROUTE_AGENT        │  │
│  │                    │                        │                 │  │
│  │                    └───────────┬───────────┘                 │  │
│  │                                ↓                             │  │
│  │                          RUN_TASK (next agent)              │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 核心组件

#### 5.2.1 工作流状态 (`src/orchestration/state/workflow.state.ts`)

```typescript
export interface WorkflowState {
  sessionId: string;
  messages: Message[];
  pendingTasks: Task[];
  completedTasks: Task[];
  currentAgent: string | null;
  nextAgent: string | null;
  isComplete: boolean;
  chainOfThought: string[];
  reasoningSteps: ReasoningStep[];
  currentPlan: string;
  metadata: Record<string, unknown>;
  hasError: boolean;
  errorMessage?: string;
  needsReview: boolean;
  reviewReason?: string;
  lastOutput?: string;
  useReAct: boolean;
  reactMaxSteps?: number;
}

export interface ReasoningStep {
  id: string;
  thought: string | null;
  toolCall: { name: string; args: Record<string, unknown> } | null;
  observation: string;
  isDone: boolean;
  handoffAgent?: string;
}
```

#### 5.2.2 工作流图 (`src/orchestration/graph/workflow.graph.ts`)

```typescript
export const WORKFLOW_NODES = {
  HYDRATE: 'hydrate_session_state',
  ROUTE: 'route_message',
  RUN_TASK: 'run_task',
  CHECK_OUTPUT: 'check_output',
  AWAIT_REVIEW: 'await_human_review',
  ROUTE_AGENT: 'route_to_next_agent',
  HANDLE_ERROR: 'handle_error',
} as const;
```

**图结构**：

```
START → HYDRATE → ROUTE → RUN_TASK → CHECK_OUTPUT
                                      ↓
                          ┌───────────┼───────────┐
                          ↓           ↓           ↓
                    AWAIT_REVIEW  HANDLE_ERROR  ROUTE_AGENT
                          │                       │
                          └───────────┬───────────┘
                                      ↓
                                RUN_TASK (next agent)
                                      ↓
                                    END
```

#### 5.2.3 Agent 交接机制 (`src/orchestration/handoff/output-parser.ts`)

```typescript
export interface ParseResult {
  needsReview: boolean;
  nextAgent: string | null;
  hasError: boolean;
  cleanOutput: string;
}

// 解析 Agent 输出中的特殊标签
export function parseAgentOutput(output: string): ParseResult {
  const needsReview = /<NEED_REVIEW>/i.test(output);

  // 匹配 <handoff_agent>AgentName</handoff_agent>
  const handoffMatches = [...output.matchAll(/<handoff_agent>\s*(\w+)\s*<\/handoff_agent>/gi)];
  const nextAgent = handoffMatches.length > 0 ? handoffMatches[handoffMatches.length - 1][1] : null;

  return {
    needsReview,
    nextAgent,
    hasError: false,
    cleanOutput: stripSpecialTags(output),
  };
}
```

### 5.3 当前实现特点

| 特性               | 状态      | 说明                       |
| ------------------ | --------- | -------------------------- |
| **状态机编排**     | ✅ 已实现 | 使用 LangGraph StateGraph  |
| **Agent 交接协议** | ✅ 已实现 | XML 标签 `<handoff_agent>` |
| **流式输出**       | ✅ 已实现 | AsyncIterator + AsyncQueue |
| **人工审核点**     | ✅ 已实现 | `needsReview` 状态         |
| **错误处理**       | ✅ 已实现 | `HANDLE_ERROR` 节点        |
| **ReAct 模式**     | ✅ 已实现 | `executeWithReAct`         |
| **子 Agent 分派**  | ❌ 未实现 | 无独立 subagent 机制       |
| **并行执行**       | ❌ 未实现 | 顺序图执行                 |
| **两阶段审查**     | ❌ 未实现 | 仅人工审核                 |
| **模型选择策略**   | ❌ 未实现 | 硬编码模型                 |
| **上下文隔离**     | ❌ 未实现 | 共享完整上下文             |

### 5.4 现有代码分析

#### 5.4.1 工作流执行 (`src/orchestration/orchestration.service.ts`)

```typescript
async *streamExecute(
  sessionId: string,
  userMessage: string,
  mentionedAgents: string[],
): AsyncGenerator<WorkflowEvent> {
  const queue = new AsyncQueue<WorkflowEvent>();

  this.sessionStreamHooks.set(sessionId, {
    onChunk: (agentName, delta) => {
      queue.push({ type: 'chunk', agentName, delta });
    },
    onAgentStreamEnd: (agentName, fullContent) => {
      queue.push({ type: 'agent_stream_end', agentName, fullContent });
    },
  });

  let state = this.createInitialState(sessionId, userMessage, mentionedAgents);
  const graph = this.getGraph();

  // 后台并发运行图
  void (async () => {
    try {
      const graphStream = await graph.stream(state);
      for await (const step of graphStream) {
        const stepState = Object.values(step)[0] as Partial<WorkflowState>;
        state = { ...state, ...stepState };
        const event = this.stateToEvent(state);
        if (event) {
          queue.push(event);
        }
      }
      queue.end();
    } catch (error) {
      queue.fail(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  for await (const event of queue) {
    yield event;
  }
}
```

#### 5.4.2 ReAct 执行 (`src/orchestration/graph/workflow.graph.ts`)

```typescript
if (useReAct && 'executeWithReAct' in agent) {
  for await (const event of (agent as any).executeWithReAct(userMessage, context, {
    maxSteps: (state.metadata.reactMaxSteps as number) ?? 10,
  }) as AsyncGenerator<ReActStreamEvent>) {
    switch (event.type) {
      case 'text_delta':
        fullContent += event.text;
        hooks?.onChunk(state.currentAgent!, event.text);
        break;
      case 'done':
        doneContent = event.content;
        break;
      case 'handoff':
        handoffAgent = event.agentName;
        break;
      case 'error':
        logger.error(`[LangGraph] run_task: ReAct error event: ${event.message}`);
        break;
    }
  }
}
```

---

## 6. 差距分析与建议

### 6.1 功能差距矩阵

| 功能                  | Claude Code              | PeanutCafe        | 优先级 |
| --------------------- | ------------------------ | ----------------- | ------ |
| **Subagent 分派机制** | ✅ 完整实现              | ❌ 未实现         | P0     |
| **并行 Agent 执行**   | ✅ 完整实现              | ❌ 顺序执行       | P0     |
| **两阶段审查流程**    | ✅ Spec + Quality        | ⚠️ 仅人工审核     | P1     |
| **模型选择策略**      | ✅ 层级模型选择          | ❌ 硬编码         | P1     |
| **上下文隔离**        | ✅ 不继承父上下文        | ❌ 共享上下文     | P1     |
| **状态报告机制**      | ✅ DONE/CONCERNS/BLOCKED | ⚠️ 仅 needsReview | P1     |
| **结果聚合**          | ✅ 父 Agent 收集         | ❌ 单 Agent 输出  | P2     |
| **隔离执行环境**      | ✅ worktree              | ❌ 无             | P2     |
| **颜色语义系统**      | ✅ UI 区分               | ❌ 无             | P2     |
| **意图匹配触发**      | ✅ whenToUse             | ⚠️ 需增强         | P2     |

### 6.2 架构差异

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Claude Code vs PeanutCafe                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Claude Code:                                                        │
│  ┌─────────────┐                                                    │
│  │ Orchestrator│                                                    │
│  └──────┬──────┘                                                    │
│         │ 分派独立 Agent                                             │
│         ▼                                                            │
│  ┌─────┐ ┌─────┐ ┌─────┐                                          │
│  │Sub 1│ │Sub 2│ │Sub 3│  ← 独立上下文，并行执行                    │
│  └──┬──┘ └──┬──┘ └──┬──┘                                          │
│     │        │        │                                              │
│     └────────┼────────┘                                              │
│              │ 收集结果                                               │
│              ▼                                                       │
│         ┌─────────┐                                                  │
│         │整合输出 │                                                  │
│         └─────────┘                                                  │
│                                                                      │
│  PeanutCafe:                                                         │
│  ┌─────────────┐                                                    │
│  │Orchestration│                                                    │
│  │   Service   │                                                    │
│  └──────┬──────┘                                                    │
│         │ 顺序执行                                                   │
│         ▼                                                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │
│  │  HYDRATE    │→│   ROUTE     │→│  RUN_TASK   │                   │
│  └─────────────┘ └─────────────┘ └──────┬──────┘                    │
│                                          │                           │
│                                     ┌────┴────┐                       │
│                                     ▼         ▼                       │
│                              ┌──────────┐ ┌──────────┐               │
│                              │  CHECK   │ │  ROUTE   │               │
│                              │  OUTPUT  │ │  AGENT   │               │
│                              └──────────┘ └──────────┘               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. 实施建议

### 7.1 Phase 1: Subagent 分派机制 (P0)

#### 7.1.1 设计

```typescript
// src/orchestration/subagent/subagent-dispatcher.service.ts

export interface SubagentTask {
  id: string;
  description: string;
  context: AgentContext;
  model?: 'haiku' | 'sonnet' | 'opus' | 'inherit';
  expectedOutput: string;
}

export interface SubagentResult {
  taskId: string;
  status: 'done' | 'done_with_concerns' | 'needs_context' | 'blocked';
  output?: string;
  concerns?: string[];
  blockedReason?: string;
}

export class SubagentDispatcherService {
  async dispatch(task: SubagentTask): Promise<SubagentResult> {
    // 1. 构建隔离上下文
    const isolatedContext = this.buildIsolatedContext(task.context);

    // 2. 选择模型
    const model = this.selectModel(task.model);

    // 3. 分派执行
    const result = await this.executeInIsolatedContext(task, isolatedContext, model);

    // 4. 返回结果
    return result;
  }

  private buildIsolatedContext(context: AgentContext): AgentContext {
    // 只包含任务必需的信息，不继承父上下文
    return {
      sessionId: context.sessionId,
      workspace: context.workspace,
      // 不包含 messages 等完整历史
    };
  }
}
```

#### 7.1.2 集成到工作流

```typescript
// 修改 workflow.graph.ts
.addNode(WORKFLOW_NODES.DISPATCH_SUBAGENT, async (state) => {
  // 分派多个独立 subagent
  const results = await Promise.all(
    state.pendingTasks.map(task => this.subagentDispatcher.dispatch(task))
  );

  // 聚合结果
  return {
    ...state,
    subagentResults: results,
  };
})
```

### 7.2 Phase 2: 并行执行支持 (P0)

#### 7.2.1 并行任务检测

```typescript
// src/orchestration/parallel/parallel-executor.service.ts

export class ParallelExecutorService {
  async executeParallel(tasks: SubagentTask[]): Promise<SubagentResult[]> {
    // 检查任务是否独立
    const independentTasks = this.detectIndependentTasks(tasks);

    if (independentTasks.length > 1) {
      // 并行执行
      return Promise.all(independentTasks.map((task) => this.subagentDispatcher.dispatch(task)));
    }

    // 顺序执行
    const results: SubagentResult[] = [];
    for (const task of tasks) {
      results.push(await this.subagentDispatcher.dispatch(task));
    }
    return results;
  }

  private detectIndependentTasks(tasks: SubagentTask[]): SubagentTask[] {
    // 分析任务依赖关系
    // 返回可并行执行的任务列表
  }
}
```

### 7.3 Phase 3: 两阶段审查 (P1)

#### 7.3.1 审查 Agent 接口

```typescript
// src/orchestration/review/spec-reviewer.service.ts

export interface SpecReviewResult {
  compliant: boolean;
  issues: {
    type: 'missing' | 'extra' | 'incorrect';
    description: string;
    location?: string;
  }[];
}

export class SpecReviewerService {
  async review(spec: string, implementation: string): Promise<SpecReviewResult> {
    // 调用 LLM 进行规格审查
  }
}

// src/orchestration/review/code-quality-reviewer.service.ts

export interface CodeQualityResult {
  approved: boolean;
  strengths: string[];
  issues: {
    severity: 'critical' | 'important' | 'minor';
    description: string;
    location?: string;
  }[];
}

export class CodeQualityReviewerService {
  async review(code: string): Promise<CodeQualityResult> {
    // 调用 LLM 进行代码质量审查
  }
}
```

### 7.4 Phase 4: 模型选择策略 (P1)

#### 7.4.1 动态模型选择

```typescript
// src/orchestration/model/model-selector.service.ts

export class ModelSelectorService {
  selectModel(taskComplexity: TaskComplexity, availableModels: string[]): string {
    switch (taskComplexity) {
      case 'mechanical':
        return this.findModelByTier('haiku', availableModels);
      case 'integration':
        return this.findModelByTier('sonnet', availableModels);
      case 'architecture':
        return this.findModelByTier('opus', availableModels);
      default:
        return 'inherit';
    }
  }

  assessComplexity(task: Task): TaskComplexity {
    // 分析任务复杂度
    // - 触达文件数
    // - 规格完整性
    // - 需要的设计判断
  }
}
```

---

## 8. 参考资料

### Claude Code 源码

- **Subagent 驱动开发**: `C:\Users\Administrator\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.5\skills\subagent-driven-development\SKILL.md`
- **并行分派**: `C:\Users\Administrator\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.5\skills\dispatching-parallel-agents\SKILL.md`
- **Subagent 会话示例**: `C:\Users\Administrator\.claude\projects\F--AIProject-Lobster-be\ff235bb8-14cf-4d06-91ec-76d1933f4ed5\subagents\agent-a3fb42a4b704f5abf.jsonl`

### PeanutCafe 源码

- **编排服务**: `F:\AIProject\PeanutCafe\src\orchestration\orchestration.service.ts`
- **工作流图**: `F:\AIProject\PeanutCafe\src\orchestration\graph\workflow.graph.ts`
- **工作流状态**: `F:\AIProject\PeanutCafe\src\orchestration\state\workflow.state.ts`
- **输出解析器**: `F:\AIProject\PeanutCafe\src\orchestration\handoff\output-parser.ts`
- **系统架构**: `F:\AIProject\PeanutCafe\docs\系统架构设计.md`

---

**文档版本**: v1.0.0  
**最后更新**: 2026-04-03  
**分析依据**: Claude Code superpowers 插件源码 + PeanutCafe 源码
