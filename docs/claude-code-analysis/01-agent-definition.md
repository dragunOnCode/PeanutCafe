# Agent 定义格式分析

## 1. Claude Code Agent 定义机制

### 1.1 源码分析

Claude Code 的 Agent 系统采用多层架构，支持内置 Agent 和自定义 Agent 两种模式。

#### 1.1.1 核心类型定义

**源代码位置**: `claude-code/src/tools/AgentTool/loadAgentsDir.ts`

Claude Code 定义了三种 Agent 类型：

```typescript
// 内置 Agent - 动态生成 prompt
export type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: 'built-in';
  baseDir: 'built-in';
  callback?: () => void;
  getSystemPrompt: (params: { toolUseContext: Pick<ToolUseContext, 'options'> }) => string;
};

// 自定义 Agent (用户/项目/策略配置) - prompt 通过闭包存储
export type CustomAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string;
  source: SettingSource;
  filename?: string;
  baseDir?: string;
};

// 插件 Agent - 类似自定义，带插件元数据
export type PluginAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string;
  source: 'plugin';
  filename?: string;
  plugin: string;
};
```

**BaseAgentDefinition 通用字段**:

```typescript
export type BaseAgentDefinition = {
  agentType: string; // Agent 唯一标识符
  whenToUse: string; // 描述何时使用该 Agent (触发描述)
  tools?: string[]; // 允许的工具列表
  disallowedTools?: string[]; // 禁止的工具列表
  skills?: string[]; // 预加载的 Skill 名称
  mcpServers?: AgentMcpServerSpec[]; // Agent 专用的 MCP 服务器
  hooks?: HooksSettings; // Agent 启动时注册的会话钩子
  color?: AgentColorName; // Agent 颜色标识
  model?: string; // 模型选择 (如 'haiku', 'sonnet', 'inherit')
  effort?: EffortValue; // 思考努力级别
  permissionMode?: PermissionMode; // 权限模式
  maxTurns?: number; // 最大交互轮次
  filename?: string; // 原始文件名
  baseDir?: string; // 基础目录
  criticalSystemReminder_EXPERIMENTAL?: string; // 每次用户交互时重新注入的简短提醒
  requiredMcpServers?: string[]; // Agent 可用的 MCP 服务器名称模式
  background?: boolean; // 始终作为后台任务运行
  initialPrompt?: string; // 首次用户交互前附加的内容
  memory?: AgentMemoryScope; // 持久化内存作用域
  isolation?: 'worktree' | 'remote'; // 隔离执行环境
  omitClaudeMd?: boolean; // 从 Agent 的 userContext 中省略 CLAUDE.md 层级
};
```

#### 1.1.2 YAML Frontmatter 结构

**示例 - 内置 Plan Agent** (`claude-code/src/tools/AgentTool/built-in/planAgent.ts`):

```typescript
export const PLAN_AGENT: BuiltInAgentDefinition = {
  agentType: 'Plan',
  whenToUse:
    'Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  tools: EXPLORE_AGENT.tools,
  baseDir: 'built-in',
  model: 'inherit',
  omitClaudeMd: true, // 不需要 CLAUDE.md 规范
  getSystemPrompt: () => getPlanV2SystemPrompt(),
};
```

**示例 - 内置 Explore Agent** (`claude-code/src/tools/AgentTool/built-in/exploreAgent.ts`):

```typescript
export const EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'Explore',
  whenToUse: EXPLORE_WHEN_TO_USE,
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku', // 根据环境选择模型
  omitClaudeMd: true, // 快速搜索不需要 CLAUDE.md 规范
  getSystemPrompt: () => getExploreSystemPrompt(),
};
```

**示例 - statusline-setup Agent** (`claude-code/src/tools/AgentTool/built-in/statuslineSetup.ts`):

```typescript
export const STATUSLINE_SETUP_AGENT: BuiltInAgentDefinition = {
  agentType: 'statusline-setup',
  whenToUse: "Use this agent to configure the user's Claude Code status line setting.",
  tools: ['Read', 'Edit'],
  source: 'built-in',
  baseDir: 'built-in',
  model: 'sonnet',
  color: 'orange', // 颜色标识
  getSystemPrompt: () => STATUSLINE_SYSTEM_PROMPT,
};
```

