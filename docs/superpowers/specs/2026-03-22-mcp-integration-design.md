# MCP 集成设计

> **目标:** 给 Agent 添加 MCP（Model Context Protocol）工具调用能力，支持接入外部 MCP 服务器（如 Brave Search）实现联网搜索等功能。

## 背景

当前 Agent 已具备本地工具调用能力（read_file、write_file、execute_command），但缺少联网搜索等外部工具能力。通过集成 MCP 协议，可以标准化的方式接入各类外部服务和工具。

## Architecture Overview

```
Agent (<tool_call>)
    │
    ▼
ToolExecutorService（统一执行入口）
    │
    ▼
ToolRegistry（工具注册表）
    │
    ├──┬─────────────────┬─────────────────┐
    │  │                 │                 │
    ▼  ▼                 ▼                 ▼
本地工具              MCP 工具
(read_file,          (McpClient)
write_file,
execute_command)
                        │
                        ▼
               McpServerManager
                        │
                        ▼
               Docker 容器
               (MCP Servers)
                        │
                        ▼
               外部 MCP 服务器
               (Brave Search, GitHub, etc.)
```

## 核心组件

### 1. McpServerManager

**文件:** `src/mcp/mcp-server-manager.ts`

职责：

- 读取并解析 MCP 配置文件
- 管理 MCP 服务器容器生命周期（启动、停止、健康检查）
- 维护 MCP 服务器连接状态

```typescript
interface McpServerConfig {
  image: string; // Docker 镜像
  env?: Record<string, string>; // 环境变量
  enabled: boolean; // 是否启用
  timeout?: number; // 超时时间（ms）
}

interface McpServerManager {
  initialize(configPath: string): Promise<void>;
  startServer(name: string): Promise<void>;
  stopServer(name: string): Promise<void>;
  getServerStatus(name: string): ServerStatus;
  getClient(name: string): McpClient; // 获取指定服务器的 MCP 客户端
  dispose(): Promise<void>;
}

enum ServerStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
}
```

### 2. McpClient

**文件:** `src/mcp/mcp-client.ts`

职责：

- 与 MCP 服务器进程通过 STDIO 协议通信
- 发送 MCP 请求（tools/call、tools/list）
- 解析 MCP 响应

```typescript
interface McpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  isConnected(): boolean;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}
```

### 3. McpToolRegistry

**文件:** `src/mcp/mcp-tool-registry.ts`

职责：

- 将 MCP 工具注册到 ToolRegistry
- 处理 MCP 工具到本地工具的桥接
- 管理工具名称前缀（避免冲突）

```typescript
@Injectable()
export class McpToolRegistry {
  constructor(
    private readonly mcpServerManager: McpServerManager,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async registerServerTools(serverName: string): Promise<void>;
  async unregisterServerTools(serverName: string): Promise<void>;
  async reloadAllTools(): Promise<void>;
}
```

### 4. 配置文件

**文件:** `config/mcp-config.json`

```json
{
  "mcpServers": {
    "brave-search": {
      "image": "mcp/brave-search",
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

**环境变量替换:** 配置中的 `${VAR_NAME}` 会被替换为对应的环境变量值。

### 5. Agent 工具配置

**文件:** `config/agent-tools-config.json`

```json
{
  "agentTools": {
    "claude": {
      "mcpServers": ["brave-search"],
      "localTools": ["read_file", "write_file", "list_files", "execute_command"]
    },
    "codex": {
      "mcpServers": ["brave-search"],
      "localTools": ["read_file", "write_file"]
    },
    "gemini": {
      "mcpServers": [],
      "localTools": ["read_file", "write_file"]
    }
  }
}
```

## 执行流程

### 工具调用流程

```
1. Agent 生成 <tool_call>{"name": "brave_web_search", "args": {"query": "..."}}
       │
2. ToolExecutorService 解析工具调用
       │
3. ToolRegistry 查找工具 → 发现是 MCP 工具
       │
4. McpToolRegistry 路由到对应的 McpClient
       │
5. McpClient 通过 STDIO 发送 call_tool 请求到 Docker 容器
       │
