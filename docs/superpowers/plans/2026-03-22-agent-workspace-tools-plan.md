# Agent Workspace Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Agent 添加工具调用能力，支持 Workspace 文件操作和白名单命令执行。

**Architecture:** ToolRegistry 统一管理工具，ToolExecutorService 解析 Agent 输出的 XML 标签并执行工具，CommandExecutor 处理白名单命令执行。

**Tech Stack:** Node.js child_process, NestJS

---

## File Structure

```
src/agents/tools/
├── index.ts                      # 导出
├── tool-registry.ts             # 工具注册表
├── tool-registry.spec.ts        # 测试
├── command-executor.ts          # 命令执行器
├── command-executor.spec.ts    # 测试
└── tool-executor.service.ts    # 工具执行服务
```

---

## Task 1: 创建工具接口和目录

**Files:**

- Create: `src/agents/tools/index.ts`
- Create: `src/agents/tools/tool-registry.ts` (interface only)
- Create: `src/agents/tools/command-executor.ts` (interface only)

- [ ] **Step 1: 创建目录和基础文件**

在 `src/agents/tools/` 下创建：

`index.ts`:

```typescript
export * from './tool-registry';
export * from './command-executor';
export * from './tool-executor.service';
```

- [ ] **Step 2: 提交**

```bash
git add src/agents/tools/
git commit -m "feat(agents): add tools directory structure"
```

---

## Task 2: 实现 ToolRegistry

**Files:**

- Modify: `src/agents/tools/tool-registry.ts`

- [ ] **Step 1: 实现 ToolRegistry**

```typescript
// src/agents/tools/tool-registry.ts
import { Injectable, Logger } from '@nestjs/common';

export interface Tool {
  name: string;
  description: string;
  parameters: object;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool ${tool.name} already registered, skipping`);
      return;
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered tool: ${tool.name}`);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  validateParameters(toolName: string, args: unknown): boolean {
    const tool = this.getTool(toolName);
    if (!tool) return false;
    // Basic validation - just check args is an object
    return typeof args === 'object' && args !== null;
  }
}
```

- [ ] **Step 2: 创建 ToolRegistry 测试**

```typescript
// src/agents/tools/tool-registry.spec.ts
import { ToolRegistry, Tool } from './tool-registry';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('registerTool', () => {
    it('should register a tool', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };
      registry.registerTool(tool);
      expect(registry.getTool('test_tool')).toBe(tool);
    });

    it('should not duplicate tools', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };
      registry.registerTool(tool);
      registry.registerTool(tool); // duplicate
      const tools = registry.getAllTools();
      expect(tools).toHaveLength(1);
    });
  });

  describe('getTool', () => {
    it('should return undefined for non-existent tool', () => {
      expect(registry.getTool('non_existent')).toBeUndefined();
    });
  });

  describe('validateParameters', () => {
    it('should return true for valid args', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };
      registry.registerTool(tool);
      expect(registry.validateParameters('test_tool', {})).toBe(true);
    });

    it('should return false for null args', () => {
      expect(registry.validateParameters('test_tool', null)).toBe(false);
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- --testPathPatterns="tool-registry.spec.ts"
```

- [ ] **Step 4: 提交**

```bash
git add src/agents/tools/tool-registry.ts src/agents/tools/tool-registry.spec.ts
git commit -m "feat(agents): implement ToolRegistry"
```

---

## Task 3: 实现 CommandExecutor

**Files:**

- Modify: `src/agents/tools/command-executor.ts`

- [ ] **Step 1: 实现 CommandExecutor**

```typescript
// src/agents/tools/command-executor.ts
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

const DEFAULT_ALLOWED_COMMANDS = [
  'git',
  'npm',
  'node',
  'npx',
  'python',
  'pip',
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
];

const BLOCKED_PATTERNS = [';', '&&', '||', '|', '>', '<', '`', '$', '\n'];

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

@Injectable()
export class CommandExecutor {
  private readonly logger = new Logger(CommandExecutor.name);
  private readonly allowedCommands: Set<string>;

  constructor() {
    const envCommands = process.env.ALLOWED_COMMANDS?.split(',').filter(Boolean);
    this.allowedCommands = new Set(envCommands ?? DEFAULT_ALLOWED_COMMANDS);
    this.logger.log(`Allowed commands: ${[...this.allowedCommands].join(', ')}`);
  }

  validateCommand(command: string, args: string[]): boolean {
    if (!this.allowedCommands.has(command)) {
      this.logger.warn(`Command not allowed: ${command}`);
      return false;
    }

    const fullCommand = [command, ...args].join(' ');
    for (const pattern of BLOCKED_PATTERNS) {
      if (fullCommand.includes(pattern)) {
        this.logger.warn(`Blocked pattern in command: ${pattern}`);
        return false;
      }
    }

    return true;
  }

