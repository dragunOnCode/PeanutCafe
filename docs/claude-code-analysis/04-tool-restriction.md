# Claude Code 工具限制机制分析

## 1. Claude Code 工具限制机制

Claude Code 提供了多层工具限制机制，支持 allowlist（白名单）、denylist（黑名单）和动态验证。

### 1.1 官方文档描述

根据 [Claude Code 官方文档 (sub-agents)](https://code.claude.com/docs/en/sub-agents)，Claude Code 的工具限制通过 YAML frontmatter 的 `tools` 和 `disallowedTools` 字段实现。

#### 1.1.1 工具 Allowlist（工具字段）

使用 `tools` 字段指定子代理可以使用哪些工具：

```yaml
---
name: safe-researcher
description: Research agent with restricted capabilities
tools: Read, Grep, Glob, Bash
---
```

此配置下，子代理只能使用 Read、Grep、Glob 和 Bash，无法编辑文件、写入文件或使用任何 MCP 工具。

#### 1.1.2 工具 Denylist（disallowedTools 字段）

使用 `disallowedTools` 字段排除特定工具：

```yaml
---
name: no-writes
description: Inherits every tool except file writes
disallowedTools: Write, Edit
---
```

此配置继承父对话的所有工具，但排除 Write 和 Edit。

#### 1.1.3 组合使用

如果同时设置 `tools` 和 `disallowedTools`，处理顺序为：

1. 先应用 `disallowedTools`
2. 再对剩余工具应用 `tools` 的 allowlist

在两个列表中都出现的工具会被移除。

#### 1.1.4 PreToolUse Hook 动态验证

对于更细粒度的控制，Claude Code 支持 `PreToolUse` hook 动态验证操作：

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: 'Bash'
      hooks:
        - type: command
          command: './scripts/validate-readonly-query.sh'
---
```

Hook 脚本接收 JSON 格式的工具输入，通过 stdin：

```bash
#!/bin/bash
# ./scripts/validate-readonly-query.sh

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block SQL write operations (case-insensitive)
if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b' > /dev/null; then
  echo "Blocked: Only SELECT queries are allowed" >&2
  exit 2
fi

exit 0
```

**Exit Code 行为**：

- `exit 0`：允许执行
- `exit 2`：阻止执行，错误消息反馈给 Claude

#### 1.1.5 MCP 服务器作用域

MCP 服务器可以限定在特定子代理范围内：

```yaml
---
name: browser-tester
description: Tests features in a real browser using Playwright
mcpServers:
  # Inline 定义：仅限此子代理
  - playwright:
      type: stdio
      command: npx
      args: ['-y', '@playwright/mcp@latest']
  # 按名称引用：复用已配置的服务器
  - github
---
```

#### 1.1.6 内置子代理的工具限制

Claude Code 内置的子代理展示了工具限制的实际应用：

| Agent   | Model   | Tools                     | Description          |
| :------ | :------ | :------------------------ | :------------------- |
| Explore | Haiku   | Read-only (无 Write/Edit) | 快速搜索和分析代码库 |
| Plan    | inherit | Read-only (无 Write/Edit) | 规划模式下的代码研究 |
| General | inherit | All tools                 | 通用复杂任务         |

### 1.2 Claude Code 源码参考

Claude Code 的工具限制在官方文档中有详细描述，核心机制位于子代理的 frontmatter 解析中。源代码路径（在官方文档中提到）：

- `src/tools/AgentTool/loadAgentsDir.ts` - Agent 加载核心
- `src/tools/AgentTool/builtInAgents.ts` - 内置 Agent 注册

由于本地环境未安装 Claude Code 源码（`.claude-code/src` 目录不存在），本分析基于官方文档。

---

## 2. PeanutCafe 当前工具系统

### 2.1 工具注册架构

**ToolRegistry** (`src/agents/tools/tool-registry.ts`)：

```typescript
@Injectable()
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    /* ... */
  }
  getTool(name: string): Tool | undefined {
    /* ... */
  }
  getAllTools(): Tool[] {
    /* ... */
  }
  toOpenAITools(): OpenAI.ChatCompletionTool[] {
    /* ... */
  }
}
```

**ToolExecutorService** (`src/agents/tools/tool-executor.service.ts`)：

```typescript
@Injectable()
export class ToolExecutorService {
  parseToolCalls(output: string): ToolCall[] {
    /* 解析 <tool_call> 标签 */
  }
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    /* 执行工具 */
  }
  async executeAllToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    /* ... */
  }
  getOpenAITools(): OpenAI.ChatCompletionTool[] {
    /* 返回所有已注册工具 */
  }
  registerSessionTools(sessionId: string): void {
    /* 注册会话工具 */
  }
}
```

### 2.2 工具定义

PeanutCafe 定义了 5 个核心工具：

| Tool Name         | Description               | Category |
| :---------------- | :------------------------ | :------- |
| `read_file`       | 读取文件内容              | 文件操作 |
| `write_file`      | 创建或覆写文件            | 文件操作 |
| `edit_file`       | 替换文件中的唯一匹配内容  | 文件操作 |
| `list_files`      | 列出目录中的文件          | 文件操作 |
| `execute_command` | 执行白名单内的 shell 命令 | 系统交互 |

### 2.3 当前工具配置

**配置文件** (`config/agent-tools-config.json`)：

```json
{
  "agentTools": {
    "claude": {
      "mcpServers": ["open-websearch"],
      "localTools": ["read_file", "write_file", "list_files", "execute_command"]
    },
    "codex": {
      "mcpServers": ["open-websearch"],
      "localTools": ["read_file", "write_file"]
    },
    "gemini": {
      "mcpServers": [],
      "localTools": ["read_file", "write_file"]
    }
  }
}
```

### 2.4 命令执行器安全机制

**CommandExecutor** (`src/agents/tools/command-executor.ts`)：

```typescript
const DEFAULT_ALLOWED_COMMANDS = [
  'git', 'npm', 'node', 'npx', 'python', 'pip',
  'ls', 'cat', 'find', 'grep', 'echo', 'pwd',
  'mkdir', 'touch', 'rm', 'cp', 'mv',
];

