# Claude Code Event Hooks 系统分析

## 1. 概述

Claude Code 的 Hook 系统是一个强大的生命周期事件拦截机制，允许在 Agent 执行的各个阶段注入自定义逻辑。本文档从源码角度详细分析其实现，为 PeanutCafe 提供参考。

## 2. 22 种 Hook 事件

Claude Code 定义了 22 种 Hook 事件（`src/entrypoints/sdk/coreTypes.ts:25-53`），覆盖完整的 Agent 生命周期：

```typescript
export const HOOK_EVENTS = [
  'PreToolUse', // 工具调用前
  'PostToolUse', // 工具调用后（成功）
  'PostToolUseFailure', // 工具调用后（失败）
  'Notification', // 通知发送时
  'UserPromptSubmit', // 用户提交消息时
  'SessionStart', // 会话启动时
  'SessionEnd', // 会话结束时
  'Stop', // Agent 停止响应前
  'StopFailure', // Agent 停止失败时
  'SubagentStart', // 子 Agent 启动时
  'SubagentStop', // 子 Agent 停止时
  'PreCompact', // 上下文压缩前
  'PostCompact', // 上下文压缩后
  'PermissionRequest', // 权限请求时
  'PermissionDenied', // 权限被拒时
  'Setup', // 初始化完成时
  'TeammateIdle', // Teammate 空闲时
  'TaskCreated', // 任务创建时
  'TaskCompleted', // 任务完成时
  'Elicitation', // MCP 服务器请求用户输入时
  'ElicitationResult', // Elicitation 结果返回时
  'ConfigChange', // 配置变更时
  'WorktreeCreate', // Worktree 创建时
  'WorktreeRemove', // Worktree 删除时
  'InstructionsLoaded', // 指令加载时
  'CwdChanged', // 工作目录变更时
  'FileChanged', // 文件变更时
] as const;
```

## 3. 6 种 Hook 类型

Hook 配置支持 6 种执行方式（`src/schemas/hooks.ts`）：

| 类型       | 执行方式                      | 适用场景             |
| ---------- | ----------------------------- | -------------------- |
| `command`  | Shell 命令（bash/PowerShell） | 通用脚本、CI 检查    |
| `prompt`   | 注入到 AI 上下文              | 代码规范提醒         |
| `agent`    | 启动子 Agent 执行             | 复杂分析任务         |
| `http`     | HTTP 请求                     | 远程服务、Webhook    |
| `callback` | 内部 JS 函数                  | 系统内置 Hook        |
| `function` | 运行时注册的函数 Hook         | Agent/Skill 内部使用 |

### 3.1 Command Hook Schema

```typescript
// src/schemas/hooks.ts:32-65
const BashCommandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  if: IfConditionSchema(), // 权限规则语法过滤
  shell: z.enum(['bash', 'powershell']).optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
  async: z.boolean().optional(),
  asyncRewake: z.boolean().optional(),
});
```

### 3.2 Prompt Hook Schema

```typescript
// src/schemas/hooks.ts:67-95
const PromptHookSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string(), // 使用 $ARGUMENTS 占位符获取 hook 输入 JSON
  if: IfConditionSchema(),
  timeout: z.number().positive().optional(),
  model: z.string().optional(), // 指定模型，默认为小型快速模型
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});
```

### 3.3 HTTP Hook Schema

```typescript
// src/schemas/hooks.ts:97-126
const HttpHookSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  if: IfConditionSchema(),
  timeout: z.number().positive().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});
```

### 3.4 Agent Hook Schema

```typescript
// src/schemas/hooks.ts:128-163
const AgentHookSchema = z.object({
  type: z.literal('agent'),
  prompt: z.string(), // 使用 $ARGUMENTS 占位符
  if: IfConditionSchema(),
  timeout: z.number().positive().optional(),
  model: z.string().optional(), // 默认为 Haiku
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});
```

## 4. Hook 配置格式

