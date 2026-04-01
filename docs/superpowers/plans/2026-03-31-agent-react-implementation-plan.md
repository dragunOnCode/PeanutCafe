# Agent ReAct 模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在每个 Agent 内部实现显式 ReAct (Reasoning + Acting) 循环，通过结构化标签输出推理过程

**Architecture:** ReAct 循环复用现有 `ToolExecutorService` 的原生 function calling 机制，XML 标签 (`<thought>`、`<observation>`、`<done>`、`<handoff_agent>`) 仅用于推理过程可视化，不参与工具调用

**Tech Stack:** TypeScript, LangGraph StateGraph, OpenAI Function Calling

---

## 文件结构

### 新建文件


| 文件                                                | 职责                 |
| ------------------------------------------------- | ------------------ |
| `src/agents/react/react-executor.service.ts`      | 核心 ReAct 循环实现      |
| `src/agents/react/react-executor.service.spec.ts` | ReAct 循环单元测试       |
| `src/agents/react/react-prompt.builder.ts`        | ReAct 专用 prompt 构建 |
| `src/agents/react/react-prompt.builder.spec.ts`   | Prompt 构建测试        |
| `src/agents/react/utils/parse-react-tags.ts`      | XML 标签解析工具         |
| `config/prompts/_shared/react.md`                 | ReAct 模式 prompt 模板 |


### 修改文件


| 文件                                          | 变更                                           |
| ------------------------------------------- | -------------------------------------------- |
| `src/orchestration/state/workflow.state.ts` | 替换 `ReasoningStep` 类型，新增 `useReAct: boolean` |
| `src/agents/adapters/claude.adapter.ts`     | 新增 `executeWithReAct()` 方法                   |
| `src/agents/adapters/codex.adapter.ts`      | 新增 `executeWithReAct()` 方法                   |
| `src/orchestration/graph/workflow.graph.ts` | `run_task` 节点根据 `useReAct` 切换调用              |


---

## 任务分解

### Task 1: 更新 WorkflowState 类型

**Files:**

- Modify: `src/orchestration/state/workflow.state.ts`
- **Step 1: 读取现有 WorkflowState 定义**

查看现有 `ReasoningStep` 接口和 `WorkflowState` 接口

- **Step 2: 替换 ReasoningStep 类型**

```typescript
export interface ReasoningStep {
  id: string;
  thought: string | null;
  toolCall: { name: string; args: Record<string, unknown> } | null;
  observation: string;
  isDone: boolean;
  handoffAgent?: string;
}
```

- **Step 3: 添加 useReAct 字段到 WorkflowState**

```typescript
export interface WorkflowState {
  // ... 现有字段保持不变 ...

  // 新增 ReAct 相关
  useReAct: boolean; // 默认 true
  reactMaxSteps?: number; // 默认 10
}
```

- **Step 4: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- **Step 5: 提交**

```bash
git add src/orchestration/state/workflow.state.ts
git commit -m "feat(workflow): update WorkflowState for ReAct mode"
```

---

### Task 2: 实现 XML 标签解析工具

**Files:**

- Create: `src/agents/react/utils/parse-react-tags.ts`
- Create: `src/agents/react/utils/parse-react-tags.spec.ts`
- **Step 1: 编写解析工具测试**