#### 1.1.3 自定义 Agent 的 Markdown 格式

**源代码位置**: `claude-code/src/tools/AgentTool/loadAgentsDir.ts` 第 541-755 行

自定义 Agent 通过 Markdown 文件定义，YAML frontmatter + Markdown 内容：

```yaml
---
name: my-custom-agent
description: 当需要执行多步骤代码搜索任务时使用此 Agent
model: haiku
tools:
  - Read
  - Grep
  - Glob
effort: medium
permissionMode: dontAsk
mcpServers:
  - my-mcp-server
skills:
  - my-skill
maxTurns: 10
background: false
memory: project
---
This is the system prompt content that defines the agent's behavior...
```

**Zod 验证 Schema** (第 73-99 行):

```typescript
const AgentJsonSchema = lazySchema(() =>
  z.object({
    description: z.string().min(1, 'Description cannot be empty'),
    tools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    prompt: z.string().min(1, 'Prompt cannot be empty'),
    model: z
      .string()
      .trim()
      .min(1, 'Model cannot be empty')
      .transform((m) => (m.toLowerCase() === 'inherit' ? 'inherit' : m))
      .optional(),
    effort: z.union([z.enum(EFFORT_LEVELS), z.number().int()]).optional(),
    permissionMode: z.enum(PERMISSION_MODES).optional(),
    mcpServers: z.array(AgentMcpServerSpecSchema()).optional(),
    hooks: HooksSchema().optional(),
    maxTurns: z.number().int().positive().optional(),
    skills: z.array(z.string()).optional(),
    initialPrompt: z.string().optional(),
    memory: z.enum(['user', 'project', 'local']).optional(),
    background: z.boolean().optional(),
    isolation: (process.env.USER_TYPE === 'ant' ? z.enum(['worktree', 'remote']) : z.enum(['worktree'])).optional(),
  }),
);
```

#### 1.1.4 颜色语义系统

**源代码位置**: `claude-code/src/tools/AgentTool/agentColorManager.ts`

```typescript
export type AgentColorName = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan';

export const AGENT_COLORS: readonly AgentColorName[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
] as const;

export const AGENT_COLOR_TO_THEME_COLOR = {
  red: 'red_FOR_SUBAGENTS_ONLY',
  blue: 'blue_FOR_SUBAGENTS_ONLY',
  green: 'green_FOR_SUBAGENTS_ONLY',
  yellow: 'yellow_FOR_SUBAGENTS_ONLY',
  purple: 'purple_FOR_SUBAGENTS_ONLY',
  orange: 'orange_FOR_SUBAGENTS_ONLY',
  pink: 'pink_FOR_SUBAGENTS_ONLY',
  cyan: 'cyan_FOR_SUBAGENTS_ONLY',
} as const satisfies Record<AgentColorName, keyof Theme>;
```

颜色系统用于在 UI 中区分不同的 Subagent，映射到 Theme 颜色。

#### 1.1.5 描述触发机制 (whenToUse)

`whenToUse` 字段是 Agent 的核心描述，用于：

1. **Agent 选择**: 当用户意图匹配该描述时，系统选择该 Agent
2. **UI 显示**: 在 Agent 列表中显示给用户
3. **Agent 组合**: 协调者 Agent 根据子任务的 `whenToUse` 选择合适的子 Agent

**示例 - 完整的 whenToUse 描述**:

```typescript
// General Purpose Agent
whenToUse: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.';

// Explore Agent
whenToUse: 'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis.';

// Verification Agent
whenToUse: 'Use this agent to verify that implementation work is correct before reporting completion. Invoke after non-trivial tasks (3+ file edits, backend/API changes, infrastructure changes). Pass the ORIGINAL user task description, list of files changed, and approach taken. The agent runs builds, tests, linters, and checks to produce a PASS/FAIL/PARTIAL verdict with evidence.';
```

#### 1.1.6 模型选择机制

Claude Code 支持灵活的模型选择：

```typescript
// 使用 'inherit' 让子 Agent 继承父 Agent 的模型
model: 'inherit';

// 指定具体模型
model: 'haiku'; // 快速轻量
model: 'sonnet'; // 平衡
model: 'opus'; // 高能力

// 环境相关的模型选择
model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku';
```