### 4.1 settings.json 中的配置结构

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(git *)",
        "hooks": [
          {
            "type": "command",
            "command": "check-branch.sh",
            "if": "Bash(git push*)",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "检查代码规范: $ARGUMENTS"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://hooks.example.com/session-start"
          }
        ]
      }
    ]
  }
}
```

### 4.2 Hook 匹配语法

```typescript
// src/utils/hooks.ts:1428-1463
// matcher 字段支持三种模式：
"Write"              → 精确匹配
"Write|Edit"         → 管道分隔的多值匹配
"^Bash(git.*)"       → 正则匹配
"*" 或 ""            → 通配（匹配所有）
```

### 4.3 if 条件过滤

使用权限规则语法进行条件匹配：

```json
{
  "hooks": [
    {
      "command": "check-git-branch.sh",
      "if": "Bash(git push*)"
    }
  ]
}
```

## 5. 执行引擎详解

### 5.1 execCommandHook 函数

核心执行逻辑位于 `src/utils/hooks.ts:830-1200`：

```typescript
async function execCommandHook(
  hook: HookCommand & { type: 'command' },
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
  hookName: string,
  jsonInput: string,
  signal: AbortSignal,
  hookId: string,
  hookIndex?: number,
  pluginRoot?: string,
  pluginId?: string,
  skillRoot?: string,
  forceSyncExecution?: boolean,
  requestPrompt?: (request: PromptRequest) => Promise<PromptResponse>,
);
```

### 5.2 Shell 选择逻辑

```typescript
// src/utils/hooks.ts:862-891
const shellType = hook.shell ?? DEFAULT_HOOK_SHELL;
const isPowerShell = shellType === 'powershell';

// Windows bash path: 使用 Git Bash (Cygwin), NOT cmd.exe
// PowerShell path: 使用原生路径
const toHookPath = isWindows && !isPowerShell ? (p: string) => windowsPathToPosixPath(p) : (p: string) => p;
```

### 5.3 环境变量注入

```typescript
// src/utils/hooks.ts:964-992
const envVars: NodeJS.ProcessEnv = {
  ...subprocessEnv(),
  CLAUDE_PROJECT_DIR: toHookPath(projectDir),
};

// Plugin/Skill hooks 设置 CLAUDE_PLUGIN_ROOT
if (pluginRoot) {
  envVars.CLAUDE_PLUGIN_ROOT = toHookPath(pluginRoot);
  if (pluginId) {
    envVars.CLAUDE_PLUGIN_DATA = toHookPath(getPluginDataDir(pluginId));
  }
}

// CLAUDE_ENV_FILE: SessionStart/Setup/CwdChanged/FileChanged 事件
if (
  !isPowerShell &&
  (hookEvent === 'SessionStart' || hookEvent === 'Setup' || hookEvent === 'CwdChanged' || hookEvent === 'FileChanged')
) {
  envVars.CLAUDE_ENV_FILE = await getHookEnvFilePath(hookEvent, hookIndex);
}
```

### 5.4 异步 Hook 检测协议

当 stdout 首行是 `{"async":true}` 时，系统将其转为后台任务：

```typescript
// src/utils/hooks.ts:1199-1246
const firstLine = firstLineOf(stdout).trim()
if (isAsyncHookJSONOutput(parsed)) {
  executeInBackground({
    processId: `async_hook_${child.pid}`,
    asyncResponse: parsed,
    ...
  })
}