```typescript
// src/agents/react/utils/parse-react-tags.spec.ts

import { parseReactOutput, StreamingReactParser } from './parse-react-tags';

describe('parseReactOutput', () => {
  it('解析裸标签', () => {
    const result = parseReactOutput('<thought>分析中</thought>');
    expect(result.thought).toBe('分析中');
  });

  it('解析带空白的标签', () => {
    const result = parseReactOutput('<thought>  分析中  </thought>');
    expect(result.thought).toBe('分析中');
  });

  it('解析跨行标签', () => {
    const result = parseReactOutput('<thought>\n分析中\n</thought>');
    expect(result.thought).toBe('分析中');
  });

  it('解析 done 标签', () => {
    const result = parseReactOutput('<done>完成</done>');
    expect(result.done).toBe('完成');
  });

  it('解析 handoff_agent 标签', () => {
    const result = parseReactOutput('<handoff_agent>Claude</handoff_agent>');
    expect(result.handoffAgent).toBe('Claude');
  });

  it('还原转义标签', () => {
    const result = parseReactOutput('\\<thought\\>分析中\\</thought\\>');
    expect(result.thought).toBe('分析中');
  });

  it('代码块内标签解析', () => {
    const result = parseReactOutput('```\n<thought>分析中</thought>\n```');
    expect(result.thought).toBe('分析中');
  });

  it('无标签时返回 null', () => {
    const result = parseReactOutput('这只是普通文本');
    expect(result.thought).toBeNull();
    expect(result.done).toBeNull();
  });

  it('observation 标签解析', () => {
    const result = parseReactOutput('<observation>工具结果</observation>');
    expect(result.observation).toBe('工具结果');
  });
});

describe('StreamingReactParser', () => {
  it('增量解析 thought 标签', () => {
    const parser = new StreamingReactParser();
    const chunk1 = parser.feed('<though');
    const chunk2 = parser.feed('t>分析');
    const chunk3 = parser.feed('中</thought>');

    expect(chunk3.thought).toBe('分析中');
  });

  it('isComplete 返回 done 状态', () => {
    const parser = new StreamingReactParser();
    parser.feed('<done>完成</done>');
    expect(parser.isComplete()).toBe(true);
  });

  it('isComplete 返回 handoff_agent 状态', () => {
    const parser = new StreamingReactParser();
    parser.feed('<handoff_agent>Target</handoff_agent>');
    expect(parser.isComplete()).toBe(true);
  });

  it('多个标签顺序解析', () => {
    const parser = new StreamingReactParser();
    const result1 = parser.feed('<thought>思考</thought>');
    const result2 = parser.feed('<done>完成</done>');

    expect(result1.thought).toBe('思考');
    expect(result2.done).toBe('完成');
    expect(parser.isComplete()).toBe(true);
  });
});
```

- **Step 2: 运行测试验证失败**

Run: `npm test -- --testPathPattern="parse-react-tags" --failOnEmptyTestSuite`
Expected: FAIL - module not found

- **Step 3: 实现解析工具**

```typescript
// src/agents/react/utils/parse-react-tags.ts

export interface ParsedReactOutput {
  thought: string | null;
  observation: string | null;
  done: string | null;
  handoffAgent: string | null;
  raw: string;
}

export function parseReactOutput(content: string): ParsedReactOutput {
  let normalized = content.replace(/\\<(\w+)>\\/g, '<$1>');

  const codeBlocks = extractCodeBlocks(normalized);
  for (const block of codeBlocks) {
    const parsed = extractTagsFromText(block);
    if (parsed) return { ...parsed, raw: content };
  }

  return extractTagsFromText(normalized, { raw: content });
}

function extractTagsFromText(text: string, opts?: { raw?: string }): Partial<ParsedReactOutput> {
  return {
    thought: extractSingleTag(text, 'thought'),
    observation: extractSingleTag(text, 'observation'),
    done: extractSingleTag(text, 'done'),
    handoffAgent: extractSingleTag(text, 'handoff_agent'),
    raw: opts?.raw ?? text,
  };
}

function extractSingleTag(text: string, tagName: string): string | null {
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

export class StreamingReactParser {
  private buffer = '';
  private currentTag: string | null = null;
  private tagContent = '';
  private foundTags = new Set<string>();

  feed(chunk: string): Partial<ParsedReactOutput> {
    this.buffer += chunk;

    const openMatch = this.buffer.match(/<(\w+)>/);
    if (openMatch && !this.currentTag) {
      this.currentTag = openMatch[1];
      this.tagContent = '';
    }

    if (this.currentTag) {
      this.tagContent += chunk;

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

- **Step 4: 运行测试验证通过**

Run: `npm test -- --testPathPattern="parse-react-tags"`
Expected: PASS

- **Step 5: 提交**

```bash
git add src/agents/react/utils/parse-react-tags.ts src/agents/react/utils/parse-react-tags.spec.ts
git commit -m "feat(react): add XML tag parsing utilities for ReAct"
```

---

### Task 3: 创建 ReAct Prompt 模板

**Files:**

- Create: `config/prompts/_shared/react.md`
- **Step 1: 创建 ReAct prompt 模板**

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

[你的分析：已了解什么信息，当前状态，下一步做什么] ```

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
- **注意：只使用LLM返回的最后一条消息来判断`<done>`标签以及`<handoff_agent>`标签，不应该在全量的对话历史中匹配**