const BLOCKED_PATTERNS = [';', '&&', '||', '|', '>', '<', '`', '$', '\n'];

validateCommand(command: string, args: string[]): boolean {
  if (!this.allowedCommands.has(command)) {
    return false;  // 命令不在白名单
  }
  const fullCommand = [command, ...args].join(' ');
  for (const pattern of BLOCKED_PATTERNS) {
    if (fullCommand.includes(pattern)) {
      return false;  // 包含危险模式
    }
  }
  return true;
}
```

### 2.5 当前问题：配置未被使用

**关键发现**：`agent-tools-config.json` 中定义的 `localTools` 配置**实际上未被使用**。

在 `ClaudeAdapter.executeWithReAct()` 中：

```typescript
async *executeWithReAct(...) {
  this.toolExecutorService.registerSessionTools(context.sessionId);
  const tools = this.toolExecutorService.getOpenAITools();  // 获取所有已注册工具
  // ... 无任何过滤逻辑
}
```

`registerSessionTools()` 注册**所有 5 个工具**，不根据 agent 类型过滤。

---

## 3. 差距分析

### 3.1 功能对比

| 功能                  | Claude Code               | PeanutCafe                    | 状态 |
| :-------------------- | :------------------------ | :---------------------------- | :--- |
| 工具 Allowlist        | ✅ `tools` 字段           | ❌ 未实现                     | P0   |
| 工具 Denylist         | ✅ `disallowedTools` 字段 | ❌ 未实现                     | P0   |
| PreToolUse Hook       | ✅ 支持                   | ❌ 未实现                     | P1   |
| MCP 服务器作用域      | ✅ `mcpServers` 字段      | ⚠️ 全局注册，按名称前缀隔离   | P1   |
| 命令白名单            | ✅ 内置                   | ✅ 已实现                     | ✅   |
| 危险模式拦截          | ✅ 通过 Hook              | ✅ 已实现（BLOCKED_PATTERNS） | ✅   |
| 每个 Agent 的工具限制 | ✅ 完整支持               | ❌ 未实现                     | P0   |
| 工具限制配置          | ✅ YAML Frontmatter       | ⚠️ JSON 配置（未使用）        | P0   |

### 3.2 核心差距

1. **`agent-tools-config.json` 未被使用**：配置存在但未在运行时生效
2. **无 Agent 相关工具过滤**：所有 Agent 使用相同的工具集
3. **无 PreToolUse Hook**：无法实现细粒度的动态验证
4. **ToolRegistry 全局注册**：工具注册时不考虑 Agent 上下文
5. **MCP 工具命名空间隔离**：`mcp-tool-registry.ts` 使用 `serverName.toolName` 前缀，但未基于 Agent 过滤

---

## 4. 建议实现方案

### 4.1 优先级 P0（关键差距）

#### 4.1.1 实现 Agent 工具过滤

在 `ToolExecutorService` 中添加工具过滤：

```typescript
// src/agents/tools/tool-executor.service.ts

