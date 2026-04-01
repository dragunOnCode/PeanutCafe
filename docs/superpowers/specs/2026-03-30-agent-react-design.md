# Agent ReAct 模式实现设计

> **日期**: 2026-03-30
> **状态**: 设计中
> **目标**: 在每个 Agent 内部实现显式 ReAct (Reasoning + Acting) 循环，增强推理过程的透明度和可控性

---

## 1. 背景与目标

### 1.1 现状

当前系统的 Agent（如 `ClaudeAdapter`）通过 `streamGenerate` 方法实现了隐式的 tool-use 循环，但存在以下问题：

- **缺乏显式推理**：LLM 的思考过程隐藏在响应中，用户不可见
- **执行流程不透明**：无法追踪 "Thought → Action → Observation" 的完整链路
- **终止条件模糊**：依赖 LLM 自行决定是否继续，缺少明确的完成信号

### 1.2 目标

1. 在每个 Agent 内部实现显式 ReAct 循环
2. 通过结构化标签 (`<thought>`、`<action>`、`<observation>`、`<done>`) 输出推理过程
3. 支持流式输出，让用户实时看到 Agent 的思考步骤
4. 提供可配置的终止条件（LLM 声明完成 + 最大步数限制）
5. 与现有 LangGraph 工作流无缝集成

### 1.3 设计原则

- **混合模式**：保留现有 `streamGenerate`，新增 `executeWithReAct` 方法，场景可选
- **渐进改进**：不破坏现有流程，现有功能保持不变
- **原生函数调用兼容**：ReAct 复用现有 `ToolExecutorService` 的原生 function calling 机制，不改变工具调用本质
- **推理可视化**：XML 标签 (`<thought>`、`<observation>`、`<done>`) 仅用于推理过程输出，不参与工具调用

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     OrchestrationModule                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              LangGraph StateGraph                        │ │
│  │  START → HYDRATE → ROUTE → RUN_TASK → CHECK_OUTPUT     │ │
│  │                              ↓                          │ │
│  │              AWAIT_REVIEW ← HANDLE_ERROR                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              run_task 节点                              │  │
│  │  state.useReAct ?                                      │  │
│  │    agent.executeWithReAct()  ←── 新增 ReAct 循环        │  │
│  │    : agent.streamGenerate()   ←── 原有 tool-use 循环   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     AgentAdapter                             │
├─────────────────────────────────────────────────────────────┤
│  generate()           → 原有非流式生成                       │
│  streamGenerate()     → 原有隐式 tool-use 循环              │
│  executeWithReAct()  → 新增：显式 ReAct 循环               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    ReActExecutor                             │
├─────────────────────────────────────────────────────────────┤
│  - reasoning(): 生成 Thought                                 │
│  - decide(): 判断继续/完成/交接                              │
│  - action(): 执行工具调用                                    │
│  - observe(): 收集执行结果                                  │
│  - 终止条件: LLM 声明完成 + max_steps                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  ToolExecutorService                         │
│  parseToolCalls() / executeToolCall() / executeAllToolCalls │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 新增文件结构

```
src/agents/react/
├── react-executor.service.ts       # 核心 ReAct 循环实现
├── react-executor.service.spec.ts  # 单元测试
├── react-prompt.builder.ts         # ReAct 专用 prompt 构建
└── react-prompt.builder.spec.ts    # prompt 构建测试

config/prompts/_shared/
└── react.md                        # ReAct 模式 prompt 模板
```

---

## 3. 核心组件设计

### 3.1 ReActExecutorService

```typescript
// src/agents/react/react-executor.service.ts

export interface ReasoningStep {
  id: string;
  thought: string | null; // <thought> 标签内容
  toolCall: { name: string; args: Record<string, unknown> } | null; // 原生 function calling
  observation: string; // 执行结果
  isDone: boolean; // 是否已完成
  handoffAgent?: string; // 交接目标 Agent（来自 <handoff_agent>）
}

/**
 * ReAct 配置
 */
export interface ReActConfig {
  maxSteps: number; // 最大步数限制，默认 10
  sessionId: string;
  onThoughtChunk?: (chunk: string) => void; // Thought 流式回调
  onObservation?: (obs: string) => void; // Observation 完成回调
  onDone?: (result: string) => void; // 完成回调
}

/**
 * LLM 调用器类型
 * 由 Adapter 实现，持有 LLM client
 */
export type LLMCaller = (
  messages: ChatMessage[],
  tools: any[],
) => AsyncGenerator<{ content?: string; tool_calls?: any[] }>;

@Injectable()
export class ReActExecutorService {
  constructor(
    private readonly toolExecutorService: ToolExecutorService,
    private readonly llmCaller: LLMCaller,
  ) {}

  async *execute(messages: ChatMessage[], config: ReActConfig): AsyncGenerator<ReasoningStep> {
    // ReAct 循环实现
  }
}
```

