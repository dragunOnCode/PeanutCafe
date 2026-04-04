# Claude Code Agent 执行机制深度分析

> 版本：v1.0.0
> 日期：2026-04-03
> 目标：深入理解 Claude Code 的 Agent 实现核心机制

---

## 目录

1. [任务拆解 (Task Decomposition)](#1-任务拆解-task-decomposition)
2. [执行循环 (Execution Loop)](#2-执行循环-execution-loop)
3. [结果观察 (Result Observation)](#3-结果观察-result-observation)
4. [验证机制 (Verification)](#4-验证机制-verification)
5. [完成评估 (Task Completion)](#5-完成评估-task-completion)
6. [记忆系统 (Memory System)](#6-记忆系统-memory-system)
7. [总结与架构图](#7-总结与架构图)

---

## 1. 任务拆解 (Task Decomposition)

### 1.1 源码位置

**文件**: `src/tools/TodoWriteTool/prompt.ts`

### 1.2 拆解机制

Claude Code 使用 **TodoWrite Tool** 进行任务拆解。系统提示词明确指导模型如何分解复杂任务：

```typescript
// From TodoWriteTool/prompt.ts lines 1-181
// When to Use This Tool:
// 1. Complex multi-step tasks - When a task requires 3 or more distinct steps
// 2. Non-trivial and complex tasks
// 5. After receiving new instructions - Immediately capture user requirements as todos
// 6. When you start working on a task - Mark it as in_progress BEFORE beginning work
```

### 1.3 任务状态机

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   pending   │ ──▶ │ in_progress  │ ──▶ │ completed   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                     ┌───────────┐
                     │ cancelled │
                     └───────────┘
```

**关键规则** (lines 162-170):

```typescript
// Task Completion Requirements:
// - ONLY mark a task as completed when you have FULLY accomplished it
// - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
// - Never mark a task as completed if:
//   - Tests are failing
//   - Implementation is partial
//   - You encountered unresolved errors
```

### 1.4 任务拆解示例

```
1. Creating dark mode toggle component in Settings page
2. Adding dark mode state management (context/store)
3. Implementing CSS-in-JS styles for dark theme
4. Updating existing components to support theme switching
5. Running tests and build process, addressing any failures
```

### 1.5 拆解触发条件

| 条件       | 说明                         |
| ---------- | ---------------------------- |
| 3+ 步骤    | 任务需要 3 个或更多独立步骤  |
| 非平凡任务 | 复杂的需要规划的任务         |
| 新指令     | 接收新需求时立即捕获为 todos |
| 开始工作时 | 先标记 in_progress 再开始    |

---

## 2. 执行循环 (Execution Loop)

### 2.1 源码位置

**主文件**: `src/query.ts` (queryLoop at line 241)

Claude Code 使用 **ReAct (Reasoning + Acting)** 模式。

### 2.2 核心循环结构

```typescript
// From query.ts lines 307-321 - Main while loop
// eslint-disable-next-line no-constant-condition
while (true) {
  // Destructure state at the top of each iteration
  let { toolUseContext } = state
  // ... setup for this iteration

  yield { type: 'stream_request_start' }

  // API call streaming loop (lines 659-866)
  for await (const message of deps.callModel({...})) {
    if (message.type === 'assistant') {
      // Collect assistant messages
      assistantMessages.push(assistantMessage)

      // Check for tool_use blocks
      if (msgToolUseBlocks.length > 0) {
        toolUseBlocks.push(...msgToolUseBlocks)
        needsFollowUp = true
      }

      // Streaming tool execution
      if (streamingToolExecutor) {
        streamingToolExecutor.addTool(toolBlock, assistantMessage)
      }
    }

    // Collect tool results as they complete
    if (streamingToolExecutor) {
      for (const result of streamingToolExecutor.getCompletedResults()) {
        // yield result.message
      }
    }
  }
}
```

### 2.3 ReAct 循环图解

```
┌─────────────────────────────────────────────────────────────────┐
│                        ReAct 循环                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐   │
│  │  Think  │───▶│   Act    │───▶│ Observe │───▶│  Think   │   │
│  │ (LLM)   │    │(Tool Use)│    │ (Result)│    │  (Next)  │   │
│  └─────────┘    └──────────┘    └─────────┘    └──────────┘   │
│       │                                                            │
│       │         ┌─────────────────────────────────────┐         │
│       │         │           循环条件                    │         │
│       │         │  needsFollowUp = true  → 继续循环   │         │
│       │         │  needsFollowUp = false → 退出循环   │         │
│       │         └─────────────────────────────────────┘         │
│       │                                                            │
│       ▼                                                            │
│  ┌─────────┐                                                       │
│  │ Output  │                                                       │
│  │ Result  │                                                       │
│  └─────────┘                                                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 工具执行编排

**文件**: `src/services/tools/toolOrchestration.ts`

```typescript
// Lines 19-82 - runTools function
export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(...)) {
    if (isConcurrencySafe) {
      // Run read-only tools concurrently
      for await (const update of runToolsConcurrently(blocks, ...)) {
        yield update
      }
    } else {
      // Run non-read-only tools serially
      for await (const update of runToolsSerially(blocks, ...)) {
        yield update
      }
    }
  }
}
```

### 2.5 并发控制

```typescript
function partitionToolCalls(toolUseMessages, toolUseContext) {
  // Partitions into:
  // 1. A single non-read-only tool, OR
  // 2. Multiple consecutive read-only tools
  // Read-only tools can run concurrently; writes run serially
}
```

**规则**:

- **可并发**: `Read`, `Grep`, `Glob`, `WebSearch` (只读工具)
- **必须串行**: `Edit`, `Write`, `Bash`, `NotebookEdit` (写入工具)

### 2.6 工具执行完整流程

```typescript
// 单个工具执行流程
async function runToolUse(...) {
  // 1. 权限检查
  const permission = await checkPermission(toolName, toolArgs)
  if (permission === 'deny') {
    return { type: 'error', message: 'Permission denied' }
  }

  // 2. Pre-tool hooks
  for (const hook of preToolUseHooks) {
    await hook.execute(toolName, toolArgs)
  }

  // 3. 执行工具
  const result = await tool.call(toolArgs)

  // 4. Post-tool hooks
  for (const hook of postToolUseHooks) {
    await hook.execute(toolName, result)
  }

  // 5. 结果映射
  return mapToApiFormat(result)
}
```

---

## 3. 结果观察 (Result Observation)

### 3.1 源码位置

**文件**: `src/services/tools/toolExecution.ts`

### 3.2 工具结果处理

```typescript
// Lines 264-270 - MessageUpdateLazy type
export type MessageUpdateLazy<M extends Message = Message> = {
  message: M;
  contextModifier?: {
    toolUseID: string;
    modifyContext: (context: ToolUseContext) => ToolUseContext;
  };
};
```

### 3.3 工具结果处理流程

```typescript
// Lines 1403-1484 - addToolResult
async function addToolResult(toolUseResult, preMappedBlock?) {
  // Map tool result to API format
  const toolResultBlock = preMappedBlock
    ? await processPreMappedToolResultBlock(...)
    : await processToolResultBlock(tool, toolUseResult, toolUseID)

  // Build content blocks - tool result first, then optional feedback
  const contentBlocks: ContentBlockParam[] = [toolResultBlock]

  // Add accept feedback if user provided feedback when approving
  // Add content blocks (e.g., pasted images) from permission decision

  resultingMessages.push({
    message: createUserMessage({
      content: contentBlocks,
    }),
  })
}
```

### 3.4 流式执行

```typescript
// From query.ts lines 561-568
const useStreamingToolExecution = config.gates.streamingToolExecution;
let streamingToolExecutor = useStreamingToolExecution
  ? new StreamingToolExecutor(toolUseContext.options.tools, canUseTool, toolUseContext)
  : null;
```

**StreamingToolExecutor**:

- 流式处理工具执行
- 边执行边 yield 结果
- 实时反馈给 LLM

### 3.5 结果反馈模式

```
┌─────────────────────────────────────────────────────────────────┐
│                      结果反馈循环                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Tool Result                                                      │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────┐                                               │
│  │  结果格式化  │  (tool_result block)                          │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │  结果注入    │  → 作为 user message 注入到下一轮              │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │  下一轮思考  │  LLM 根据结果继续推理                          │
│  └──────────────┘                                               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 验证机制 (Verification)

### 4.1 源码位置

**文件**:

- `src/skills/bundled/verify.ts`
- `src/skills/bundled/verifyContent.ts`

### 4.2 验证技能注册

```typescript
// From verify.ts lines 12-29
export function registerVerifySkill(): void {
  if (process.env.USER_TYPE !== 'ant') {
    return;
  }
  registerBundledSkill({
    name: 'verify',
    description: DESCRIPTION,
    userInvocable: true,
    files: SKILL_FILES,
    async getPromptForCommand(args) {
      const parts: string[] = [SKILL_BODY.trimStart()];
      if (args) {
        parts.push(`## User Request\n\n${args}`);
      }
      return [{ type: 'text', text: parts.join('\n\n') }];
    },
  });
}
```

### 4.3 验证原则

**Coordinator Mode Verification** (`src/coordinator/coordinatorMode.ts` lines 220-228):

```typescript
### What Real Verification Looks Like

Verification means **proving the code works**, not confirming it exists.
A verifier that rubber-stamps weak work undermines everything.

- Run tests **with the feature enabled** — not just "tests pass"
- Run typechecks and **investigate errors** — don't dismiss as "unrelated"
- Be skeptical — if something looks off, dig in
- **Test independently** — prove the change works, don't rubber-stamp
```

### 4.4 验证层级

| 层级       | 执行者              | 验证内容                     |
| ---------- | ------------------- | ---------------------------- |
| **第一层** | Worker Agent        | 运行测试、类型检查、自验证   |
| **第二层** | Verification Worker | 独立验证、边缘case、错误路径 |

### 4.5 自验证要求

**Per-task verification in Coordinator** (lines 328-335):

```typescript
// For implementation: "Run relevant tests and typecheck, then commit your
// changes and report the hash" — workers self-verify before reporting done.
// This is the first layer of QA; a separate verification worker is the second layer.

// For verification: "Prove the code works, don't just confirm it exists"
// For verification: "Try edge cases and error paths"
```

### 4.6 验证触发

```
┌─────────────────────────────────────────────────────────────────┐
│                      验证触发时机                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. 任务完成后                                                   │
│     └── Agent 标记任务 completed 前必须自验证                      │
│                                                                   │
│  2. 提交前                                                       │
│     └── 必须运行测试、类型检查                                     │
│                                                                   │
│  3. 代码审查                                                     │
│     └── Verification Worker 独立验证                             │
│                                                                   │
│  4. 人工触发                                                     │
│     └── /verify 命令显式调用                                     │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 完成评估 (Task Completion)

### 5.1 源码位置

**文件**:

- `src/utils/queryHelpers.ts` (isResultSuccessful)
- `src/QueryEngine.ts`

### 5.2 完成判断逻辑

```typescript
// From queryHelpers.ts lines 56-94
export function isResultSuccessful(message: Message | undefined, stopReason: string | null = null): message is Message {
  if (!message) return false;

  if (message.type === 'assistant') {
    const lastContent = last(message.message.content);
    return (
      lastContent?.type === 'text' || lastContent?.type === 'thinking' || lastContent?.type === 'redacted_thinking'
    );
  }

  if (message.type === 'user') {
    // Check if all content blocks are tool_result type
    const content = message.message.content;
    if (
      Array.isArray(content) &&
      content.length > 0 &&
      content.every((block) => 'type' in block && block.type === 'tool_result')
    ) {
      return true;
    }
  }

  // API completed with end_turn but yielded no content
  return stopReason === 'end_turn';
}
```

### 5.3 成功/失败结果类型

```typescript
// From QueryEngine.ts lines 1107-1180
if (!isResultSuccessful(result, lastStopReason)) {
  yield {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: Date.now() - startTime,
    is_error: true,
    num_turns: turnCount,
    stop_reason: lastStopReason,
    // ...
    errors: (() => {
      // Diagnostic information about failure
    })(),
  }
  return
}

// 成功结果
yield {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: Date.now() - startTime,
  // ...
}
```

### 5.4 完成判断决策树

```
┌─────────────────────────────────────────────────────────────────┐
│                    任务完成判断流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Message received                                                 │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────┐                                             │
│  │ Is assistant?  │                                             │
│  └────────┬────────┘                                             │
│           │                                                       │
│     ┌─────┴─────┐                                                │
│     ▼           ▼                                                │
│    Yes          No                                                │
│     │           │                                                 │
│     ▼           ▼                                                │
│  Last content   ┌─────────────────┐                              │
│  is text/      │ Is user message? │                              │
│  thinking?     └────────┬────────┘                              │
│     │                  │                                        │
│     ▼                  ▼                                        │
│   SUCCESS        All blocks are                                  │
│                  tool_result?                                    │
│                        │                                        │
│                   ┌────┴────┐                                   │
│                   ▼         ▼                                    │
│                  Yes       No                                    │
│                   │         │                                    │
│                   ▼         ▼                                    │
│                SUCCESS   Check stop_reason                        │
│                            │                                     │
│                      end_turn?                                   │
│                            │                                     │
│                      ┌─────┴─────┐                               │
│                      ▼           ▼                               │
│                     Yes          No                               │
│                      │           │                               │
│                      ▼           ▼                               │
│                   SUCCESS    ERROR/PENDING                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.5 Turn 计数

```typescript
// From QueryEngine.ts lines 758-760
if (message.type === 'user') {
  turnCount++;
}
```

---

## 6. 记忆系统 (Memory System)

### 6.1 源码位置

**文件**: `src/memdir/memdir.ts`

### 6.2 记忆类型

```typescript
// Four-type taxonomy (lines 199-266):
// - user: Facts about the user, preferences
// - feedback: User corrections and preferences
// - project: Project-specific context
// - reference: External system pointers
```

### 6.3 记忆层次

```
┌─────────────────────────────────────────────────────────────────┐
│                    记忆层次结构                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     CLAUDE.md                            │    │
│  │              项目规范和约定 (Project)                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  CLAUDE.local.md                        │    │
│  │               个人偏好设置 (User)                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    MEMORY.md                            │    │
│  │              自动记忆索引 (Auto-memory)                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Team Memory                           │    │
│  │                 团队共享知识 (Org-wide)                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 记忆提示词

```typescript
// Memory Prompt Structure (lines 239-261):
`You have a persistent, file-based memory system at \`${memoryDir}\``.

"If you are about to start a non-trivial implementation task and would like
to reach alignment with the user on your approach you should use a Plan rather
than saving this information to memory."

"When you need to break your work in current conversation into discrete steps
or keep track of your progress use tasks instead of saving to memory."
```

### 6.5 上下文注入

**文件**: `src/context.ts`

```typescript
// Lines 155-188 - getUserContext (cached per conversation)
export const getUserContext = memoize(async (): Promise<{ [k: string]: string }> => {
  const claudeMd = shouldDisableClaudeMd ? null : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()));

  return {
    ...(claudeMd && { claudeMd }),
    currentDate: `Today's date is ${getLocalISODate()}.`,
  };
});

// Lines 116-149 - getSystemContext (cached per conversation)
export const getSystemContext = memoize(async () => {
  const gitStatus = await getGitStatus();
  // ...
  return {
    ...(gitStatus && { gitStatus }),
    ...(feature('BREAK_CACHE_COMMAND') && injection ? { cacheBreaker: `[CACHE_BREAKER: ${injection}]` } : {}),
  };
});
```

### 6.6 Remember 技能

**文件**: `src/skills/bundled/remember.ts`

```typescript
// Lines 9-62 - Memory Review skill
## Steps:
### 1. Gather all memory layers
Read CLAUDE.md and CLAUDE.local.md

### 2. Classify each auto-memory entry
| Destination | What belongs there |
| CLAUDE.md | Project conventions |
| CLAUDE.local.md | Personal instructions |
| Team memory | Org-wide knowledge |

### 3. Identify cleanup opportunities
- Duplicates: Auto-memory entries already in CLAUDE.md
- Outdated: Contradicted entries
- Conflicts: Between layers

### 4. Present the report
Output grouped by action type:
1. **Promotions** — entries to move
2. **Cleanup** — duplicates, outdated, conflicts
3. **Ambiguous** — entries needing user input
4. **No action needed**
```

### 6.7 记忆存储决策

| 场景     | 存储位置          | 说明                     |
| -------- | ----------------- | ------------------------ |
| 项目规范 | `CLAUDE.md`       | 项目级约定               |
| 个人偏好 | `CLAUDE.local.md` | 用户级设置               |
| 自动记忆 | `MEMORY.md`       | 自动累积的信息           |
| 团队知识 | Team memory       | 组织级共享               |
| 任务进度 | Todo list         | **不存记忆，用任务跟踪** |

---

## 7. 总结与架构图

### 7.1 完整执行架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code Agent 架构                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  User Input                                                       │
│       │                                                          │
│       ▼                                                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     QueryEngine.ts                          │  │
│  │  - submitMessage() - 主入口                                 │  │
│  │  - Turns loop with mutableMessages                        │  │
│  │  - 结果提取和成功/失败判断                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                       │
│                           ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                        query.ts                            │  │
│  │  - query() - AsyncGenerator 主循环                       │  │
│  │  - queryLoop() - 核心 ReAct 循环 (lines 241-1230+)       │  │
│  │    ┌───────────────────────────────────────────────────┐  │  │
│  │    │  while (true) {                                  │  │  │
│  │    │    1. 预处理 (compact, snip, microcompact)         │  │  │
│  │    │    2. API 调用 + 流式处理                         │  │  │
│  │    │    3. 收集 tool_use 块                            │  │  │
│  │    │    4. StreamingToolExecutor 处理结果               │  │  │
│  │    │    5. needsFollowUp → 继续循环                    │  │  │
│  │    │       !needsFollowUp → 退出循环                   │  │  │
│  │    │  }                                                │  │  │
│  │    └───────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                       │
│                           ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │            toolOrchestration.ts + toolExecution.ts         │  │
│  │  - runTools() - 分区并发/串行执行                         │  │
│  │  - runToolsConcurrently() / runToolsSerially()            │  │
│  │  - runToolUse() - 单个工具执行                            │  │
│  │    ├── 权限检查                                           │  │
│  │    ├── Pre-tool hooks                                    │  │
│  │    ├── Tool.call()                                       │  │
│  │    ├── Post-tool hooks                                   │  │
│  │    └── 结果映射                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                       │
│                           ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     工具系统                                │  │
│  │  - TodoWriteTool - 任务拆解和跟踪                          │  │
│  │  - BashTool/EditTool/ReadTool - 代码编辑                  │  │
│  │  - AgentTool - 启动子 Agent                               │  │
│  │  - /verify skill - 验证                                   │  │
│  │  - /remember skill - 记忆管理                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                       │
│                           ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                     记忆系统                               │  │
│  │  - CLAUDE.md - 项目规范                                   │  │
│  │  - CLAUDE.local.md - 个人偏好                             │  │
│  │  - MEMORY.md - 自动记忆索引                               │  │
│  │  - Team memory - 团队共享知识                             │  │
│  │  - Session memory - 会话级上下文                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 关键文件索引

| 用途       | 文件路径                                         |
| ---------- | ------------------------------------------------ |
| 主执行循环 | `src/query.ts` (queryLoop at line 241)           |
| 查询编排   | `src/QueryEngine.ts`                             |
| 工具执行   | `src/services/tools/toolExecution.ts`            |
| 工具编排   | `src/services/tools/toolOrchestration.ts`        |
| 任务拆解   | `src/tools/TodoWriteTool/prompt.ts`              |
| 验证技能   | `src/skills/bundled/verify.ts`                   |
| 记忆系统   | `src/memdir/memdir.ts`                           |
| 上下文构建 | `src/context.ts`                                 |
| 完成判断   | `src/utils/queryHelpers.ts` (isResultSuccessful) |
| 协调模式   | `src/coordinator/coordinatorMode.ts`             |

---

## 附录 A: PeanutCafe 当前实现对比

### A.1 当前状态

| 功能     | Claude Code       | PeanutCafe       | 状态   |
| -------- | ----------------- | ---------------- | ------ |
| 任务拆解 | ✅ TodoWrite Tool | ⚠️ 简单 todo     | 待增强 |
| 执行循环 | ✅ ReAct Loop     | ✅ LangGraph     | 已实现 |
| 工具编排 | ✅ 并发/串行      | ❌ 无            | 需实现 |
| 结果观察 | ✅ 流式处理       | ✅ AsyncIterator | 已实现 |
| 验证机制 | ✅ /verify skill  | ❌ 无            | 需实现 |
| 完成判断 | ✅ 多条件判断     | ⚠️ 简单          | 待增强 |
| 记忆系统 | ✅ 多层记忆       | ❌ 无            | 需实现 |

### A.2 建议补齐优先级

| 优先级 | 功能         | 说明                 |
| ------ | ------------ | -------------------- |
| P0     | 工具并发控制 | 实现读写工具分区执行 |
| P0     | 验证机制     | 实现 /verify skill   |
| P1     | 任务拆解增强 | 增强 TodoWrite 功能  |
| P1     | 完成判断逻辑 | 多条件综合判断       |
| P2     | 记忆系统     | 多层记忆架构         |

---

**文档版本**: v1.0.0  
**最后更新**: 2026-04-03  
**分析依据**: Claude Code 源码 (`F:\AIProject\PeanutCafe\claude-code\src\`)
