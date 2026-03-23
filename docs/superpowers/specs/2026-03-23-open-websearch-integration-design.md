# open-web-search 集成设计

> **目标:** 将 MCP 服务器从 brave-search 替换为 open-web-search，改用 HTTP 传输模式，由 docker-compose 统一管理。

## 背景

当前 `McpServerManager` 通过 Docker spawning 方式运行 brave-search MCP 服务器（STDIO 模式）。需要替换为 open-web-search，支持 HTTP 传输，由 docker-compose 管理容器生命周期。

**约束:**

- NestJS 后端运行在主机端口 3000，open-web-search 使用 3001
- 后端通过 HTTP 调用 MCP 服务器
- 统一由 docker-compose 管理容器

## Architecture

```
NestJS Backend (host:3000)
       │
       │ HTTP (http://localhost:3001/mcp)
       ▼
open-websearch Container (docker:3000 → host:3001)
       │
       ▼
多引擎搜索 (bing, duckduckgo, exa, brave, baidu, csdn, juejin)
```

## 变更范围

### 1. docker-compose.yml

新增 open-websearch 服务:

```yaml
open-websearch:
  image: ghcr.io/aas-ee/open-web-search:latest
  container_name: lobster-open-websearch
  restart: unless-stopped
  ports:
    - '3001:3000'
  environment:
    - ENABLE_CORS=true
    - CORS_ORIGIN=*
    - DEFAULT_SEARCH_ENGINE=bing
    - MODE=http
    - PORT=3000
  healthcheck:
    test: ['CMD', 'curl', '-f', 'http://localhost:3000/mcp']
    interval: 10s
    timeout: 5s
    retries: 5
```

### 2. mcp-config.json

配置从镜像模式改为 URL 模式:

```json
{
  "mcpServers": {
    "open-websearch": {
      "url": "http://localhost:3001/mcp",
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

### 3. McpServerConfig 接口 (mcp.interfaces.ts)

```typescript
interface McpServerConfig {
  image?: string; // 仅 STDIO 模式使用
  url?: string; // 仅 HTTP 模式使用
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
}
```

### 4. McpClientImpl 重构

新增 HTTP 传输层，复用 JSON-RPC 逻辑:

```typescript
export class McpClientImpl {
  // HTTP 模式
  constructor(baseUrl: string) { ... }

  // STDIO 模式 (保留兼容)
  constructor(containerExec: { stdout: Readable; stdin: Writable }, containerId: string) { ... }

  async listTools(): Promise<McpTool[]>
  async callTool(name: string, args: Record<string, unknown>): Promise<string>
}
```

HTTP 请求实现:

```typescript
private async httpRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(this.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}
```

### 5. McpServerManager 重构

区分两种启动模式:

```typescript
async startServer(name: string): Promise<void> {
  const config = this.config[name];

  if (config.url) {
    // HTTP 模式: 直接连接，不创建容器
    const client = new McpClientImpl(config.url);
    await client.connect();
    this.servers.set(name, { name, config, status: ServerStatus.RUNNING, client });
  } else if (config.image) {
    // STDIO 模式: Docker spawning (保留)
    await this.startDockerServer(name, config);
  }
}
```

### 6. 配置更新 (agent-tools-config.json)

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
    }
  }
}
```

## 工具列表

open-websearch 提供以下工具:

| 工具名             | 参数                    | 说明               |
| ------------------ | ----------------------- | ------------------ |
| search             | query, limit?, engines? | 多引擎搜索         |
| fetchCsdnArticle   | url                     | 获取 CSDN 文章内容 |
| fetchGithubReadme  | url                     | 获取 GitHub README |
| fetchJuejinArticle | url                     | 获取掘金文章       |
| fetchWebContent    | url, maxChars?          | 获取任意网页内容   |

## 错误处理

| 场景               | 处理方式                             |
| ------------------ | ------------------------------------ |
| MCP 服务器连接失败 | 返回错误，Agent 提示用户检查容器状态 |
| HTTP 请求超时      | 返回超时错误，timeout 可配置         |
| 工具执行失败       | 返回错误信息给 Agent                 |
| 搜索被限流         | 返回限流提示，建议降低频率           |

## 文件变更清单

| 文件                                 | 操作                     |
| ------------------------------------ | ------------------------ |
| `docker/docker-compose.yml`          | 新增 open-websearch 服务 |
| `config/mcp-config.json`             | 替换为 URL 配置          |
| `config/agent-tools-config.json`     | 更新服务器名称           |
| `src/mcp/mcp.interfaces.ts`          | 扩展 McpServerConfig     |
| `src/mcp/mcp-client.ts`              | 新增 HTTP 传输层         |
| `src/mcp/mcp-server-manager.ts`      | 区分 HTTP/STDIO 模式     |
| `src/mcp/mcp-client.spec.ts`         | 更新测试                 |
| `src/mcp/mcp-server-manager.spec.ts` | 更新测试                 |

## 测试策略

### 单元测试

- `McpClientImpl` — HTTP 请求响应、错误处理
- `McpServerManager` — 配置解析、模式路由

### 集成测试

- 启动 docker-compose，检查 open-websearch 健康状态
- 验证工具调用返回正确结果

### 手动测试

1. `docker-compose up -d open-websearch`
2. 启动 NestJS 应用
3. WebSocket 连接发送搜索请求
4. 验证 open-websearch 工具被调用并返回结果