### 3.2 ReActPromptBuilder

```typescript
// src/agents/react/react-prompt.builder.ts

export interface ReactPromptVars {
  name: string;
  role?: string; // Agent 角色描述，可选
  maxSteps: number;
  availableTools: string; // 工具描述
  taskDescription: string; // 当前任务
}

@Injectable()
export class ReactPromptBuilder {
  buildSystemPrompt(vars: ReactPromptVars): string {
    // 加载并插值 react.md 模板
  }

  buildInitialMessages(task: string, vars: ReactPromptVars): ChatMessage[] {
    // 构建初始 messages
  }
}
```

### 3.3 Agent 适配器变更

```typescript
// src/agents/adapters/claude.adapter.ts

// 新增方法
async *executeWithReAct(
  message: string,
  context: AgentContext,
  options?: { maxSteps?: number },
): AsyncGenerator<string> {
  // 实现 ReAct 循环
  // yield 出的内容包括：<thought>、<action>、<observation>、<done> 标签
}
```

---

## 4. ReAct 循环流程

### 4.1 循环状态机

```
┌─────────┐
│  START  │
└────┬────┘
     ▼
┌─────────┐  thought    ┌──────────┐
│ REASON  │ ──────────→  │ DECISION │
└─────────┘              └────┬─────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
          <done>        native func     <handoff_agent>
           (text)         call              (text)
               │               │               │
               ▼               ▼               ▼
            [END]         [OBSERVE]       [END]
                                 │             │
                                 ▼             │
                            ┌────────┐         │
                            │ NEXT? │ ────────┘
                            └────┬───┘
                                 │
               ┌──────────────────┼──────────────────┐
               ▼                  ▼                  ▼
            step < max      step >= max        解析失败
               │                  │                  │
               ▼                  ▼                  ▼
           [REASON]           [END]            [REASON]
```

**关键说明**：

- **Tool 调用**：使用原生 function calling，LLM 通过 `tool_calls` 参数请求调用，**不**通过 XML 标签
- **XML 标签**：仅用于推理过程可视化 (`<thought>`、`<observation>`、`<done>`、`<handoff_agent>`)

### 4.2 每步执行细节

**Step N: REASON 阶段**

```
1. LLM 收到当前 messages（包含历史 observation）
2. LLM 输出 <thought> 分析内容 </thought>
3. thought 内容流式 yield 给前端
4. 解析 decision：done / action / handoff
```

**Step N: ACTION 阶段**（如有工具调用）

```
1. LLM 通过原生 function calling 请求工具调用
2. 从 LLM response 的 tool_calls 字段解析工具名和参数
3. ToolExecutorService 执行工具
4. 执行结果封装为 <observation>
```

**Step N: OBSERVE 阶段**

```
1. 工具执行结果注入 messages
2. observation 内容 yield 给前端
3. 进入下一步 REASON 或结束
```

### 4.3 终止条件

| 条件                       | 行为                            |
| -------------------------- | ------------------------------- |
| LLM 输出 `<done>`          | 提取完成内容，结束循环          |
| 达到 `max_steps`           | 强制结束，返回已积累的步骤      |
| LLM 输出 `<handoff_agent>` | 触发 Agent 交接流程             |
| 解析失败（格式错误）       | 重试一次，仍失败则进入下一 step |

---

## 5. Markdown 中 XML 标签解析

### 5.1 边界情况分析

LLM 返回 Markdown 格式时，XML 标签可能出现以下变体：

| 场景         | 示例                                             |
| ------------ | ------------------------------------------------ |
| 裸标签       | `<thought>分析...</thought>`                     |
| 代码块内标签 | ` ```\n<thought>...</thought>\n``` `             |
| 转义标签     | `\<thought\>分析...\</thought\>`                 |
| 标签跨行     | `<thought>\n分析...\n</thought>`                 |
| 多余空白     | `<thought>  分析...  </thought>`                 |
| 嵌套代码块   | ` ```html\n<thought>```js\ncode\n```</thought> ` |

**注意**：工具调用通过原生 function calling 处理，不通过 XML 标签。XML 标签仅用于推理过程可视化。

### 5.2 解析策略

````typescript
// src/agents/react/utils/parse-react-tags.ts

export interface ParsedReactOutput {
  thought: string | null;
  observation: string | null;
  done: string | null;
  handoffAgent: string | null; // <handoff_agent>
  raw: string;
}

export function parseReactOutput(content: string): ParsedReactOutput {
  // 1. 还原 markdown 转义的标签
  let normalized = content.replace(/\\<(\w+)>\\/g, '<$1>'); // \<tag\> → <tag>

  // 2. 提取所有代码块内容（可能在代码块内）
  const codeBlocks = extractCodeBlocks(normalized);

  // 3. 优先从代码块内解析（更可靠）
  for (const block of codeBlocks) {
    const parsed = extractTagsFromText(block);
    if (parsed) return { ...parsed, raw: content };
  }

  // 4. 回退到裸标签解析
  return extractTagsFromText(normalized, { raw: content });
}

function extractTagsFromText(text: string, opts?: { raw?: string }): Partial<ParsedReactOutput> {
  const thought = extractSingleTag(text, 'thought');
  const observation = extractSingleTag(text, 'observation');
  const done = extractSingleTag(text, 'done');
  const handoffAgent = extractSingleTag(text, 'handoff_agent');

  return { thought, observation, done, handoffAgent, raw: opts?.raw ?? text };
}

function extractSingleTag(text: string, tagName: string): string | null {
  // 匹配标签内容，处理跨行和空白
  const pattern = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, 'i');
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```[\s\S]*?```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}
````

### 5.3 流式解析

```typescript
// 流式场景下的增量解析
export class StreamingReactParser {
  private buffer = '';
  private currentTag: string | null = null;
  private tagContent = '';
  private foundTags = new Set<string>();

