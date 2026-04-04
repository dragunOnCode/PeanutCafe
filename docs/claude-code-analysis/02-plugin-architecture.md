# Claude Code 插件架构分析

## 1. Claude Code 插件系统概述

Claude Code 采用模块化插件架构，支持通过插件扩展 CLI 功能。插件可以提供以下组件：

- **Commands**: 自定义斜杠命令 (`/plugin:command`)
- **Agents**: 自定义 AI Agent
- **Skills**: 技能定义
- **Hooks**: 生命周期钩子
- **Output Styles**: 输出样式
- **MCP Servers**: Model Context Protocol 服务器
- **LSP Servers**: Language Server Protocol 服务器

### 1.1 插件目录结构

```
my-plugin/
├── plugin.json          # 插件清单（可选）
├── commands/            # 自定义斜杠命令
│   ├── build.md
│   └── deploy.md
├── agents/              # 自定义 AI agents
│   └── test-runner.md
├── skills/              # 技能定义
│   └── SKILL.md
├── hooks/               # Hook 配置
│   └── hooks.json
├── output-styles/       # 输出样式
├── settings.json        # 插件设置（可选）
└── .mcp.json           # MCP 服务器配置（可选）
```

### 1.2 核心类型定义

**源代码位置**: `claude-code/src/types/plugin.ts`

```typescript
export type LoadedPlugin = {
  name: string;
  manifest: PluginManifest;
  path: string;
  source: string;
  repository: string;
  enabled?: boolean;
  isBuiltin?: boolean;
  sha?: string;
  commandsPath?: string;
  commandsPaths?: string[];
  commandsMetadata?: Record<string, CommandMetadata>;
  agentsPath?: string;
  agentsPaths?: string[];
  skillsPath?: string;
  skillsPaths?: string[];
  outputStylesPath?: string;
  outputStylesPaths?: string[];
  hooksConfig?: HooksSettings;
  mcpServers?: Record<string, McpServerConfig>;
  lspServers?: Record<string, LspServerConfig>;
  settings?: Record<string, unknown>;
};
```

---

## 2. Plugin Manifest 格式

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts`

### 2.1 完整 Schema

```typescript
export const PluginManifestSchema = lazySchema(() =>
  z.object({
    ...PluginManifestMetadataSchema().shape,
    ...PluginManifestHooksSchema().partial().shape,
    ...PluginManifestCommandsSchema().partial().shape,
    ...PluginManifestAgentsSchema().partial().shape,
    ...PluginManifestSkillsSchema().partial().shape,
    ...PluginManifestOutputStylesSchema().partial().shape,
    ...PluginManifestChannelsSchema().partial().shape,
    ...PluginManifestMcpServerSchema().partial().shape,
    ...PluginManifestLspServerSchema().partial().shape,
    ...PluginManifestSettingsSchema().partial().shape,
    ...PluginManifestUserConfigSchema().partial().shape,
  }),
);
```

### 2.2 Metadata Schema

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts` 第 274-320 行

```typescript
const PluginManifestMetadataSchema = lazySchema(() =>
  z.object({
    name: z
      .string()
      .min(1, 'Plugin name cannot be empty')
      .refine((name) => !name.includes(' '), {
        message: 'Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")',
      })
      .describe('Unique identifier for the plugin, used for namespacing'),
    version: z.string().optional().describe('Semantic version (e.g., 1.2.3)'),
    description: z.string().optional().describe('Brief explanation of what the plugin provides'),
    author: PluginAuthorSchema().optional(),
    homepage: z.string().url().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    dependencies: z.array(DependencyRefSchema()).optional(),
  }),
);
```

### 2.3 Commands Schema

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts` 第 429-452 行

```typescript
const PluginManifestCommandsSchema = lazySchema(() =>
  z.object({
    commands: z.union([
      RelativeCommandPath(),
      z.array(RelativeCommandPath()),
      z.record(z.string(), CommandMetadataSchema()),
    ]),
  }),
);