  async execute(command: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<CommandResult> {
    if (!this.validateCommand(command, args)) {
      return {
        success: false,
        stdout: '',
        stderr: 'Command not allowed',
        exitCode: 1,
      };
    }

    const timeout = options?.timeout ?? 30000;
    const cwd = options?.cwd ?? process.cwd();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(command, args, {
        cwd,
        shell: false,
        timeout,
      });

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        // Truncate if too large (1MB)
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(0, 1024 * 1024);
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0 && !timedOut,
          stdout,
          stderr,
          exitCode: code ?? -1,
          timedOut,
        });
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          exitCode: -1,
        });
      });

      setTimeout(() => {
        timedOut = true;
        proc.kill();
        resolve({
          success: false,
          stdout,
          stderr: 'Command timed out',
          exitCode: -1,
          timedOut: true,
        });
      }, timeout);
    });
  }
}
```

- [ ] **Step 2: 创建 CommandExecutor 测试**

```typescript
// src/agents/tools/command-executor.spec.ts
import { CommandExecutor } from './command-executor';

describe('CommandExecutor', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    executor = new CommandExecutor();
  });

  describe('validateCommand', () => {
    it('should allow git commands', () => {
      expect(executor.validateCommand('git', ['status'])).toBe(true);
    });

    it('should allow ls command', () => {
      expect(executor.validateCommand('ls', [])).toBe(true);
    });

    it('should reject cd command', () => {
      expect(executor.validateCommand('cd', ['..'])).toBe(false);
    });

    it('should reject commands with semicolon', () => {
      expect(executor.validateCommand('ls', [';', 'rm', '-rf'])).toBe(false);
    });

    it('should reject commands with &&', () => {
      expect(executor.validateCommand('echo', ['a', '&&', 'ls'])).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute allowed command', async () => {
      const result = await executor.execute('echo', ['hello']);
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('should reject disallowed command', async () => {
      const result = await executor.execute('cd', ['..']);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not allowed');
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- --testPathPatterns="command-executor.spec.ts"
```

- [ ] **Step 4: 提交**

```bash
git add src/agents/tools/command-executor.ts src/agents/tools/command-executor.spec.ts
git commit -m "feat(agents): implement CommandExecutor with whitelist"
```

---

## Task 4: 实现 ToolExecutorService

**Files:**

- Create: `src/agents/tools/tool-executor.service.ts`
- Create: `src/agents/tools/tool-executor.service.spec.ts`

- [ ] **Step 1: 实现 ToolExecutorService**

```typescript
// src/agents/tools/tool-executor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ToolRegistry, Tool } from './tool-registry';
import { CommandExecutor } from './command-executor';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);
  private readonly sessionWorkspaceDir = 'workspace/sessions';

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly commandExecutor: CommandExecutor,
  ) {}

  parseToolCalls(output: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const regex = /<tool_call>\s*(\{[^}]+\})\s*<\/tool_call>/g;
    let match;

    while ((match = regex.exec(output)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        toolCalls.push({
          id: randomUUID(),
          name: parsed.name,
          args: parsed.args ?? {},
        });
      } catch (e) {
        this.logger.warn(`Failed to parse tool call: ${match[1]}`);
      }
    }

    return toolCalls;
  }

  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.toolRegistry.getTool(toolCall.name);

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        success: false,
        error: `Tool ${toolCall.name} not found`,
      };
    }

    try {
      const result = await tool.execute(toolCall.args);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        success: true,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async executeAllToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const toolCall of toolCalls) {
      const result = await this.executeToolCall(toolCall);
      results.push(result);
    }
    return results;
  }

  // 内置工具：读取文件
  private createReadFileTool(sessionId: string): Tool {
    return {
      name: 'read_file',
      description: '读取文件内容。适用于查看代码、配置、文档等。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
        },
        required: ['path'],
      },
      execute: async ({ path }) => {
        const fullPath = join(this.sessionWorkspaceDir, sessionId, path);
        try {
          return await fs.readFile(fullPath, 'utf-8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return `Error: File not found: ${path}`;
          }
          throw error;
        }
      },
    };
  }

  // 内置工具：写入文件
  private createWriteFileTool(sessionId: string): Tool {
    return {
      name: 'write_file',
      description: '创建或覆写文件。适用于生成代码、配置、报告等。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
      execute: async ({ path, content }) => {
        const fullPath = join(this.sessionWorkspaceDir, sessionId, path);
        const dir = join(this.sessionWorkspaceDir, sessionId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return `File written: ${path}`;
      },
    };
  }

  // 内置工具：列出文件
  private createListFilesTool(sessionId: string): Tool {
    return {
      name: 'list_files',
      description: '列出目录中的文件。适用于查看项目结构。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径（可选，默认 session workspace）' },
        },
      },
      execute: async ({ path }) => {
        const dir = path ? join(this.sessionWorkspaceDir, sessionId, path) : join(this.sessionWorkspaceDir, sessionId);
        try {
          const files = await fs.readdir(dir, { withFileTypes: true });
          return files.map((f) => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return `Error: Directory not found: ${path ?? 'session workspace'}`;
          }
          throw error;
        }
      },
    };
  }

  // 内置工具：执行命令
  createExecuteCommandTool(sessionId: string): Tool {
    return {
      name: 'execute_command',
      description: '执行白名单内的 shell 命令。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '命令' },
          args: { type: 'array', items: { type: 'string' }, description: '命令参数' },
        },
        required: ['command'],
      },
      execute: async ({ command, args }) => {
        const result = await this.commandExecutor.execute(command, Array.isArray(args) ? args : [], {
          cwd: join(this.sessionWorkspaceDir, sessionId),
        });
        if (!result.success) {
          return `Command failed: ${result.stderr || 'unknown error'}`;
        }
        return result.stdout || '(no output)';
      },
    };
  }

  // 注册 session 专属工具
  registerSessionTools(sessionId: string): void {
    this.toolRegistry.registerTool(this.createReadFileTool(sessionId));
    this.toolRegistry.registerTool(this.createWriteFileTool(sessionId));
    this.toolRegistry.registerTool(this.createListFilesTool(sessionId));
    this.toolRegistry.registerTool(this.createExecuteCommandTool(sessionId));
  }
}
```

- [ ] **Step 2: 创建 ToolExecutorService 测试**

```typescript
// src/agents/tools/tool-executor.service.spec.ts
import { ToolExecutorService, ToolCall } from './tool-executor.service';
import { ToolRegistry } from './tool-registry';
import { CommandExecutor } from './command-executor';

