# Agent Workspace 工具能力设计

> **Goal:** 给 Agent 添加工具调用能力，支持自动执行 Workspace 文件操作和白名单命令执行。

## Architecture Overview

```
User Message → ChatGateway
    │
    ▼
MessageRouter → AgentRouter
    │
    ▼
Agent.streamGenerate()
    │
    ├─ 正常文本 → 直接流式返回
    │
    └─ 工具调用 (XML 标签格式)
            │
            ▼
        ToolExecutor (ChatGateway 中间层)
            │
            ├─ 解析 <tool_call> 标签
            ├─ 执行工具 (WorkspaceService / CommandExecutor)
            └─ 返回结果
                    │
                    ▼
        Agent 继续生成，包含工具结果
```

## Tool Definition

### Interface

```typescript
interface Tool {
  name: string; // 工具唯一标识
  description: string; // 工具描述，供 Agent 理解何时调用
  parameters: object; // JSON Schema for parameters
  execute: (args: Record<string, unknown>) => Promise<string>;
}
```

### Tool Registry

```typescript
// src/agents/tools/tool-registry.ts
const TOOLS: Tool[] = [
  {
    name: 'read_file',
    description: '读取文件内容。适用于查看代码、配置、文档等。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' }
      },
      required: ['path']
    },
    execute: async ({ path }) => { ... }
  },
  {
    name: 'write_file',
    description: '创建或覆写文件。适用于生成代码、配置、报告等。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    },
    execute: async ({ path, content }) => { ... }
  },
  {
    name: 'list_files',
    description: '列出目录中的文件。适用于查看项目结构。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（可选，默认 session workspace）' }
      }
    },
    execute: async ({ path }) => { ... }
  },
  {
    name: 'execute_command',
    description: '执行白名单内的 shell 命令。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '命令' },
        args: { type: 'array', items: { type: 'string' }, description: '命令参数' }
      },
      required: ['command']
    },
    execute: async ({ command, args }) => { ... }
  }
];
```

## Tool Call Protocol

### Agent 输出格式

Agent 返回工具调用时，使用 XML 标签包裹：

```xml
<tool_call>
{"name": "read_file", "args": {"path": "src/index.ts"}}
</tool_call>
```

### 工具执行结果注入

工具执行结果以特殊消息形式注入对话历史：

```typescript
interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  toolName: string;
  result: string; // 工具执行结果（字符串）
  timestamp: string;
}
```

注入后，Agent 可以看到结果并继续生成。

### 多次工具调用

Agent 可以连续调用多个工具：

```
<tool_call>{"name": "list_files", "args": {}}</tool_call>
<tool_call>{"name": "read_file", "args": {"path": "src/index.ts"}}</tool_call>
<tool_call>{"name": "write_file", "args": {"path": "src/test.ts", "content": "// new content"}}</tool_call>
```

所有工具调用执行完毕后，结果一并注入 context，Agent 生成最终回复。

## Command Executor - 白名单安全

### 白名单定义