```

- [ ] **Step 2: 提交**

```bash
git add config/prompts/_shared/react.md
git commit -m "feat(prompts): add ReAct mode prompt template"
```

- **Step 2: 验证模板文件包含所有必要变量**

检查模板文件 `config/prompts/_shared/react.md` 包含以下变量占位符：

- `{name}` - Agent 名称
- `{role}` - Agent 角色（可选）
- `{taskDescription}` - 任务描述
- `{availableTools}` - 可用工具列表
- `{maxSteps}` - 最大步数

Run: `rg '\{(name|role|taskDescription|availableTools|maxSteps)\}' config/prompts/_shared/react.md`
Expected: 找到 5 处变量占位符

- **Step 3: 提交**

```bash
git add config/prompts/_shared/react.md
git commit -m "feat(prompts): add ReAct mode prompt template"
```

---

### Task 4: 实现 ReactPromptBuilder

**Files:**

- Create: `src/agents/react/react-prompt.builder.ts`
- Create: `src/agents/react/react-prompt.builder.spec.ts`
- **Step 1: 编写 ReactPromptBuilder 测试**

```typescript
// src/agents/react/react-prompt.builder.spec.ts

import { ReactPromptBuilder } from './react-prompt.builder';

describe('ReactPromptBuilder', () => {
  let builder: ReactPromptBuilder;

  beforeEach(() => {
    builder = new ReactPromptBuilder();
  });

  it('构建系统 prompt 时插值变量', () => {
    const prompt = builder.buildSystemPrompt({
      name: 'Claude',
      role: '代码审查',
      taskDescription: '审查代码质量',
      availableTools: 'read_file, write_file',
      maxSteps: 10,
    });

    expect(prompt).toContain('Claude');
    expect(prompt).toContain('代码审查');
    expect(prompt).toContain('审查代码质量');
    expect(prompt).toContain('read_file, write_file');
    expect(prompt).toContain('10');
  });

  it('使用默认 maxSteps', () => {
    const prompt = builder.buildSystemPrompt({
      name: 'Claude',
      role: '测试',
      taskDescription: '测试任务',
      availableTools: '',
    });

    expect(prompt).toContain('10');
  });
});
```

- **Step 2: 运行测试验证失败**

Run: `npm test -- --testPathPattern="react-prompt.builder" --failOnEmptyTestSuite`
Expected: FAIL - module not found

- **Step 3: 实现 ReactPromptBuilder**

```typescript
// src/agents/react/react-prompt.builder.ts

import { Injectable } from '@nestjs/common';
import * as fs from 'path';
import { PromptBuilder } from '../../prompts/prompt-builder';

export interface ReactPromptVars {
  name: string;
  role: string;
  taskDescription: string;
  availableTools: string;
  maxSteps: number;
}

@Injectable()
export class ReactPromptBuilder {
  constructor(private readonly promptBuilder: PromptBuilder) {}

  buildSystemPrompt(vars: Partial<ReactPromptVars> & { name: string; taskDescription: string }): string {
    const templatePath = 'config/prompts/_shared/react.md';

    const resolvedVars = {
      name: vars.name,
      role: vars.role ?? '通用助手',
      taskDescription: vars.taskDescription,
      availableTools: vars.availableTools ?? '无可用工具',
      maxSteps: vars.maxSteps ?? 10,
    };

    return this.promptBuilder.buildFromTemplate(templatePath, resolvedVars);
  }