// CommandMetadataSchema 允许两种定义方式
export const CommandMetadataSchema = lazySchema(() =>
  z
    .object({
      source: RelativeCommandPath().optional(),
      content: z.string().optional(),
      description: z.string().optional(),
      argumentHint: z.string().optional(),
      model: z.string().optional(),
      allowedTools: z.array(z.string()).optional(),
    })
    .refine((data) => (data.source && !data.content) || (!data.source && data.content), {
      message: 'Command must have either "source" or "content", not both',
    }),
);
```

### 2.4 Agents Schema

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts` 第 460-476 行

```typescript
const PluginManifestAgentsSchema = lazySchema(() =>
  z.object({
    agents: z.union([RelativeMarkdownPath(), z.array(RelativeMarkdownPath())]),
  }),
);
```

### 2.5 Hooks Schema

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts` 第 348-373 行

```typescript
const PluginManifestHooksSchema = lazySchema(() =>
  z.object({
    hooks: z.union([
      RelativeJSONPath(),
      z.lazy(() => HooksSchema()),
      z.array(z.union([RelativeJSONPath(), z.lazy(() => HooksSchema())])),
    ]),
  }),
);
```

### 2.6 MCP Servers Schema

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts` 第 543-572 行

```typescript
const PluginManifestMcpServerSchema = lazySchema(() =>
  z.object({
    mcpServers: z.union([
      RelativeJSONPath(),
      McpbPath(),
      z.record(z.string(), McpServerConfigSchema()),
      z.array(z.union([RelativeJSONPath(), McpbPath(), z.record(z.string(), McpServerConfigSchema())])),
    ]),
  }),
);
```

### 2.7 User Config Schema

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts` 第 632-654 行

```typescript
const PluginManifestUserConfigSchema = lazySchema(() =>
  z.object({
    userConfig: z
      .record(
        z.string().regex(/^[A-Za-z_]\w*$/, 'Option keys must be valid identifiers'),
        PluginUserConfigOptionSchema(),
      )
      .optional(),
  }),
);

// PluginUserConfigOptionSchema 定义
const PluginUserConfigOptionSchema = lazySchema(() =>
  z
    .object({
      type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
      title: z.string(),
      description: z.string(),
      required: z.boolean().optional(),
      default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
      multiple: z.boolean().optional(),
      sensitive: z.boolean().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .strict(),
);
```

### 2.8 插件清单示例

```json
{
  "name": "code-assistant",
  "version": "1.2.0",
  "description": "AI-powered code assistance tools",
  "author": {
    "name": "John Doe",
    "email": "john@example.com"
  },
  "keywords": ["coding", "ai", "assistant"],
  "homepage": "https://example.com/code-assistant",
  "commands": ["./extra-commands/*.md"],
  "agents": ["./agents/reviewer.md"],
  "hooks": "./custom-hooks.json",
  "mcpServers": {
    "code-analysis": {
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "./codebase"]
    }
  },
  "userConfig": {
    "apiKey": {
      "type": "string",
      "title": "API Key",
      "description": "Your API key for the service",
      "required": true,
      "sensitive": true
    }
  }
}
```

---

## 3. Hook 系统

**源代码位置**: `claude-code/src/schemas/hooks.ts`

### 3.1 可用的 Hook 事件

**源代码位置**: `claude-code/src/entrypoints/sdk/coreTypes.ts` 第 25-53 行

```typescript
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const;
```

### 3.2 Hook 类型

```typescript
// Bash 命令 Hook
const BashCommandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  if: IfConditionSchema().optional(),
  shell: z.enum(SHELL_TYPES).optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
  async: z.boolean().optional(),
  asyncRewake: z.boolean().optional(),
});

// LLM Prompt Hook
const PromptHookSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string(),
  if: IfConditionSchema().optional(),
  timeout: z.number().positive().optional(),
  model: z.string().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});

// HTTP Hook
const HttpHookSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  if: IfConditionSchema().optional(),
  timeout: z.number().positive().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});

// Agent Hook
const AgentHookSchema = z.object({
  type: z.literal('agent'),
  prompt: z.string(),
  if: IfConditionSchema().optional(),
  timeout: z.number().positive().optional(),
  model: z.string().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});