  feed(chunk: string): Partial<ParsedReactOutput> {
    this.buffer += chunk;

    // 检测标签开始
    const openMatch = this.buffer.match(/<(\w+)>/);
    if (openMatch && !this.currentTag) {
      this.currentTag = openMatch[1];
      this.tagContent = '';
    }

    // 积累标签内容
    if (this.currentTag) {
      this.tagContent += chunk;

      // 检测标签关闭
      const closePattern = `</${this.currentTag}>`;
      if (this.tagContent.includes(closePattern)) {
        const tagName = this.currentTag;
        const content = this.tagContent.replace(closePattern, '').replace(/^[\s\n]+|[\s\n]+$/g, '');

        this.foundTags.add(tagName);

        const result: Partial<ParsedReactOutput> = {};
        result[tagName] = content;

        this.currentTag = null;
        this.tagContent = '';

        return result;
      }
    }

    return {};
  }

  isComplete(): boolean {
    return this.foundTags.has('done') || this.foundTags.has('handoff_agent');
  }
}
```

---

## 6. LangGraph 集成

### 6.1 WorkflowState 变更

```typescript
// src/orchestration/state/workflow.state.ts

export interface WorkflowState {
  // ... 现有字段 ...

  // 新增
  useReAct: boolean; // 是否启用 ReAct 模式，默认 true
  reactMaxSteps?: number; // ReAct 最大步数，默认 10
}
```

**注意**：`ReasoningStep` 类型将在 `workflow.state.ts` 中**替换**现有定义，而非新增。

### 6.2 run_task 节点变更

```typescript
// src/orchestration/graph/workflow.graph.ts

const createRunTaskNode = () =>
  // ... 现有依赖 ...
  {
    return async (state: WorkflowNodeState) => {
      // ... 现有初始化逻辑 ...

      let fullContent = '';

      if (state.useReAct) {
        // ReAct 模式
        for await (const chunk of agent.executeWithReAct(userMessage, context, {
          maxSteps: state.reactMaxSteps ?? 10,
        })) {
          fullContent += chunk;
          hooks?.onChunk(state.currentAgent, chunk);
        }
      } else {
        // 原有 tool-use 模式
        for await (const chunk of agent.streamGenerate(userMessage, context)) {
          fullContent += chunk;
          hooks?.onChunk(state.currentAgent, chunk);
        }
      }

      // ... 后续处理逻辑 ...
    };
  };
```

### 6.3 触发方式

通过 `state.metadata.useReAct` 布尔值切换 ReAct 模式，**默认开启**：

```typescript
// state.metadata 中的配置
{
  mentionedAgents: ['Claude'],
  metadata: {
    useReAct: true,        // 默认 true，可设置为 false 禁用
    reactMaxSteps: 15,     // 可选，默认 10
  }
}
```

**触发逻辑**：

- `useReAct === true`：调用 `agent.executeWithReAct()`
- `useReAct === false` 或未设置：调用 `agent.streamGenerate()`

---

## 7. Prompt 模板

### 7.1 ReAct 系统模板

```markdown
# config/prompts/\_shared/react.md

## ReAct 执行模式

你正在以 ReAct (Reasoning + Acting) 模式执行任务。

### 你的角色

{name}，负责 {role}。

### 任务

{taskDescription}

### 可用工具

{availableTools}

### 执行规则

1. **显式推理**：在执行工具前，先用 `<thought>` 标签输出你的思考过程
2. **保持简洁**：thought 聚焦于分析，不要冗长
3. **错误恢复**：工具执行失败后，继续思考下一步

### 输出格式

**必须使用以下 XML 标签进行推理可视化：**

#### 思考
```

<thought>
[你的分析：已了解什么信息，当前状态，下一步做什么]
</thought>
```