// asyncRewake 模式：退出码为 2 时唤醒模型
if (result.code === 2) {
  enqueuePendingNotification({
    value: wrapInSystemReminder(
      `Stop hook blocking error from command "${hookName}": ${stderr || stdout}`,
    ),
    mode: 'task-notification',
  })
}
```

### 5.5 沙箱安全

```typescript
// src/utils/hooks.ts:1041-1089
// 网络沙箱：仅允许 http hook 类型使用网络
if (!isPowerShell && SandboxManager.isSandboxingEnabled()) {
  sandboxedCommand = await SandboxManager.wrapWithSandbox(
    finalCommand,
    undefined,
    {
      network: {
        allowedDomains: [], // 默认拒绝所有出站
        deniedDomains: [],
      },
      filesystem: {
        allowWrite: ['/'],
        denyWrite: [],
        allowRead: [],
        denyRead: [],
      },
    },
    signal,
  );
}
```

## 6. Hook 输出协议

### 6.1 JSON 输出 Schema

同步 Hook 输出遵循严格的 Zod schema（`src/types/hooks.ts:50-166`）：

```typescript
export const syncHookResponseSchema = lazySchema(() =>
  z.object({
    continue: z.boolean().optional(),
    suppressOutput: z.boolean().optional(),
    stopReason: z.string().optional(),
    decision: z.enum(['approve', 'block']).optional(),
    reason: z.string().optional(),
    systemMessage: z.string().optional(),
    hookSpecificOutput: z
      .union([
        z.object({
          hookEventName: z.literal('PreToolUse'),
          permissionDecision: permissionBehaviorSchema().optional(),
          permissionDecisionReason: z.string().optional(),
          updatedInput: z.record(z.string(), z.unknown()).optional(),
          additionalContext: z.string().optional(),
        }),
        z.object({
          hookEventName: z.literal('UserPromptSubmit'),
          additionalContext: z.string().optional(),
        }),
        z.object({
          hookEventName: z.literal('PostToolUse'),
          additionalContext: z.string().optional(),
          updatedMCPToolOutput: z.unknown().optional(),
        }),
        // ... 其他事件特有输出
      ])
      .optional(),
  }),
);
```

### 6.2 各事件的 hookSpecificOutput

| 事件               | 专有字段                                                  | 作用                   |
| ------------------ | --------------------------------------------------------- | ---------------------- |
| `PreToolUse`       | `permissionDecision`, `updatedInput`, `additionalContext` | 拦截/修改工具输入      |
| `UserPromptSubmit` | `additionalContext`                                       | 注入额外上下文         |
| `PostToolUse`      | `additionalContext`, `updatedMCPToolOutput`               | 修改 MCP 工具输出      |
| `SessionStart`     | `initialUserMessage`, `watchPaths`                        | 设置初始消息和文件监控 |
| `PermissionDenied` | `retry`                                                   | 指示是否重试           |
| `Elicitation`      | `action`, `content`                                       | 控制用户输入对话框     |

### 6.3 异步 Hook 响应

```typescript
// src/types/hooks.ts:171-175
const asyncHookResponseSchema = z.object({
  async: z.literal(true),
  asyncTimeout: z.number().optional(),
});
```

## 7. Hook 匹配与去重

### 7.1 多来源合并

```typescript
// src/utils/hooks.ts:137-142
getHooksConfig()
  ├── getHooksConfigFromSnapshot()    // settings.json 中的 Hook
  ├── getRegisteredHooks()            // SDK 注册的 callback Hook
  ├── getSessionHooks()               // Agent/Skill 前置注册的 session Hook
  └── getSessionFunctionHooks()       // 运行时 function Hook
```

### 7.2 去重机制

同一 Hook 命令在不同配置层级可能重复。系统按 `pluginRoot\0command` 做 Map 去重，保留**最后合并的层级**。

### 7.3 工作区信任检查

```typescript
// src/utils/hooks.ts:287-297
export function shouldSkipHookDueToTrust(): boolean {
  const isInteractive = !getIsNonInteractiveSession();
  if (!isInteractive) {
    return false; // SDK 模式信任是隐式的
  }
  const hasTrust = checkHasTrustDialogAccepted();
  return !hasTrust;
}
```

## 8. Hook 事件元数据

每个事件都有详细的元数据描述（`src/utils/hooks/hooksConfigManager.ts:26-267`）：

```typescript
PreToolUse: {
  summary: 'Before tool execution',
  description: 'Input to command is JSON of tool call arguments.\n' +
    'Exit code 0 - stdout/stderr not shown\n' +
    'Exit code 2 - show stderr to model and block tool call\n' +
    'Other exit codes - show stderr to user only but continue',
  matcherMetadata: {
    fieldToMatch: 'tool_name',
    values: toolNames,
  },
}
```

## 9. 四大 Hook 能力

### 9.1 拦截操作（PreToolUse）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny"
  }
}
```

### 9.2 修改行为（updatedInput / updatedMCPToolOutput）

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "updatedInput": { "command": "npm test -- --bail" }
  }
}
```

### 9.3 注入上下文（additionalContext / systemMessage）

- `additionalContext` → 通过 `createAttachmentMessage({ type: 'hook_additional_context' })` 注入
- `systemMessage` → 注入为系统警告，直接显示给用户

### 9.4 控制流程（continue / stopReason）

```json
{ "continue": false, "stopReason": "构建失败，停止执行" }
```

## 10. Session Hook 生命周期

Agent 和 Skill 的前置 Hook 通过 `registerFrontmatterHooks()` 注册：

```typescript
// src/utils/hooks/registerFrontmatterHooks.ts
registerFrontmatterHooks(rootSetAppState, agentId, agentDefinition.hooks, ...)