```

### 3.3 Hook 配置示例 (hooks.json)

```json
{
  "description": "Code analysis hooks for pre/post tool use",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Running Bash: $ARGUMENTS'",
            "if": "Bash(git *)",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "agent",
            "prompt": "Analyze the following code for potential issues: $ARGUMENTS",
            "timeout": 60
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://analytics.example.com/session",
            "headers": { "Authorization": "Bearer $MY_TOKEN" },
            "allowedEnvVars": ["MY_TOKEN"]
          }
        ]
      }
    ]
  }
}
```

---

## 4. 插件加载机制

**源代码位置**: `claude-code/src/utils/plugins/pluginLoader.ts`

### 4.1 加载流程

```typescript
// 核心加载函数
export async function loadAllPlugins(): Promise<PluginLoadResult> {
  // 1. 加载内置插件
  const builtinResult = getBuiltinPlugins();

  // 2. 加载市场插件
  const marketplaceResult = await loadPluginsFromMarketplaces({ cacheOnly: false });

  // 3. 合并结果
  return {
    enabled: [...builtinResult.enabled, ...marketplaceResult.enabled],
    disabled: [...builtinResult.disabled, ...marketplaceResult.disabled],
    errors: marketplaceResult.errors,
  };
}

// 从路径创建插件
export async function createPluginFromPath(
  pluginPath: string,
  source: string,
  enabled: boolean,
  fallbackName: string,
): Promise<{ plugin: LoadedPlugin; errors: PluginError[] }> {
  // 1. 加载 plugin.json 清单
  const manifestPath = join(pluginPath, '.claude-plugin', 'plugin.json');
  const manifest = await loadPluginManifest(manifestPath, fallbackName, source);

  // 2. 自动检测组件目录
  const commandsDirExists = await pathExists(join(pluginPath, 'commands'));
  const agentsDirExists = await pathExists(join(pluginPath, 'agents'));
  const skillsDirExists = await pathExists(join(pluginPath, 'skills'));

  // 3. 加载 hooks 配置
  const standardHooksPath = join(pluginPath, 'hooks', 'hooks.json');
  if (await pathExists(standardHooksPath)) {
    mergedHooks = await loadPluginHooks(standardHooksPath, manifest.name);
  }

  // 4. 返回 LoadedPlugin 对象
  return { plugin, errors };
}
```

### 4.2 插件安装来源

**源代码位置**: `claude-code/src/utils/plugins/schemas.ts` 第 1062-1150 行

```typescript
export const PluginSourceSchema = lazySchema(() =>
  z.union([
    RelativePath(), // 本地相对路径
    z.object({
      source: z.literal('npm'),
      package: NpmPackageNameSchema(),
      version: z.string().optional(),
      registry: z.string().url().optional(),
    }),
    z.object({
      source: z.literal('pip'),
      package: z.string(),
      version: z.string().optional(),
    }),
    z.object({
      source: z.literal('url'),
      url: z.string(),
      ref: z.string().optional(),
      sha: gitSha().optional(),
    }),
    z.object({
      source: z.literal('github'),
      repo: z.string(),
      ref: z.string().optional(),
      sha: gitSha().optional(),
    }),
    z.object({
      source: z.literal('git-subdir'),
      url: z.string(),
      path: z.string(),
      ref: z.string().optional(),
      sha: gitSha().optional(),
    }),
  ]),
);
```

---

## 5. Agent 定义格式

**源代码位置**: `claude-code/src/utils/plugins/loadPluginAgents.ts`

### 5.1 Plugin Agent Markdown 格式

```markdown
---
name: code-reviewer
description: 当需要审查代码质量时使用此 Agent
model: inherit
tools:
  - Read
  - Grep
  - Glob
skills:
  - security-check
color: blue
background: false
memory: project
effort: medium
maxTurns: 15
---

# Code Reviewer Agent

You are an expert code reviewer. Your role is to...

## Review Guidelines