#### 1.1.7 工具限制机制

**allowed/disallowedTools**:

```typescript
// 精确指定允许的工具
tools: ['Read', 'Grep', 'Glob', 'Bash'];

// 禁止特定工具
disallowedTools: [AGENT_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME, FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME];

// 使用 '*' 表示允许所有工具
tools: ['*'];
```

#### 1.1.8 MCP 服务器集成

```typescript
// 引用现有 MCP 服务器
mcpServers: ['slack', 'github'];

// 内联定义
mcpServers: [{ 'my-server': { type: 'stdio', command: '...' } }];
```

#### 1.1.9 Agent 加载流程

**源代码位置**: `claude-code/src/tools/AgentTool/loadAgentsDir.ts` 第 296-393 行

```typescript
export const getAgentDefinitionsWithOverrides = memoize(async (cwd: string): Promise<AgentDefinitionsResult> => {
  // 1. 简单模式: 仅返回内置 Agent
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    const builtInAgents = getBuiltInAgents();
    return { activeAgents: builtInAgents, allAgents: builtInAgents };
  }

  // 2. 加载 Markdown 文件中的自定义 Agent
  const markdownFiles = await loadMarkdownFilesForSubdir('agents', cwd);

  // 3. 解析每个 Markdown 文件为 Agent
  const customAgents = markdownFiles
    .map(({ filePath, baseDir, frontmatter, content, source }) => {
      return parseAgentFromMarkdown(filePath, baseDir, frontmatter, content, source);
    })
    .filter((agent) => agent !== null);

  // 4. 并行加载插件 Agent
  const pluginAgents = await loadPluginAgents();

  // 5. 合并所有 Agent
  const builtInAgents = getBuiltInAgents();
  const allAgentsList: AgentDefinition[] = [...builtInAgents, ...pluginAgents, ...customAgents];

  // 6. 去重并初始化颜色
  const activeAgents = getActiveAgentsFromList(allAgentsList);

  return {
    activeAgents,
    allAgents: allAgentsList,
  };
});
```

---

## 2. PeanutCafe 现状分析

### 2.1 当前实现

**Agent 定义位置**: `src/agents/adapters/` 目录下有三个 Adapter 实现

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
      "priority": {
        "basePriority": 100,
        "quotaLimit": 100000
      }
    },
    {
      "id": "codex-001",
      "name": "Codex",
      "type": "codex",
      "model": "codex",
      "role": "代码审查与质量把控",
      "capabilities": ["代码审查", "测试建议", "性能优化", "安全检测"],
      "callType": "http",
      "enabled": true,
      "priority": {
        "basePriority": 80,
        "quotaLimit": 80000
      }
    },
    {
      "id": "gemini-001",
      "name": "Gemini",
      "type": "gemini",
      "model": "gemini-2.0-flash-thinking",
      "role": "创意发散与视觉设计",
      "capabilities": ["创意建议", "UI/UX设计", "视觉方案", "用户体验"],
      "callType": "http",
      "enabled": true,
      "priority": {
        "basePriority": 80,
        "quotaLimit": 80000
      }
    }
  ]
}
```

**Agent 工具配置**: `config/agent-tools-config.json`

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

### 2.2 现有代码

**Agent 接口定义** (`src/agents/interfaces/llm-adapter.interface.ts`):

```typescript
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

**Adapter 示例** (`src/agents/adapters/claude.adapter.ts`):

```typescript
@Injectable()
export class ClaudeAdapter implements ILLMAdapter {
  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'MiniMax-M2.5';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType: 'http' = 'http';

  // 实现 generate, streamGenerate, shouldRespond, healthCheck, getStatus 方法
}
```

**Agent 配置服务** (`src/agents/services/agent-config.service.ts`):

```typescript
@Injectable()
export class AgentConfigService implements OnModuleInit {
  private agents: Map<string, AgentConfig> = new Map();

  onModuleInit() {
    this.loadConfig(); // 从 config/agents.config.json 加载配置
  }

  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  getEnabledAgents(): AgentConfig[] {
    return Array.from(this.agents.values()).filter((a) => a.enabled);
  }
}
```

### 2.3 当前架构问题