// Agent 结束时通过 clearSessionHooks() 清理
clearSessionHooks(rootSetAppState, agentId)
```

## 11. PeanutCafe 当前状态

### 11.1 现有架构

PeanutCafe 目前使用以下事件/中间件机制：

1. **WebSocket Gateway** (`src/gateway/chat.gateway.ts`)
   - 事件驱动架构，但仅用于 WebSocket 通信
   - 无统一的 Hook 拦截机制

2. **Orchestration Service** (`src/orchestration/orchestration.service.ts`)
   - 工作流事件类型定义：

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

3. **目录结构**
   - `src/common/interceptors/` - NestJS interceptors（当前为空）
   - `src/common/filters/` - NestJS filters（当前为空）
   - `src/common/types/` - 通用类型定义

### 11.2 当前缺失的功能

| 功能                     | Claude Code | PeanutCafe |
| ------------------------ | ----------- | ---------- |
| PreToolUse 拦截          | ✅          | ❌         |
| PostToolUse 拦截         | ✅          | ❌         |
| 权限检查钩子             | ✅          | ❌         |
| 异步 Hook 执行           | ✅          | ❌         |
| Hook 条件匹配            | ✅          | ❌         |
| 命令修改（updatedInput） | ✅          | ❌         |
| 上下文注入               | ✅          | ❌         |
| HTTP Hook                | ✅          | ❌         |
| Prompt Hook (LLM)        | ✅          | ❌         |
| Session Hook 生命周期    | ✅          | ❌         |

## 12. 差距分析

### 12.1 架构差距

1. **无统一的 Hook 执行引擎**
   - Claude Code 有 `execCommandHook()` 处理所有 hook 类型
   - PeanutCafe 没有对应的中间件/拦截器系统

2. **无事件驱动的拦截点**
   - Claude Code 在工具执行前后、权限检查、会话生命周期等多点提供拦截
   - PeanutCafe 的 `ChatGateway` 直接处理消息，无中间层

3. **无 Hook 配置管理**
   - Claude Code 有完整的 `hooksConfigManager.ts`
   - PeanutCafe 没有对应的配置管理机制

### 12.2 安全模型差距

1. **无工作区信任检查**
   - Claude Code 的 `shouldSkipHookDueToTrust()` 确保 Hook 执行前需要信任
   - PeanutCafe 无此机制

2. **无沙箱隔离**
   - Claude Code 对 Hook 提供网络沙箱
   - PeanutCafe 无对应机制

## 13. 建议实现

### 13.1 推荐的 Hook 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      HookSystem                              │
├─────────────────────────────────────────────────────────────┤
│  HookRegistry        │  配置管理、来源合并、去重             │
│  HookExecutor        │  执行引擎、Shell 选择、超时管理       │
│  HookMatcher         │  条件匹配、正则/精确/通配            │
│  HookOutputProcessor │  JSON Schema 验证、输出协议处理      │
│  AsyncHookManager    │  后台任务、asyncRewake、结果回调     │
└─────────────────────────────────────────────────────────────┘
```

### 13.2 推荐的事件类型

```typescript
// Agent 生命周期事件
type AgentLifecycleEvent =
  | 'agent:start' // Agent 启动前
  | 'agent:stop' // Agent 停止后
  | 'agent:error' // Agent 执行错误
  | 'tool:before' // 工具执行前
  | 'tool:after' // 工具执行后
  | 'tool:error' // 工具执行错误
  | 'permission:ask' // 权限请求
  | 'permission:deny' // 权限拒绝
  | 'session:start' // 会话开始
  | 'session:end' // 会话结束
  | 'handoff:before' // Agent 交接前
  | 'handoff:after' // Agent 交接后
  | 'context:compact'; // 上下文压缩
```

### 13.3 推荐的核心接口