1. Check code quality and style
2. Identify potential bugs
3. Suggest performance improvements
```

### 5.2 Agent 加载代码

```typescript
async function loadAgentFromFile(
  filePath: string,
  pluginName: string,
  namespace: string[],
  sourceName: string,
  pluginPath: string,
  pluginManifest: PluginManifest,
): Promise<AgentDefinition | null> {
  const content = await fs.readFile(filePath, { encoding: 'utf-8' });
  const { frontmatter, content: markdownContent } = parseFrontmatter(content, filePath);

  const baseAgentName = frontmatter.name || basename(filePath).replace(/\.md$/, '');
  const nameParts = [pluginName, ...namespace, baseAgentName];
  const agentType = nameParts.join(':');

  const whenToUse = frontmatter.description ?? `Agent from ${pluginName} plugin`;
  const tools = parseAgentToolsFromFrontmatter(frontmatter.tools);
  const skills = parseSlashCommandToolsFromFrontmatter(frontmatter.skills);
  const color = frontmatter.color as AgentColorName | undefined;
  const model = frontmatter.model === 'inherit' ? 'inherit' : frontmatter.model;

  let systemPrompt = substitutePluginVariables(markdownContent.trim(), {
    path: pluginPath,
    source: sourceName,
  });

  return {
    agentType,
    whenToUse,
    tools,
    skills,
    color,
    model,
    source: 'plugin' as const,
    plugin: sourceName,
    getSystemPrompt: () => systemPrompt,
  };
}
```

---

## 6. Command 定义格式

**源代码位置**: `claude-code/src/utils/plugins/loadPluginCommands.ts`

### 6.1 Plugin Command Markdown 格式

```markdown
---
name: deploy
description: 部署应用到生产环境
argumentHint: [environment]
model: sonnet
allowedTools:
  - Bash
  - Read
---

# Deploy Command

This command deploys the application to the specified environment.

## Usage

/deploy production

## Steps

1. Run tests
2. Build application
3. Deploy to server
```

### 6.2 Command 加载代码

```typescript
async function loadCommandsFromDirectory(
  commandsPath: string,
  pluginName: string,
  sourceName: string,
  pluginManifest: PluginManifest,
  config: LoadConfig = { isSkillMode: false },
): Promise<Command[]> {
  const markdownFiles = await collectMarkdownFiles(commandsPath, commandsPath);

  for (const file of processedFiles) {
    const commandName = getCommandNameFromFile(file.filePath, file.baseDir, pluginName);

    const command = createPluginCommand(commandName, file, sourceName, pluginPath, pluginManifest);
    commands.push(command);
  }

  return commands;
}
```

---

## 7. 插件注册与启用

### 7.1 内置插件定义

**源代码位置**: `claude-code/src/plugins/builtinPlugins.ts`

```typescript
export type BuiltinPluginDefinition = {
  name: string;
  description: string;
  version?: string;
  skills?: BundledSkillDefinition[];
  hooks?: HooksSettings;
  mcpServers?: Record<string, McpServerConfig>;
  isAvailable?: () => boolean;
  defaultEnabled?: boolean;
};

// 注册内置插件
export function registerBuiltinPlugin(definition: BuiltinPluginDefinition): void {
  BUILTIN_PLUGINS.set(definition.name, definition);
}

// 获取所有内置插件
export function getBuiltinPlugins(): {
  enabled: LoadedPlugin[];
  disabled: LoadedPlugin[];
} {
  // 根据用户设置和 defaultEnabled 确定启用状态
}
```

### 7.2 插件启用状态管理

```typescript
// 插件 ID 格式
const pluginId = `${name}@${marketplace}`; // e.g., "my-plugin@marketplace" 或 "code-assistant@builtin"

// 用户设置中启用/禁用插件
settings.enabledPlugins = {
  'my-plugin@anthropic': true,
  'code-assistant@builtin': false,
};
```

---

## 8. 变量替换系统

**源代码位置**: `claude-code/src/utils/plugins/pluginOptionsStorage.ts`

### 8.1 支持的变量

```typescript
// 插件变量
${CLAUDE_PLUGIN_ROOT}   // 插件根目录
${CLAUDE_PLUGIN_NAME}   // 插件名称
${CLAUDE_PLUGIN_DATA}   // 插件数据目录（持久化）

// 用户配置变量
${user_config.KEY}      // 用户配置的值