describe('ToolExecutorService', () => {
  let service: ToolExecutorService;
  let toolRegistry: ToolRegistry;
  let commandExecutor: CommandExecutor;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    commandExecutor = new CommandExecutor();
    service = new ToolExecutorService(toolRegistry, commandExecutor);
  });

  describe('parseToolCalls', () => {
    it('should parse single tool call', () => {
      const output = '<tool_call>{"name": "test", "args": {}}</tool_call>';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('test');
    });

    it('should parse multiple tool calls', () => {
      const output = `
        <tool_call>{"name": "tool1", "args": {}}</tool_call>
        <tool_call>{"name": "tool2", "args": {"key": "value"}}</tool_call>
      `;
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(2);
    });

    it('should return empty for no tool calls', () => {
      const output = 'Just normal text';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(0);
    });

    it('should generate UUID for each tool call', () => {
      const output = '<tool_call>{"name": "test", "args": {}}</tool_call>';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls[0].id).toBeDefined();
      expect(toolCalls[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('executeToolCall', () => {
    it('should return error for non-existent tool', async () => {
      const toolCall: ToolCall = { id: '123', name: 'non_existent', args: {} };
      const result = await service.executeToolCall(toolCall);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should execute registered tool', async () => {
      toolRegistry.registerTool({
        name: 'echo',
        description: 'Echo test',
        parameters: { type: 'object' },
        execute: async ({ msg }) => `Echo: ${msg}`,
      });

      const toolCall: ToolCall = { id: '123', name: 'echo', args: { msg: 'hello' } };
      const result = await service.executeToolCall(toolCall);
      expect(result.success).toBe(true);
      expect(result.result).toBe('Echo: hello');
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- --testPathPatterns="tool-executor.service.spec.ts"
```

- [ ] **Step 4: 提交**

```bash
git add src/agents/tools/tool-executor.service.ts src/agents/tools/tool-executor.service.spec.ts
git commit -m "feat(agents): implement ToolExecutorService"
```

---

## Task 5: 注册工具到 AgentsModule

**Files:**

- Modify: `src/agents/agents.module.ts`

- [ ] **Step 1: 注册工具服务**

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AgentConfigService } from './services/agent-config.service';
import { AgentPriorityService } from './services/agent-priority.service';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ToolRegistry } from './tools/tool-registry';
import { CommandExecutor } from './tools/command-executor';
import { ToolExecutorService } from './tools/tool-executor.service';
import { apikeyConfig, geminiConfig } from '../config/configuration';

@Module({
  imports: [HttpModule, ConfigModule.forFeature(apikeyConfig), ConfigModule.forFeature(geminiConfig)],
  providers: [
    AgentConfigService,
    AgentPriorityService,
    ClaudeAdapter,
    CodexAdapter,
    GeminiAdapter,
    ToolRegistry,
    CommandExecutor,
    ToolExecutorService,
  ],
  exports: [AgentConfigService, AgentPriorityService, ClaudeAdapter, CodexAdapter, GeminiAdapter, ToolExecutorService],
})
export class AgentsModule {}
```

- [ ] **Step 2: 提交**

```bash
git add src/agents/agents.module.ts
git commit -m "feat(agents): register tool services in AgentsModule"
```

---

## Task 6: 修改 ClaudeAdapter 集成工具调用

**Files:**

- Modify: `src/agents/adapters/claude.adapter.ts`

- [ ] **Step 1: 修改 ClaudeAdapter**

主要修改点：

1. 注入 `ToolExecutorService`
2. 在 `streamGenerate` 中检测 `<tool_call>` 标签
3. 提取工具调用、执行、注入结果、继续生成

```typescript
// 修改 constructor，添加 ToolExecutorService 注入
constructor(
  private readonly configService: ConfigService,
  private readonly toolExecutorService: ToolExecutorService,
) {
  // ... existing code
}

// 修改 streamGenerate 方法
async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
  this.status = AgentStatus.BUSY;

  // 注册 session 专属工具
  this.toolExecutorService.registerSessionTools(context.sessionId);

  try {
    const messages = this.buildMessages(context);

    // 处理工具调用的循环
    let currentMessages = [...messages];
    let fullResponse = '';

    while (true) {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: currentMessages as ChatMessage[],
        temperature: 0.7,
        max_tokens: 4000,
        stream: true,
      });

      let buffer = '';
      let hasToolCall = false;

      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        const content = chunk.choices?.[0]?.delta?.content ?? '';
        if (content) {
          buffer += content;
          fullResponse += content;
          yield content;
        }
      }

      // 检查是否有工具调用
      const toolCalls = this.toolExecutorService.parseToolCalls(buffer);

      if (toolCalls.length === 0) {
        break; // 没有更多工具调用，退出循环
      }

      // 执行工具调用
      hasToolCall = true;
      const toolResults = await this.toolExecutorService.executeAllToolCalls(toolCalls);

      // 将工具结果注入消息历史
      for (const result of toolResults) {
        currentMessages.push({
          role: 'assistant',
          content: buffer,
        });
        currentMessages.push({
          role: 'user',
          content: `[TOOL_RESULT] ${result.toolName}: ${result.success ? result.result : result.error}`,
        });
      }

      buffer = '';
    }

  } catch (error) {
    this.logger.error(`Claude streamGenerate error: ${error.message}`);
    throw error;
  } finally {
    this.status = AgentStatus.ONLINE;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/agents/adapters/claude.adapter.ts
git commit -m "feat(adapter): integrate tool execution in ClaudeAdapter"
```

---

## Task 7: 修改 CodexAdapter 和 GeminiAdapter

**Files:**

- Modify: `src/agents/adapters/codex.adapter.ts`
- Modify: `src/agents/adapters/gemini.adapter.ts`

- [ ] **Step 1: 用相同方式修改 CodexAdapter**

与 ClaudeAdapter 相同的修改模式

- [ ] **Step 2: 用相同方式修改 GeminiAdapter**

与 ClaudeAdapter 相同的修改模式

- [ ] **Step 3: 提交**

```bash
git add src/agents/adapters/codex.adapter.ts src/agents/adapters/gemini.adapter.ts
git commit -m "feat(adapter): integrate tool execution in all adapters"
```

---

## Task 8: 更新 .env.example

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: 添加 ALLOWED_COMMANDS**

在 Redis 配置后添加：

```bash
# Agent 工具白名单命令（逗号分隔）
ALLOWED_COMMANDS=git,npm,node,npx,python,pip,ls,cat,find,grep,echo,pwd,mkdir,touch,rm,cp,mv
```

- [ ] **Step 2: 提交**

```bash
git add .env.example
git commit -m "docs: add ALLOWED_COMMANDS to .env.example"
```

---

## Task 9: 最终测试

- [ ] **Step 1: 运行完整测试**

```bash
npm test
```

- [ ] **Step 2: 验证**

```bash
npm run build
```

---

## 验收测试

### 手动测试步骤

1. 启动后端：`npm run start:dev`
2. 连接 WebSocket
3. 发送：`@Claude 列出当前目录文件`
4. 验证：
   - Agent 调用 `list_files` 工具
   - 返回文件列表
5. 发送：`@Claude 创建 test.js，内容是 console.log("hello")`
6. 验证：
   - Agent 调用 `write_file` 工具
   - 文件被创建