1. **Agent 定义硬编码**: 每个 Agent 的配置直接写在代码里（Adapter 类）
2. **无动态加载**: 没有从文件系统加载 Agent 定义的能力
3. **缺少 whenToUse 描述**: 没有描述性字段用于 Agent 选择
4. **无工具限制机制**: `agent-tools-config.json` 是静态配置，无法运行时修改
5. **无模型灵活选择**: 模型直接写在代码里
6. **无 MCP 服务器动态绑定**: MCP 服务器配置与 Agent 定义分离
7. **无 Subagent/Worker 机制**: 无法动态创建子 Agent
8. **缺少颜色语义系统**: 无 UI 层面的 Agent 区分机制

---

## 3. 差距分析 & 补齐方案

### 3.1 需要补齐的功能点

| 功能                             | Claude Code | PeanutCafe      | 优先级 |
| -------------------------------- | ----------- | --------------- | ------ |
| YAML/Markdown Agent 定义         | ✅ 完整支持 | ❌ 仅 JSON 配置 | P0     |
| whenToUse 描述触发               | ✅ 完整支持 | ❌ 无           | P0     |
| 工具限制 (tools/disallowedTools) | ✅ 完整支持 | ❌ 仅静态配置   | P1     |
| 模型灵活选择 (inherit/specific)  | ✅ 完整支持 | ❌ 硬编码       | P1     |
| MCP 服务器动态绑定               | ✅ 完整支持 | ⚠️ 分离配置     | P1     |
| 颜色语义系统                     | ✅ 完整支持 | ❌ 无           | P2     |
| 内存作用域 (memory)              | ✅ 完整支持 | ❌ 无           | P2     |
| 隔离执行环境 (isolation)         | ✅ 完整支持 | ❌ 无           | P2     |
| 关键提醒注入                     | ✅ 支持     | ❌ 无           | P2     |
| 最大轮次限制 (maxTurns)          | ✅ 完整支持 | ❌ 无           | P2     |
| 预加载技能 (skills)              | ✅ 完整支持 | ❌ 无           | P2     |
| 权限模式 (permissionMode)        | ✅ 完整支持 | ❌ 无           | P2     |
| 思考努力级别 (effort)            | ✅ 完整支持 | ❌ 无           | P2     |
| 后台执行模式 (background)        | ✅ 完整支持 | ❌ 无           | P2     |

### 3.2 建议的实现方案

#### 3.2.1 Agent 定义格式

建议 PeanutCafe 采用与 Claude Code 类似的 Markdown + YAML frontmatter 格式：

```markdown
---
name: code-reviewer
description: 当需要审查代码质量、检查安全漏洞或评估代码性能时使用此 Agent
model: inherit
tools:
  - read_file
  - write_file
  - search_code
  - execute_command
effort: medium
permissionMode: dontAsk
mcpServers:
  - code-analysis-mcp
skills:
  - security-check
  - performance-analysis
maxTurns: 15
background: false
memory: project
color: blue
---

# Code Reviewer Agent

You are an expert code reviewer. Your role is to...

## Review Guidelines

1. Check code quality and style
2. Identify potential bugs
3. Suggest performance improvements
4. Look for security vulnerabilities
```

#### 3.2.2 核心类型定义

```typescript
// src/agents/interfaces/agent-definition.ts

export type AgentColorName = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan';

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export type PermissionMode = 'ask' | 'dontAsk' | 'bypassRestrictions';

export type MemoryScope = 'user' | 'project' | 'local';

export interface BaseAgentDefinition {
  agentType: string;
  whenToUse: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  mcpServers?: string[];
  color?: AgentColorName;
  model?: string; // 'inherit' 或具体模型名
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  maxTurns?: number;
  background?: boolean;
  memory?: MemoryScope;
  initialPrompt?: string;
  criticalReminder?: string;
  requiredMcpServers?: string[];
}

export interface BuiltInAgentDefinition extends BaseAgentDefinition {
  source: 'built-in';
  getSystemPrompt: (context: ToolUseContext) => string;
}

export interface CustomAgentDefinition extends BaseAgentDefinition {
  source: 'user' | 'project';
  filename: string;
  baseDir: string;
  getSystemPrompt: () => string;
}
```

#### 3.2.3 Agent 加载服务