// 环境变量
$VAR_NAME 或 ${VAR_NAME}
```

### 8.2 变量替换示例

```json
{
  "mcpServers": {
    "custom-server": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js", "--api-key", "${user_config.apiKey}"]
    }
  }
}
```

---

## 9. PeanutCafe 当前架构

### 9.1 现有目录结构

```
src/
├── agents/           # Agent 适配器
│   ├── adapters/     # LLM 适配器实现
│   ├── interfaces/   # 接口定义
│   ├── prompts/      # Agent prompt 模板
│   ├── react/        # React 组件
│   ├── services/     # Agent 服务
│   └── tools/        # Agent 工具
├── chat/             # 聊天相关
├── common/           # 通用模块
├── config/           # 配置
├── database/         # 数据库
├── gateway/          # 网关
├── logger/           # 日志
├── mcp/              # MCP 服务器
├── memory/           # 内存/记忆
├── orchestration/    # 工作流编排
├── queue/            # 队列
├── session/          # 会话管理
└── workspace/         # 工作区
```

### 9.2 当前 Agent 配置

**配置文件**: `config/agents.config.json`

```json
{
  "agents": [
    {
      "id": "claude-001",
      "name": "Claude",
      "type": "claude",
      "model": "anthropic/claude-3-sonnet",
      "role": "架构设计与编码实现",
      "capabilities": ["架构设计", "代码生成", "技术选型", "重构"],
      "callType": "http",
      "enabled": true,
      "priority": { "basePriority": 100, "quotaLimit": 100000 }
    }
  ]
}
```

### 9.3 当前 Agent 接口

```typescript
// src/agents/interfaces/llm-adapter.interface.ts
export interface ILLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly type: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly callType: 'http';

  generate(prompt: string, context: AgentContext): Promise<AgentResponse>;
  streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string>;
  shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult>;
  healthCheck(): Promise<boolean>;
  getStatus(): AgentStatus;
}
```

### 9.4 当前工作流编排

**源代码位置**: `src/orchestration/orchestration.service.ts`

```typescript
export type WorkflowEvent =
  | { type: 'task_start'; agentName: string; task: string }
  | { type: 'task_complete'; output: string }
  | { type: 'chunk'; agentName: string; delta: string }
  | { type: 'agent_stream_end'; agentName: string; fullContent: string }
  | { type: 'needs_review'; reason: string }
  | { type: 'needs_decision'; error?: string }
  | { type: 'handoff'; from: string; to: string }
  | { type: 'complete'; finalOutput: string; agentName: string };
```

---

## 10. 差距分析与建议

### 10.1 功能对比

| 功能                | Claude Code | PeanutCafe | 优先级 |
| ------------------- | ----------- | ---------- | ------ |
| Plugin Manifest     | ✅ 完整支持 | ❌ 无      | P0     |
| Commands (斜杠命令) | ✅ 完整支持 | ❌ 无      | P0     |
| Agents 定义         | ✅ 完整支持 | ⚠️ 仅配置  | P1     |
| Hooks 系统          | ✅ 完整支持 | ❌ 无      | P0     |
| MCP Servers         | ✅ 完整支持 | ⚠️ 仅连接  | P1     |
| Skills              | ✅ 完整支持 | ❌ 无      | P1     |
| Output Styles       | ✅ 支持     | ❌ 无      | P2     |
| User Config         | ✅ 完整支持 | ❌ 无      | P1     |
| 插件市场            | ✅ 支持     | ❌ 无      | P2     |
| 内置插件注册        | ✅ 完整支持 | ❌ 无      | P1     |
| 变量替换            | ✅ 完整支持 | ❌ 无      | P1     |

### 10.2 建议的实现方案

#### Phase 1: 基础插件框架

**目标**: 建立插件系统核心

```typescript
// 1. 定义插件清单类型
interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: PluginAuthor;
  commands?: CommandDefinition[];
  agents?: AgentDefinition[];
  hooks?: HooksSettings;
  mcpServers?: Record<string, McpServerConfig>;
  skills?: SkillDefinition[];
  settings?: Record<string, unknown>;
  userConfig?: UserConfigDefinition[];
}

// 2. 插件加载服务
@Injectable()
export class PluginLoaderService {
  private plugins: Map<string, LoadedPlugin> = new Map();

  async loadPlugins(): Promise<void> {
    // 扫描 plugins/ 目录
    // 加载 plugin.json 清单
    // 注册组件
  }

  async loadPluginFromPath(path: string): Promise<LoadedPlugin> {
    // 解析清单文件
    // 检测组件目录
    // 加载配置
  }
}