```typescript
// Hook 配置
interface HookConfig {
  id: string;
  name: string;
  event: AgentLifecycleEvent;
  matcher?: string | RegExp;
  type: 'command' | 'prompt' | 'http' | 'function';
  command?: string;
  prompt?: string;
  url?: string;
  handler?: HookHandler;
  if?: string; // 权限规则语法
  timeout?: number;
  async?: boolean;
  once?: boolean;
}

interface HookResult {
  continue: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  reason?: string;
  systemMessage?: string;
  additionalContext?: string;
  updatedInput?: Record<string, unknown>;
  updatedOutput?: unknown;
}

type HookHandler = (
  event: AgentLifecycleEvent,
  input: unknown,
  context: HookContext,
) => Promise<HookResult> | HookResult;
```

### 13.4 NestJS 实现建议

```typescript
// 1. 创建 Hook Module
@Module({
  providers: [HookRegistry, HookExecutor, HookMatcher, HookOutputProcessor, AsyncHookManager],
  exports: [HookRegistry, HookExecutor],
})
export class HookModule {}

// 2. 创建 Hook Interceptor
@Injectable()
export class HookInterceptor implements NestInterceptor {
  constructor(private readonly hookExecutor: HookExecutor) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const event = this.determineEvent(context);
    const input = context.getArgs();

    // Pre-execution hooks
    const preResult = await this.hookExecutor.execute(event + ':before', input);
    if (preResult.decision === 'block') {
      throw new HookBlockedException(preResult.stopReason);
    }

    // Apply updated input if provided
    const modifiedInput = preResult.updatedInput ?? input;

    const result = await next.handle();

    // Post-execution hooks
    await this.hookExecutor.execute(event + ':after', {
      input: modifiedInput,
      output: result,
    });

    return result;
  }
}

// 3. 全局注册
app.useGlobalInterceptors(new HookInterceptor(hookExecutor));
```

### 13.5 配置格式建议

```yaml
# hooks.config.yaml
hooks:
  - id: check-permissions
    name: 权限检查
    event: tool:before
    type: command
    command: ./scripts/check-permissions.sh
    matcher: 'Bash(sudo *)'
    if: 'Bash(sudo rm *)'
    timeout: 30

  - id: inject-context
    name: 上下文注入
    event: agent:start
    type: prompt
    prompt: '检查项目规范: $ARGUMENTS'

  - id: notification
    name: 执行通知
    event: tool:after
    type: http
    url: https://hooks.example.com/notify
```

## 14. 总结

Claude Code 的 Hook 系统是一个设计完善、功能强大的事件拦截框架，提供了：

1. **22 种生命周期事件**覆盖完整的 Agent 执行流程
2. **6 种执行类型**满足不同的扩展需求
3. **强大的条件匹配**支持精确、正则、通配等多种模式
4. **完善的安全机制**包括信任检查和沙箱隔离
5. **灵活的输出协议**支持拦截、修改、注入等多种操作

PeanutCafe 当前缺乏类似的 Hook 系统，建议逐步实现一个简化版本，优先支持：

- 工具执行前后的拦截
- 基本的事件类型
- 命令和函数类型的 Hook
- 简单的条件匹配

## 15. 参考源码

| 文件                                          | 说明                  |
| --------------------------------------------- | --------------------- |
| `src/entrypoints/sdk/coreTypes.ts`            | Hook 事件常量定义     |
| `src/schemas/hooks.ts`                        | Hook 配置 Schema      |
| `src/types/hooks.ts`                          | Hook 输出类型定义     |
| `src/utils/hooks.ts`                          | 主执行引擎 (5177 行)  |
| `src/utils/hooks/hookEvents.ts`               | Hook 事件广播系统     |
| `src/utils/hooks/hooksConfigManager.ts`       | Hook 配置管理         |
| `src/utils/hooks/hooksSettings.ts`            | Hook 设置工具         |
| `src/utils/hooks/execPromptHook.ts`           | Prompt Hook 执行      |
| `src/utils/hooks/execAgentHook.ts`            | Agent Hook 执行       |
| `src/utils/hooks/execHttpHook.ts`             | HTTP Hook 执行        |
| `src/utils/hooks/AsyncHookRegistry.ts`        | 异步 Hook 注册表      |
| `src/utils/hooks/sessionHooks.ts`             | Session Hook 生命周期 |
| `src/utils/hooks/registerFrontmatterHooks.ts` | Agent Hook 注册       |