```typescript
// src/agents/tools/command-executor.ts
const ALLOWED_COMMANDS = new Set([
  // Git
  'git',
  // Node.js
  'npm',
  'node',
  'npx',
  'pnpm',
  'yarn',
  // Python
  'python',
  'pip',
  'python3',
  // Shell utilities
  'ls',
  'cat',
  'find',
  'grep',
  'echo',
  'pwd',
  'mkdir',
  'touch',
  'rm',
  'cp',
  'mv',
  'cd',
  // Build tools
  'make',
  'cmake',
  'gcc',
  'g++',
  // GitHub CLI
  'gh',
]);

const BLOCKED_PATTERNS = [';', '&&', '||', '|', '>', '<', '`', '$', '\\n'];
```

### 命令验证

```typescript
function validateCommand(command: string, args: string[]): boolean {
  if (!ALLOWED_COMMANDS.has(command)) return false;

  const fullCommand = [command, ...args].join(' ');
  for (const pattern of BLOCKED_PATTERNS) {
    if (fullCommand.includes(pattern)) return false;
  }

  return true;
}
```

### 执行限制

- 每个命令最多执行 30 秒
- 总输出限制 1MB
- 单 session 并发执行限制 1 个命令

## Component Design

### 1. ToolRegistry

**File:** `src/agents/tools/tool-registry.ts`

职责：

- 注册所有可用工具
- 提供工具查找接口
- 验证工具参数

```typescript
@Injectable()
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  registerTool(tool: Tool): void;
  getTool(name: string): Tool | undefined;
  getAllTools(): Tool[];
  validateParameters(toolName: string, args: unknown): boolean;
}
```

### 2. CommandExecutor

**File:** `src/agents/tools/command-executor.ts`

职责：

- 执行白名单命令
- 超时控制
- 输出截断

```typescript
@Injectable()
export class CommandExecutor {
  async execute(command: string, args: string[]): Promise<CommandResult>;
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}
```

### 3. ToolExecutorService

**File:** `src/agents/tools/tool-executor.service.ts`

职责：

- 解析 Agent 输出的工具调用 XML
- 执行工具并返回结果
- 处理执行错误

```typescript
@Injectable()
export class ToolExecutorService {
  parseToolCalls(output: string): ToolCall[];
  executeToolCall(toolCall: ToolCall): Promise<string>;
  executeAllToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]>;
}
```

### 4. Agent Adapter 修改

每个 Agent Adapter (`ClaudeAdapter`, `CodexAdapter`, `GeminiAdapter`) 需要：

1. 在 `streamGenerate` 中检测 `<tool_call>` 标签
2. 提取工具调用但不输出给用户
3. 调用 `ToolExecutorService` 执行工具
4. 将结果注入 `conversationHistory`
5. 继续生成

修改点：

- `src/agents/adapters/claude.adapter.ts`
- `src/agents/adapters/codex.adapter.ts`
- `src/agents/adapters/gemini.adapter.ts`

### 5. ChatGateway 修改

- 注入 `ToolExecutorService`
- 工具执行在 Agent 生成过程中进行（不需要额外修改流式输出逻辑）

## Tool Results Injection

工具结果注入到 conversationHistory 的格式：

```typescript
const toolResultMessage: Message = {
  id: generateMessageId(),
  sessionId: context.sessionId,
  role: 'tool',
  content: JSON.stringify({
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result: executionResult,
    success: true,
  }),
  timestamp: new Date(),
};
```

Agent system prompt 需要更新，告知 Agent：

1. 何时应该使用工具
2. 如何格式化工具调用
3. 如何解读工具结果

## Error Handling

| 场景           | 处理方式                            |
| -------------- | ----------------------------------- |
| 工具不存在     | 返回错误消息给 Agent                |
| 参数验证失败   | 返回错误消息给 Agent                |
| 文件不存在     | 返回 "File not found" 给 Agent      |
| 命令不在白名单 | 返回 "Command not allowed" 给 Agent |
| 命令执行超时   | 返回 "Command timed out" 给 Agent   |
| 权限不足       | 返回 "Permission denied" 给 Agent   |

## Files to Create/Modify

### New Files

- `src/agents/tools/tool-registry.ts` - 工具注册表
- `src/agents/tools/command-executor.ts` - 命令执行器
- `src/agents/tools/tool-executor.service.ts` - 工具执行服务
- `src/agents/tools/index.ts` - 导出

### Modify Files

- `src/agents/adapters/claude.adapter.ts` - 添加工具调用检测和执行
- `src/agents/adapters/codex.adapter.ts` - 同上
- `src/agents/adapters/gemini.adapter.ts` - 同上
- `src/agents/agents.module.ts` - 注册新服务
- `src/agents/interfaces/llm-adapter.interface.ts` - 添加 toolCalls 字段到 context

## Testing

### Unit Tests

- `ToolRegistry` - 工具注册和查找
- `CommandExecutor` - 白名单验证、超时处理
- `ToolExecutorService` - 解析和执行

### Integration Tests

- Agent 生成工具调用 → 执行 → 结果注入 → 继续生成

### Manual Testing

1. 启动后端
2. 连接 WebSocket
3. 发送：`@Claude 列出当前目录文件`
4. 验证 Agent 调用 `list_files` 工具并返回结果
5. 发送：`@Claude 创建 test.js，内容是 console.log("hello")`
6. 验证文件被创建

## Dependencies

无新依赖。使用 Node.js 内置 `child_process` 执行命令。