// 3. 组件注册中心
@Injectable()
export class ComponentRegistry {
  private commands: Map<string, Command> = new Map();
  private agents: Map<string, AgentDefinition> = new Map();
  private hooks: Map<string, HookMatcher[]> = new Map();

  registerCommand(command: Command): void;
  registerAgent(agent: AgentDefinition): void;
  registerHooks(event: string, matchers: HookMatcher[]): void;
}
```

#### Phase 2: Hook 系统实现

**目标**: 支持生命周期钩子

```typescript
// Hook 事件类型
type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd' | 'TaskCreated' | 'TaskCompleted';
// ...

// Hook 命令类型
type HookCommand =
  | { type: 'command'; command: string; if?: string }
  | { type: 'prompt'; prompt: string; model?: string }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'agent'; prompt: string };

// Hook 执行器
@Injectable()
export class HookExecutor {
  async executePreToolUse(toolName: string, input: unknown): Promise<void> {
    const hooks = this.hookRegistry.get('PreToolUse');
    for (const hook of hooks ?? []) {
      if (this.matchesCondition(hook.matcher, toolName)) {
        await this.executeHook(hook.hooks);
      }
    }
  }
}
```

#### Phase 3: 命令系统实现

**目标**: 支持自定义斜杠命令

```typescript
// 命令定义
interface CommandDefinition {
  name: string;
  description: string;
  argumentHint?: string;
  model?: string;
  allowedTools?: string[];
  content: string;
}

// 命令执行器
@Injectable()
export class CommandExecutor {
  async execute(commandName: string, args: string[], context: ExecutionContext): Promise<CommandResult> {
    const command = this.registry.getCommand(commandName);
    if (!command) {
      throw new Error(`Command not found: ${commandName}`);
    }

    // 替换变量
    const prompt = this.substituteVariables(command.content, { args, context });

    // 执行 LLM
    return this.llm.generate(prompt, context);
  }
}
```

#### Phase 4: User Config 系统

**目标**: 支持插件用户配置

```typescript
// 用户配置定义
interface UserConfigDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file';
  title: string;
  description: string;
  required?: boolean;
  default?: unknown;
  sensitive?: boolean;
}

// 配置存储
@Injectable()
export class PluginConfigStore {
  async get(pluginName: string, key: string): Promise<string | undefined> {
    // 从安全存储或 settings.json 获取
  }

  async set(pluginName: string, key: string, value: string): Promise<void> {
    // 保存到安全存储或 settings.json
  }
}
```

### 10.3 建议的目录结构

```
src/
├── plugins/                  # 插件系统
│   ├── interfaces/          # 插件接口定义
│   │   ├── plugin.interface.ts
│   │   ├── command.interface.ts
│   │   ├── agent.interface.ts
│   │   └── hook.interface.ts
│   ├── services/
│   │   ├── plugin-loader.service.ts
│   │   ├── plugin-registry.service.ts
│   │   ├── hook-executor.service.ts
│   │   ├── command-executor.service.ts
│   │   └── config-store.service.ts
│   ├── models/
│   │   ├── plugin-manifest.model.ts
│   │   ├── hook-config.model.ts
│   │   └── user-config.model.ts
│   └── utils/
│       ├── variable-substitution.ts
│       └── manifest-validator.ts
├── agents/                   # (现有)
├── orchestration/           # (现有)
└── ...
```

---

## 11. 参考文件

### Claude Code 源码

- `claude-code/src/types/plugin.ts` - 插件类型定义
- `claude-code/src/utils/plugins/pluginLoader.ts` - 插件加载核心
- `claude-code/src/utils/plugins/schemas.ts` - 清单 Schema
- `claude-code/src/utils/plugins/loadPluginAgents.ts` - Agent 加载
- `claude-code/src/utils/plugins/loadPluginCommands.ts` - 命令加载
- `claude-code/src/schemas/hooks.ts` - Hook Schema
- `claude-code/src/entrypoints/sdk/coreTypes.ts` - Hook 事件常量
- `claude-code/src/plugins/builtinPlugins.ts` - 内置插件注册

### PeanutCafe 源码

- `src/agents/` - Agent 模块
- `src/orchestration/orchestration.service.ts` - 工作流服务
- `src/gateway/agent-router.ts` - Agent 路由
- `config/agents.config.json` - 当前 Agent 配置