  buildInitialMessages(task: string, vars: ReactPromptVars): ChatMessage[] {
    const systemPrompt = this.buildSystemPrompt(vars);
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

- **Step 4: 运行测试验证通过**

Run: `npm test -- --testPathPattern="react-prompt.builder"`
Expected: PASS

- **Step 5: 提交**

```bash
git add src/agents/react/react-prompt.builder.ts src/agents/react/react-prompt.builder.spec.ts
git commit -m "feat(react): add ReactPromptBuilder"
```

---

### Task 5: 实现 ReActExecutorService

**Files:**

- Create: `src/agents/react/react-executor.service.ts`
- Create: `src/agents/react/react-executor.service.spec.ts`
- **Step 1: 编写 ReActExecutorService 测试**

```typescript
// src/agents/react/react-executor.service.spec.ts

import { ReActExecutorService, ReActConfig, ReasoningStep } from './react-executor.service';

describe('ReActExecutorService', () => {
  let service: ReActExecutorService;
  let mockToolExecutor: any;
  let mockLLMCaller: jest.Mock;

  beforeEach(() => {
    mockToolExecutor = {
      executeToolCall: jest.fn(),
      getOpenAITools: jest.fn().mockReturnValue([]),
    };
    // mock LLM caller: returns async generator
    mockLLMCaller = jest.fn();
    service = new ReActExecutorService(mockToolExecutor, mockLLMCaller);
  });

  it('达到 max_steps 时正确终止', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 2,
      sessionId: 'test',
    };

    // Mock LLM 返回 thought 但没有工具调用，触发空循环直到 max_steps
    mockLLMCaller.mockImplementation(async function* () {
      yield '<thought>thinking</thought>';
    });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    expect(steps.length).toBeLessThanOrEqual(2);
  });

  it('LLM 输出 done 时正确终止', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 10,
      sessionId: 'test',
    };

    mockLLMCaller.mockImplementation(async function* () {
      yield '<thought>分析完毕</thought>';
      yield '<done>最终答案</done>';
    });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    expect(steps.length).toBe(1);
    expect(steps[0].isDone).toBe(true);
    expect(steps[0].thought).toBe('分析完毕');
  });

  it('工具执行失败时继续执行', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 10,
      sessionId: 'test',
    };

    let callCount = 0;
    mockLLMCaller.mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        yield '<thought>需要调用工具</thought>';
      } else {
        yield '<done>任务完成</done>';
      }
    });

    // 第一次工具调用失败，第二次成功
    mockToolExecutor.executeToolCall
      .mockResolvedValueOnce({ success: false, error: 'Tool error', result: '' })
      .mockResolvedValueOnce({ success: true, result: 'success', toolCallId: '1', toolName: 'test' });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    // 应该有两次 step，一次工具调用失败后继续
    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  it('LLM 输出 handoff_agent 时正确终止', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 10,
      sessionId: 'test',
    };

    mockLLMCaller.mockImplementation(async function* () {
      yield '<thought>需要交接</thought>';
      yield '<handoff_agent>TargetAgent</handoff_agent>';
    });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    expect(steps.length).toBe(1);
    expect(steps[0].handoffAgent).toBe('TargetAgent');
  });
});
```

- **Step 2: 运行测试验证失败**

Run: `npm test -- --testPathPattern="react-executor.service" --failOnEmptyTestSuite`
Expected: FAIL - module not found

- **Step 3: 实现 ReActExecutorService（带错误处理和重试）**

```typescript
// src/agents/react/react-executor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ToolExecutorService, ToolCall } from '../tools/tool-executor.service';
import { StreamingReactParser } from './utils/parse-react-tags';

export interface ReasoningStep {
  id: string;
  thought: string | null;
  toolCall: { name: string; args: Record<string, unknown> } | null;
  observation: string;
  isDone: boolean;
  handoffAgent?: string;
}

export interface ReActConfig {
  maxSteps: number;
  sessionId: string;
  onThoughtChunk?: (chunk: string) => void;
  onObservation?: (obs: string) => void;
  onDone?: (result: string) => void;
}

export type LLMCaller = (
  messages: ChatMessage[],
  tools: any[],
) => AsyncGenerator<{ content?: string; tool_calls?: any[] }>;

@Injectable()
export class ReActExecutorService {
  private readonly logger = new Logger(ReActExecutorService.name);

  constructor(
    private readonly toolExecutorService: ToolExecutorService,
    private readonly llmCaller: LLMCaller,
  ) {}

  async *execute(messages: ChatMessage[], config: ReActConfig): AsyncGenerator<ReasoningStep> {
    const parser = new StreamingReactParser();
    let stepCount = 0;
    const tools = this.toolExecutorService.getOpenAITools();

    while (stepCount < config.maxSteps) {
      const stepId = `step_${stepCount}`;

      let response: AsyncGenerator<{ content?: string; tool_calls?: any[] }>;
      try {
        response = this.llmCaller(messages, tools);
      } catch (error) {
        this.logger.error(`LLM call failed: ${error.message}`);
        yield this.createErrorStep(stepId, `LLM 调用失败: ${error.message}`);
        return;
      }

      let fullContent = '';
      let toolCallsFromResponse: ToolCall[] = [];

      try {
        for await (const chunk of response) {
          if (chunk.content) {
            fullContent += chunk.content;
            const parsed = parser.feed(chunk.content);
            if (parsed.thought) {
              config.onThoughtChunk?.(parsed.thought);
            }
          }
          if (chunk.tool_calls) {
            toolCallsFromResponse = this.parseToolCalls(chunk.tool_calls);
          }
        }
      } catch (error) {
        this.logger.error(`LLM streaming failed: ${error.message}`);
        yield this.createErrorStep(stepId, `LLM 流式响应失败: ${error.message}`);
        return;
      }

      const parsed = parser.feed('');

      // 检查 done
      if (parsed.done) {
        config.onDone?.(parsed.done);
        yield {
          id: stepId,
          thought: parsed.thought ?? null,
          toolCall: null,
          observation: '',
          isDone: true,
        };
        return;
      }

      // 检查 handoff
      if (parsed.handoff_agent) {
        yield {
          id: stepId,
          thought: parsed.thought ?? null,
          toolCall: null,
          observation: '',
          isDone: false,
          handoffAgent: parsed.handoff_agent,
        };
        return;
      }

      // 检查工具调用
      if (toolCallsFromResponse.length > 0 && parsed.thought) {
        const toolCall = toolCallsFromResponse[0];

        // 执行工具调用，带重试
        const toolResult = await this.executeWithRetry(toolCall, stepId);

        if (!toolResult.success) {
          this.logger.warn(`Tool ${toolCall.name} failed: ${toolResult.error}`);
        }

        config.onObservation?.(toolResult.result ?? '');

        messages.push({ role: 'assistant', content: `<thought>${parsed.thought}</thought>` });
        messages.push({ role: 'user', content: `<observation>${toolResult.result ?? toolResult.error}</observation>` });

        yield {
          id: stepId,
          thought: parsed.thought,
          toolCall: { name: toolCall.name, args: toolCall.args },
          observation: toolResult.result ?? '',
          isDone: false,
        };

        stepCount++;
      }
    }

    // 达到 max_steps 限制
    this.logger.log(`ReAct loop reached max_steps limit: ${config.maxSteps}`);
  }

  private async executeWithRetry(
    toolCall: ToolCall,
    stepId: string,
    maxRetries = 1,
  ): Promise<{ success: boolean; result?: string; error?: string }> {
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        const result = await this.toolExecutorService.executeToolCall(toolCall);
        return {
          success: result.success,
          result: result.result,
          error: result.error,
        };
      } catch (error) {
        attempts++;
        if (attempts > maxRetries) {
          return {
            success: false,
            error: `工具执行失败 (${attempts} 次尝试): ${error.message}`,
          };
        }
        this.logger.warn(`Tool execution attempt ${attempts} failed: ${error.message}`);
      }
    }

    return { success: false, error: '工具执行失败' };
  }

  private parseToolCalls(toolCalls: any[]): ToolCall[] {
    return toolCalls.map((tc, index) => ({
      id: tc.id ?? `tc_${Date.now()}_${index}`,
      name: tc.function?.name ?? tc.name,
      args:
        typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments ?? tc.arguments ?? {}),
    }));
  }

  private createErrorStep(stepId: string, errorMessage: string): ReasoningStep {
    return {
      id: stepId,
      thought: null,
      toolCall: null,
      observation: '',
      isDone: false,
    };
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

- **Step 4: 运行测试验证通过**

Run: `npm test -- --testPathPattern="react-executor.service"`
Expected: PASS (4 tests: 达到 max_steps, 输出 done, 工具失败继续, handoff)

- **Step 5: 提交**

```bash
git add src/agents/react/react-executor.service.ts src/agents/react/react-executor.service.spec.ts
git commit -m "feat(react): add ReActExecutorService"
```

---

### Task 6: 在 ClaudeAdapter 中添加 executeWithReAct

**Files:**

- Modify: `src/agents/adapters/claude.adapter.ts`
- **Step 1: 读取 ClaudeAdapter 现有实现**

确认现有方法签名、LLM client 使用方式和 `buildMessages` 方法

- **Step 2: 添加 executeWithReAct 方法和 LLMCaller**

在 `ClaudeAdapter` 类中添加：

```typescript
async *executeWithReAct(
  message: string,
  context: AgentContext,
  options?: { maxSteps?: number },
): AsyncGenerator<string> {
  this.status = AgentStatus.BUSY;
  this.toolExecutorService.registerSessionTools(context.sessionId);
  const tools = this.toolExecutorService.getOpenAITools();

  const messages: NativeMessage[] = [
    ...(await this.buildMessages(context)),
    { role: 'user', content: message },
  ];

  const llmCaller: LLMCaller = async function* (msgs, _tools) {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: msgs,
      tools: _tools.length > 0 ? _tools : undefined,
      tool_choice: _tools.length > 0 ? 'auto' : undefined,
      temperature: 0.7,
      max_tokens: 4000,
      stream: true,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
        yield { content: delta.content };
      }
      if (delta?.tool_calls) {
        yield { tool_calls: delta.tool_calls };
      }
    }
  }.bind(this);