interface AgentToolConfig {
  allowedTools?: string[];
  disallowedTools?: string[];
}

@Injectable()
export class ToolExecutorService {
  private agentToolConfigs: Map<string, AgentToolConfig> = new Map();

  setAgentToolConfig(agentType: string, config: AgentToolConfig): void {
    this.agentToolConfigs.set(agentType, config);
  }

  getFilteredTools(agentType: string): Tool[] {
    const config = this.agentToolConfigs.get(agentType);
    const allTools = this.getAllTools();

    if (!config) {
      return allTools; // 无配置返回全部
    }

    let filtered = allTools;

    // 1. 先应用 disallowedTools
    if (config.disallowedTools?.length) {
      filtered = filtered.filter((t) => !config.disallowedTools.includes(t.name));
    }

    // 2. 再应用 allowedTools
    if (config.allowedTools?.length) {
      filtered = filtered.filter((t) => config.allowedTools.includes(t.name));
    }

    return filtered;
  }

  getOpenAITools(agentType: string): OpenAI.ChatCompletionTool[] {
    return this.getFilteredTools(agentType).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as OpenAI.FunctionParameters,
      },
    }));
  }
}
```

#### 4.1.2 从配置文件加载

在 `AgentConfigService` 中加载 `agent-tools-config.json` 并应用：

```typescript
// src/agents/services/agent-config.service.ts

interface AgentToolConfig {
  mcpServers?: string[];
  localTools?: string[];
}

interface AgentToolsConfigFile {
  agentTools: Record<string, AgentToolConfig>;
}

// 在 onModuleInit 中
private loadToolConfig(): void {
  const configPath = path.join(process.cwd(), 'config', 'agent-tools-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as AgentToolsConfigFile;

  for (const [agentType, toolConfig] of Object.entries(config.agentTools)) {
    toolExecutorService.setAgentToolConfig(agentType, {
      allowedTools: toolConfig.localTools,
    });
  }
}
```

#### 4.1.3 在 Adapter 中使用过滤

修改 `ClaudeAdapter.executeWithReAct()`：

```typescript
// Before
const tools = this.toolExecutorService.getOpenAITools();

// After
const tools = this.toolExecutorService.getOpenAITools(this.type);
```

### 4.2 优先级 P1（重要功能）

#### 4.2.1 实现 PreToolUse Hook

定义 Hook 接口：

```typescript
// src/agents/interfaces/tool-hook.interface.ts

export interface PreToolUseHook {
  matcher: string | RegExp; // 匹配工具名称
  command: string; // 验证脚本路径
}

export interface ToolHookConfig {
  preToolUse?: PreToolUseHook[];
  postToolUse?: PostToolUseHook[];
}

export enum HookExitCode {
  ALLOW = 0,
  BLOCK = 2,
}
```

实现 Hook 执行器：

```typescript
// src/agents/tools/tool-hook-executor.ts

@Injectable()
export class ToolHookExecutor {
  async executePreToolHook(
    toolName: string,
    toolArgs: Record<string, unknown>,
    hooks: PreToolUseHook[],
  ): Promise<{ allowed: boolean; error?: string }> {
    for (const hook of hooks) {
      if (this.matches(toolName, hook.matcher)) {
        const result = await this.runHookScript(hook.command, {
          tool_name: toolName,
          tool_input: toolArgs,
        });

        if (result.exitCode === HookExitCode.BLOCK) {
          return { allowed: false, error: result.stderr || 'Hook blocked execution' };
        }
      }
    }
    return { allowed: true };
  }

  private async runHookScript(
    command: string,
    input: Record<string, unknown>,
  ): Promise<{ exitCode: number; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 0, stderr });
      });
    });
  }

  private matches(toolName: string, matcher: string | RegExp): boolean {
    if (typeof matcher === 'string') {
      return toolName === matcher || toolName.includes(matcher);
    }
    return matcher.test(toolName);
  }
}
```

在 `ToolExecutorService` 中集成 Hook：

```typescript
// src/agents/tools/tool-executor.service.ts