```typescript
// src/agents/services/agent-loader.service.ts

import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter } from '../utils/frontmatter-parser';

export class AgentLoaderService {
  private agents: Map<string, AgentDefinition> = new Map();

  async loadAgentsFromDirectory(dirPath: string): Promise<AgentDefinition[]> {
    const files = await fs.promises.readdir(dirPath);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const agents: AgentDefinition[] = [];
    for (const file of mdFiles) {
      const agent = await this.parseAgentFile(path.join(dirPath, file));
      if (agent) {
        agents.push(agent);
        this.agents.set(agent.agentType, agent);
      }
    }
    return agents;
  }

  private async parseAgentFile(filePath: string): Promise<AgentDefinition | null> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const { frontmatter, content: body } = parseFrontmatter(content);

    if (!frontmatter.name || !frontmatter.description) {
      return null;
    }

    return {
      agentType: frontmatter.name,
      whenToUse: frontmatter.description,
      tools: frontmatter.tools,
      disallowedTools: frontmatter.disallowedTools,
      model: frontmatter.model,
      effort: frontmatter.effort,
      permissionMode: frontmatter.permissionMode,
      mcpServers: frontmatter.mcpServers,
      skills: frontmatter.skills,
      maxTurns: frontmatter.maxTurns,
      background: frontmatter.background,
      memory: frontmatter.memory,
      color: frontmatter.color,
      initialPrompt: frontmatter.initialPrompt,
      source: 'project',
      filename: path.basename(filePath, '.md'),
      baseDir: path.dirname(filePath),
      getSystemPrompt: () => body.trim(),
    };
  }

  getAgent(agentType: string): AgentDefinition | undefined {
    return this.agents.get(agentType);
  }

  selectAgent(userIntent: string): AgentDefinition | undefined {
    // 根据 userIntent 匹配 whenToUse 描述
    // 实现意图识别逻辑
  }
}
```

#### 3.2.4 优先级建议

**Phase 1 - 基础框架**:

1. 定义 `AgentDefinition` 类型接口
2. 实现 `AgentLoaderService` 从 Markdown 加载 Agent
3. 迁移现有 JSON 配置到 Markdown 格式

**Phase 2 - 核心功能**:

1. 实现 `whenToUse` 描述触发机制
2. 实现工具限制机制 (tools/disallowedTools)
3. 实现模型灵活选择 (inherit/specific)
4. 集成 MCP 服务器动态绑定

**Phase 3 - 高级功能**:

1. 实现颜色语义系统
2. 实现内存作用域
3. 实现思考努力级别
4. 实现后台执行模式

### 3.3 关键差异总结

| 维度     | Claude Code                        | PeanutCafe 建议             |
| -------- | ---------------------------------- | --------------------------- |
| 定义格式 | Markdown + YAML frontmatter        | Markdown + YAML frontmatter |
| 触发机制 | whenToUse 描述匹配                 | whenToUse 描述匹配          |
| 工具限制 | 运行时解析                         | 运行时解析                  |
| 模型选择 | inherit/specific/haiku/sonnet/opus | inherit/specific            |
| 内存管理 | user/project/local 作用域          | user/project/local 作用域   |
| 隔离执行 | worktree/remote                    | worktree (初期)             |
| 插件系统 | 支持插件扩展                       | 可扩展架构                  |

---

## 参考文件

### Claude Code 源码

- `claude-code/src/tools/AgentTool/loadAgentsDir.ts` - Agent 加载核心
- `claude-code/src/tools/AgentTool/builtInAgents.ts` - 内置 Agent 注册
- `claude-code/src/tools/AgentTool/built-in/*.ts` - 各内置 Agent 实现
- `claude-code/src/tools/AgentTool/agentColorManager.ts` - 颜色管理
- `claude-code/src/utils/markdownConfigLoader.ts` - Markdown 文件加载
- `claude-code/src/utils/frontmatterParser.ts` - Frontmatter 解析

### PeanutCafe 源码

- `src/agents/agents.module.ts` - Agent Module
- `src/agents/interfaces/llm-adapter.interface.ts` - Adapter 接口
- `src/agents/adapters/*.ts` - 各 Adapter 实现
- `src/agents/services/agent-config.service.ts` - 配置服务
- `config/agents.config.json` - 当前配置