#### 获取结果

```
<observation>
[工具执行结果的简明总结]
</observation>
```

#### 完成任务

```
<done>
[最终回答或结果]
</done>
```

#### 交接（如需要）

```
<handoff_agent>
[目标Agent名称]
</handoff_agent>
```

### 终止条件

- 使用 `<done>` 标签输出最终结果后，任务结束
- 使用 `<handoff_agent>` 标签后，触发交接流程
- 最大执行步数：{maxSteps}（达到后强制结束）

### 示例

**输入**: "在当前目录创建一个 README.md 文件，内容为 # My Project"

**输出**:

```
<thought>
用户要求创建一个 README.md 文件。我需要使用 write_file 工具来完成这个任务。
</thought>
```

（工具调用通过 function calling 接口执行，不在 text 输出）

```
<observation>
文件已成功创建
</observation>
```

```
<done>
已完成 README.md 文件的创建。
</done>
```

---

## 8. 错误处理

### 8.1 错误场景与处理

| 场景             | 检测方式                   | 处理策略                         |
| ---------------- | -------------------------- | -------------------------------- |
| 工具执行失败     | `result.success === false` | 输出 error observation，继续循环 |
| 工具不存在       | `ToolNotFoundError`        | 输出 error observation，可重试   |
| LLM 输出格式错误 | 无法解析出有效标签         | 重试一次该 step                  |
| 超过 max_steps   | step 计数器                | 强制结束，yield 已积累的步骤     |
| 网络/API 错误    | 异常捕获                   | 进入 HANDLE_ERROR 节点           |

### 8.2 重试机制

```typescript
private async executeStepWithRetry(
  messages: ChatMessage[],
  config: ReActConfig,
  maxRetries = 1,
): Promise<ReasoningStep> {
  let attempts = 0;

  while (attempts <= maxRetries) {
    try {
      return await this.executeSingleStep(messages, config);
    } catch (parseError) {
      attempts++;
      if (attempts > maxRetries) {
        // 返回错误步骤，进入下一轮
        return {
          id: `step_${config.stepIndex}`,
          thought: `解析错误：` + parseError.message,
          action: null,
          observation: '',
          isDone: false,
        };
      }
    }
  }
}
```

---

## 9. 测试策略

### 9.1 单元测试

**ReactExecutorService**

- [ ] 正常执行多步循环
- [ ] 达到 max_steps 时正确终止
- [ ] LLM 输出 done 时正确终止
- [ ] 工具执行失败时继续执行
- [ ] handoff 时正确终止

**ReactPromptBuilder**

- [ ] 模板变量正确插值
- [ ] 缺少变量时使用默认值

**解析器**

- [ ] 裸标签解析
- [ ] 代码块内标签解析
- [ ] 转义标签还原
- [ ] 跨行标签解析
- [ ] 流式增量解析

### 9.2 集成测试

**与 LangGraph 集成**

- [ ] useReAct=true 时调用 executeWithReAct
- [ ] useReAct=false 时调用 streamGenerate
- [ ] reasoningSteps 正确记录

---

## 10. 后续计划

本次设计仅实现 **ReAct 循环机制**（Task 1）。

后续可继续实现：

- **Task 2**: Plan-And-Execute 模式 - 分离规划与执行阶段
- **Task 3**: Chain-of-Thought 可视化 - 前端展示推理链路
- **Task 4**: 多 Agent 协作增强 - 跨 Agent 的 ReAct 同步

---

## 附录

### A. 相关文件列表

| 文件                                              | 操作 | 说明                  |
| ------------------------------------------------- | ---- | --------------------- |
| `src/agents/react/react-executor.service.ts`      | 新增 | 核心 ReAct 循环       |
| `src/agents/react/react-executor.service.spec.ts` | 新增 | 单元测试              |
| `src/agents/react/react-prompt.builder.ts`        | 新增 | Prompt 构建           |
| `src/agents/react/react-prompt.builder.spec.ts`   | 新增 | Prompt 测试           |
| `src/agents/react/utils/parse-react-tags.ts`      | 新增 | 标签解析工具          |
| `config/prompts/_shared/react.md`                 | 新增 | ReAct prompt 模板     |
| `src/agents/adapters/claude.adapter.ts`           | 修改 | 新增 executeWithReAct |
| `src/agents/adapters/codex.adapter.ts`            | 修改 | 新增 executeWithReAct |
| `src/orchestration/state/workflow.state.ts`       | 修改 | 新增 useReAct 字段    |
| `src/orchestration/graph/workflow.graph.ts`       | 修改 | run_task 节点集成     |

### B. 参考资料

- [LangChain ReAct Agent](https://python.langchain.com/docs/modules/agents/agent_types/react)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/gpt/function-calling)
- [Anthropic Tool Use](https://docs.anthropic.com/claude/docs/tool-use)