6. MCP 服务器执行搜索，返回结果
       │
7. ToolExecutorService 将结果注入 conversationHistory
       │
8. Agent 继续生成，收到工具执行结果
```

### 应用启动流程

```
1. 应用启动
       │
2. McpServerManager 读取 config/mcp-config.json
       │
3. 对于每个 enabled 的 MCP 服务器：
       │   3.1 创建 Docker 容器
       │   3.2 等待容器就绪
       │   3.3 McpClient 连接 STDIO
       │   3.4 调用 listTools 获取可用工具
       │   3.5 注册工具到 ToolRegistry
       │
4. Agent 注册工具配置
       │
5. 应用就绪
```

## ToolExecutorService 修改

现有 `ToolExecutorService` 无需感知工具是本地还是 MCP。只需在 `executeToolCall` 时：

```typescript
async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const tool = this.toolRegistry.getTool(toolCall.name);

  if (!tool) {
    return { toolCallId: toolCall.id, toolName: toolCall.name,
             success: false, error: 'Tool not found' };
  }

  try {
    const result = await tool.execute(toolCall.args);
    return { toolCallId: toolCall.id, toolName: toolCall.name,
             success: true, result };
  } catch (error) {
    return { toolCallId: toolCall.id, toolName: toolCall.name,
             success: false, error: error.message };
  }
}
```

MCP 工具在注册时会被包装成符合 `Tool` 接口的形式：

```typescript
const mcpToolAdapter: Tool = {
  name: `brave-search.${mcpTool.name}`, // 前缀避免冲突
  description: mcpTool.description,
  parameters: mcpTool.inputSchema,
  execute: async (args) => {
    const client = this.mcpServerManager.getClient('brave-search');
    return await client.callTool(mcpTool.name, args);
  },
};
```

## Docker 管理

### 容器生命周期

```typescript
async startServer(name: string, config: McpServerConfig): Promise<void> {
  // 1. 创建容器
  const container = await docker.createContainer({
    Image: config.image,
    Env: this.resolveEnvVars(config.env),
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: config.args || [],
  });

  // 2. 启动容器
  await container.start();

  // 3. 创建 STDIO 连接
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });

  // 4. 初始化 MCP 客户端
  const client = new McpClient(stream);
  await client.connect();

  this.servers.set(name, { container, client, status: ServerStatus.RUNNING });
}
```

## 错误处理

| 场景             | 处理方式                 |
| ---------------- | ------------------------ |
| MCP 服务器未启动 | 返回错误，Agent 提示用户 |
| MCP 服务器超时   | 返回超时错误，容错处理   |
| 工具执行失败     | 返回错误信息给 Agent     |
| Docker 容器崩溃  | 自动重启（最多 3 次）    |
| MCP 协议错误     | 断开连接，重新初始化     |

## 文件结构

```
src/
├── mcp/
│   ├── mcp-server-manager.ts    # MCP 服务器管理
│   ├── mcp-client.ts            # MCP 协议客户端
│   ├── mcp-tool-registry.ts    # MCP 工具注册
│   ├── mcp.interfaces.ts        # 接口定义
│   └── index.ts                 # 导出
├── agents/
│   └── tools/
│       └── ...                  # 现有工具（无需修改）
config/
├── mcp-config.json              # MCP 服务器配置
└── agent-tools-config.json      # Agent 工具配置
```

## 依赖

```json
{
  "@modelcontextprotocol/sdk": "^0.5.0",
  "dockerode": "^4.0.0"
}
```

## 测试策略

### 单元测试

- `McpServerManager` — 配置解析、容器生命周期
- `McpClient` — STDIO 通信、请求响应
- `McpToolRegistry` — 工具注册、路由

### 集成测试

- MCP 服务器启动和连接
- 工具调用完整流程
- 多服务器并发

### 手动测试

1. 启动应用
2. 连接 WebSocket
3. 发送：`@Claude 搜索最新的人工智能新闻`
4. 验证 Brave Search 工具被调用并返回结果
5. 验证结果被正确注入对话历史