async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  // 1. 检查工具是否存在
  const tool = this.toolRegistry.getTool(toolCall.name);
  if (!tool) {
    return { success: false, error: `Tool ${toolCall.name} not found` };
  }

  // 2. 执行 PreToolUse Hook
  const hookResult = await this.toolHookExecutor.executePreToolHook(
    toolCall.name,
    toolCall.args,
    this.getPreToolHooks(toolCall.name)
  );

  if (!hookResult.allowed) {
    return { success: false, error: hookResult.error };
  }

  // 3. 执行工具
  try {
    const result = await tool.execute(toolCall.args);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### 4.3 配置格式建议

建议将 `agent-tools-config.json` 扩展为支持更多配置：

```json
{
  "agentTools": {
    "claude": {
      "mcpServers": ["open-websearch"],
      "localTools": ["read_file", "write_file", "list_files", "execute_command"],
      "disallowedTools": [],
      "hooks": {
        "PreToolUse": [
          {
            "matcher": "execute_command",
            "command": "./scripts/validate-command.sh"
          }
        ]
      }
    },
    "codex": {
      "mcpServers": ["open-websearch"],
      "localTools": ["read_file", "write_file"],
      "disallowedTools": ["execute_command"]
    },
    "gemini": {
      "mcpServers": [],
      "localTools": ["read_file", "write_file"],
      "disallowedTools": ["execute_command", "edit_file", "list_files"]
    }
  }
}
```

### 4.4 实现计划

**Phase 1 - 核心工具过滤**：

1. 在 `ToolExecutorService` 添加 `getFilteredTools()` 方法
2. 在 `AgentConfigService` 加载 `agent-tools-config.json`
3. 修改 Adapter 使用过滤后的工具

**Phase 2 - Hook 系统**：

1. 定义 Hook 接口和类型
2. 实现 `ToolHookExecutor`
3. 集成到 `ToolExecutorService`

**Phase 3 - 配置增强**：

1. 扩展 `agent-tools-config.json` 支持 Hook 配置
2. 实现 Hook 脚本生成辅助工具

---

## 5. 总结

| 方面           | Claude Code                    | PeanutCafe (当前) | PeanutCafe (目标) |
| :------------- | :----------------------------- | :---------------- | :---------------- |
| 工具 Allowlist | `tools: Read, Grep`            | ❌ 无             | ✅ 需实现         |
| 工具 Denylist  | `disallowedTools: Write, Edit` | ❌ 无             | ✅ 需实现         |
| Hook 验证      | `PreToolUse` + exit code 2     | ❌ 无             | ✅ 需实现         |
| MCP 隔离       | `mcpServers` 字段              | ⚠️ 按名称前缀隔离 | ✅ 已部分实现     |
| 命令白名单     | 全局配置                       | ✅ 已实现         | ✅ 已有           |
| 配置位置       | YAML Frontmatter               | JSON (未使用)     | JSON + 代码       |

**关键行动项**：

1. **立即修复**：`agent-tools-config.json` 配置未生效的问题
2. **短期目标**：实现 `tools`/`disallowedTools` 过滤
3. **中期目标**：实现 `PreToolUse` Hook 系统
