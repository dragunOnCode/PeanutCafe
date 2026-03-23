# open-web-search 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MCP 服务器从 brave-search 替换为 open-web-search，改用 HTTP 传输模式

**Architecture:** McpClient 新增 HTTP 传输层，McpServerManager 根据配置区分 HTTP/STDIO 两种模式。HTTP 模式直接连接外部服务，STDIO 模式保留 Docker spawning 兼容旧有服务器。

**Tech Stack:** TypeScript, NestJS, Docker, HTTP/MCP JSON-RPC

---

## File Structure

```
config/
├── mcp-config.json              # 修改: url 配置替代 image
├── agent-tools-config.json      # 修改: 更新服务器名称

src/mcp/
├── mcp.interfaces.ts           # 修改: McpServerConfig 新增 url 字段
├── mcp-client.ts               # 修改: 新增 HTTP 传输层，保留 STDIO 兼容
├── mcp-server-manager.ts       # 修改: 区分 HTTP/STDIO 模式
├── mcp-client.spec.ts          # 修改: HTTP 模式测试
├── mcp-server-manager.spec.ts  # 修改: 配置路由测试

docker/
└── docker-compose.yml          # 修改: 新增 open-websearch 服务
```

---

## Task 1: 更新 McpServerConfig 接口

**Files:**

- Modify: `src/mcp/mcp.interfaces.ts`

- [ ] **Step 1: 添加 URL 配置字段**

```typescript
// src/mcp/mcp.interfaces.ts
export interface McpServerConfig {
  image?: string; // 仅 STDIO 模式使用
  url?: string; // 仅 HTTP 模式使用
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
}
```

- [ ] **Step 2: 运行测试验证**

Run: `npm run test -- src/mcp/mcp.interfaces.spec.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/mcp/mcp.interfaces.ts
git commit -m "feat(mcp): add url field to McpServerConfig for HTTP mode"
```

---

## Task 2: 重构 McpClient 支持 HTTP 传输

**Files:**

- Modify: `src/mcp/mcp-client.ts`
- Modify: `src/mcp/mcp-client.spec.ts`

- [ ] **Step 1: 编写 HTTP 客户端测试**

```typescript
// src/mcp/mcp-client.spec.ts
describe('HttpMcpClient', () => {
  it('should report connected with HTTP URL', () => {
    const client = new McpClientImpl('http://localhost:3001/mcp');
    expect(client.isConnected()).toBe(true);
  });
});
```

- [ ] **Step 2: 实现双模式构造函数**

用以下完整实现替换 `src/mcp/mcp-client.ts`:

```typescript
// src/mcp/mcp-client.ts
import { Logger } from '@nestjs/common';
import { Readable, Writable } from 'stream';
import { McpTool } from './mcp.interfaces.js';

export class McpClientImpl {
  private readonly logger = new Logger(McpClientImpl.name);
  private connected = false;
  private requestId = 0;
  private baseUrl: string | null = null;
  private containerExec: { stdout: Readable; stdin: Writable } | null = null;
  private containerId: string | null = null;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

  // HTTP 模式构造函数
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.connected = true;
  }

  // STDIO 模式构造函数 (保留兼容)
  constructor(containerExec: { stdout: Readable; stdin: Writable }, containerId: string) {
    this.containerExec = containerExec;
    this.containerId = containerId;
    this.connected = false;

    this.containerExec.stdout.on('data', (data: Buffer) => {
      this.handleMessage(data.toString());
    });

    this.containerExec.stdout.on('close', () => {
      this.connected = false;
      this.logger.log('MCP client disconnected');
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    if (this.baseUrl) {
      this.logger.log(`Connected to MCP server: ${this.baseUrl}`);
    } else {
      this.logger.log(`Connected to MCP container: ${this.containerId}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Disconnected')));
    this.pendingRequests.clear();
  }

  async listTools(): Promise<McpTool[]> {
    const response = this.baseUrl ? await this.httpRequest('tools/list', {}) : await this.sendRequest('tools/list', {});
    return (response as { tools: McpTool[] }).tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = this.baseUrl
      ? await this.httpRequest('tools/call', { name, arguments: args })
      : await this.sendRequest('tools/call', { name, arguments: args });
    const content = (response as { content: Array<{ type: string; text?: string }> }).content;
    if (content && content[0]?.type === 'text' && content[0].text) {
      return content[0].text;
    }
    return JSON.stringify(content);
  }

  private async httpRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.baseUrl) throw new Error('Not HTTP mode');

    const id = ++this.requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'MCP error');
    }

    return data.result;
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.containerExec) {
        reject(new Error('Client not connected'));
        return;
      }

      const id = ++this.requestId;
      const request = { jsonrpc: '2.0', id, method, params };

      this.pendingRequests.set(id, { resolve, reject });
      this.containerExec!.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  private handleMessage(data: string): void {
    const lines = data.split('\n').filter((line) => line.trim());
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);
          if (message.error) {
            reject(new Error(message.error.message || 'MCP error'));
          } else {
            resolve(message.result);
          }
        }
      } catch {
        this.logger.warn(`Failed to parse MCP message: ${data}`);
      }
    }
  }
}
```

- [ ] **Step 3: 运行测试验证**

Run: `npm run test -- src/mcp/mcp-client.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/mcp/mcp-client.ts src/mcp/mcp-client.spec.ts
git commit -m "feat(mcp): add HTTP transport to McpClientImpl with dual constructor"
```

---

## Task 3: 重构 McpServerManager 支持 HTTP 模式

**Files:**

- Modify: `src/mcp/mcp-server-manager.ts`
- Modify: `src/mcp/mcp-server-manager.spec.ts`

- [ ] **Step 1: 编写模式路由测试**

```typescript
// src/mcp/mcp-server-manager.spec.ts
it('should route to HTTP mode when url is configured', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
  } as Response);

  const manager = new McpServerManager();
  (manager as any).config = {
    openwebsearch: { url: 'http://localhost:3001/mcp', enabled: true },
  };
  await (manager as any).startServer('openwebsearch');
  expect(manager.getServerStatus('openwebsearch')).toBe(ServerStatus.RUNNING);
});
```

- [ ] **Step 2: 修改 startServer 方法实现模式路由**

将 `src/mcp/mcp-server-manager.ts` 第50-93行的 `startServer` 方法替换为:

```typescript
async startServer(name: string): Promise<void> {
  const config = this.config[name];
  if (!config) {
    throw new Error(`MCP server config not found: ${name}`);
  }

  this.logger.log(`Starting MCP server: ${name}`);

  let client: McpClient;

  if (config.url) {
    // HTTP 模式: 直接连接
    client = new McpClientImpl(config.url);
    await client.connect();

    this.servers.set(name, {
      name,
      config,
      status: ServerStatus.RUNNING,
      client,
    });
  } else if (config.image) {
    // STDIO 模式: Docker spawning
    const container = await this.docker.createContainer({
      Image: config.image,
      Env: this.resolveEnvVars(config.env || {}),
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    await container.start();

    const containerInfo = await container.inspect();
    const containerId = containerInfo.Id;

    const exec = await container.exec({
      AttachStdout: true,
      AttachStdin: true,
      Cmd: ['npx', '-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    client = new McpClientImpl(
      { stdout: stream as unknown as NodeJS.ReadableStream, stdin: stream as unknown as NodeJS.WritableStream },
      containerId,
    );
    await client.connect();

    this.servers.set(name, {
      name,
      config,
      status: ServerStatus.RUNNING,
      client,
      containerId,
    });
  } else {
    throw new Error(`MCP server config must have either url or image: ${name}`);
  }

  this.logger.log(`MCP server started: ${name}`);
}
```

- [ ] **Step 3: 运行测试验证**

Run: `npm run test -- src/mcp/mcp-server-manager.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/mcp/mcp-server-manager.ts src/mcp/mcp-server-manager.spec.ts
git commit -m "feat(mcp): support HTTP mode routing in McpServerManager"
```

---

## Task 4: 更新配置文件

**Files:**

- Modify: `config/mcp-config.json`
- Modify: `config/agent-tools-config.json`

- [ ] **Step 1: 更新 mcp-config.json**

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

- [ ] **Step 2: 更新 agent-tools-config.json**

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

- [ ] **Step 3: 提交**

```bash
git add config/mcp-config.json config/agent-tools-config.json
git commit -m "chore: migrate from brave-search to open-websearch"
```

---

## Task 5: 添加 open-websearch 到 docker-compose

**Files:**

- Modify: `docker/docker-compose.yml`

- [ ] **Step 1: 添加 open-websearch 服务**

在 `docker/docker-compose.yml` 的 services 下添加:

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

同时在 volumes 部分添加:

```yaml
volumes:
  postgres_data:
  redis_data:
  chroma_data:
  minio_data:
  ollama_data:
  open-websearch_data:
```

- [ ] **Step 2: 验证 docker-compose 语法**

Run: `docker-compose -f docker/docker-compose.yml config`
Expected: 无语法错误

- [ ] **Step 3: 提交**

```bash
git add docker/docker-compose.yml
git commit -m "feat: add open-websearch service to docker-compose"
```

---

## Task 6: 集成测试

- [ ] **Step 1: 启动 docker-compose 服务**

Run: `docker-compose -f docker/docker-compose.yml up -d open-websearch`

- [ ] **Step 2: 验证服务健康**

Run: `curl http://localhost:3001/mcp -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`
Expected: 返回 JSON-RPC 响应，包含 tools 列表

- [ ] **Step 3: 启动 NestJS 应用并验证**

Run: `npm run start:dev`
Expected: 应用启动成功，MCP 客户端连接到 open-websearch

- [ ] **Step 4: 提交测试更新**

```bash
git add -A
git commit -m "test: integration verification for open-websearch HTTP mode"
```

---

## Task 7: Lint 和 TypeCheck

- [ ] **Step 1: 运行 lint**

Run: `npm run lint`
Expected: 无错误

- [ ] **Step 2: 运行 typecheck**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交最终更改**

```bash
git add -A
git commit -m "feat: complete open-websearch HTTP integration"
```