  const executor = new ReActExecutorService(this.toolExecutorService, llmCaller);

  const config: ReActConfig = {
    maxSteps: options?.maxSteps ?? 10,
    sessionId: context.sessionId,
    onThoughtChunk: (chunk) => {},
    onObservation: (obs) => {},
    onDone: (result) => {},
  };

  try {
    for await (const step of executor.execute(messages, config)) {
      if (step.thought) {
        yield `<thought>${step.thought}</thought>`;
      }
      if (step.observation) {
        yield `<observation>${step.observation}</observation>`;
      }
      if (step.isDone) {
        yield `<done>${step.observation}</done>`;
      }
      if (step.handoffAgent) {
        yield `<handoff_agent>${step.handoffAgent}</handoff_agent>`;
      }
    }
  } finally {
    this.status = AgentStatus.ONLINE;
  }
}
```

- **Step 3: 添加 ReActExecutorService 和类型导入**

```typescript
import { ReActExecutorService, ReActConfig, LLMCaller } from '../react/react-executor.service';
import type { NativeMessage } from '../../types';
```

- **Step 4: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- **Step 5: 提交**

```bash
git add src/agents/adapters/claude.adapter.ts
git commit -m "feat(claude): add executeWithReAct method"
```

---

### Task 7: 在 CodexAdapter/GeminiAdapter 中添加 executeWithReAct

**Files:**

- Modify: `src/agents/adapters/codex.adapter.ts` & `src/agents/adapters/gemini.adapter.ts`
- **Step 1: 读取 CodexAdapter / GeminiAdapter 现有实现**

确认现有 `streamGenerate` 实现方式和 LLM client 使用

- **Step 2: 添加 executeWithReAct 方法（参考 Task 6 ClaudeAdapter 实现）**

复制 Task 6 的实现模式，但使用 Codex / Gemini 的 LLM client (`this.client`) 和模型配置

- **Step 3: 添加类型导入**

```typescript
import { ReActExecutorService, ReActConfig, LLMCaller } from '../react/react-executor.service';
```

- **Step 4: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- **Step 5: 提交**

```bash
git add src/agents/adapters/codex.adapter.ts
git add src/agents/adapters/gemini.adapter.ts
git commit -m "feat(codex): add executeWithReAct method"
```

---

### Task 8: 集成 ReAct 到 WorkflowGraph

**Files:**

- Modify: `src/orchestration/graph/workflow.graph.ts`
- **Step 1: 读取 workflow.graph.ts 中的 run_task 节点实现**

确认现有逻辑和状态访问方式

- **Step 2: 修改 run_task 节点添加 useReAct 切换**

在 `createRunTaskNode` 函数中添加：

```typescript
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
```

- **Step 3: 确保默认 useReAct 为 true**

在 `HYDRATE` 节点或初始状态设置中：

```typescript
// 如果 useReAct 未设置，默认为 true
state.useReAct = state.useReAct ?? true;
```

- **Step 4: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误

- **Step 5: 提交**

```bash
git add src/orchestration/graph/workflow.graph.ts
git commit -m "feat(workflow): integrate ReAct mode in run_task node"
```

---

### Task 9: 最终集成测试

**Files:**

- Integration test (可选，如果项目有集成测试框架)
- **Step 1: 运行所有测试**

Run: `npm test`
Expected: 所有测试通过

- **Step 2: 运行 lint**

Run: `npm run lint`
Expected: 无错误

- **Step 3: 运行 typecheck**

Run: `npm run typecheck`
Expected: 无错误

---

## 执行顺序

1. Task 1: 更新 WorkflowState 类型
2. Task 2: 实现 XML 标签解析工具
3. Task 3: 创建 ReAct Prompt 模板
4. Task 4: 实现 ReactPromptBuilder
5. Task 5: 实现 ReActExecutorService
6. Task 6: 在 ClaudeAdapter 中添加 executeWithReAct
7. Task 7: 在 CodexAdapter 中添加 executeWithReAct
8. Task 8: 集成 ReAct 到 WorkflowGraph
9. Task 9: 最终集成测试

