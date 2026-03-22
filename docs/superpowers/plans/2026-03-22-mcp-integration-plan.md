# MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Model Context Protocol (MCP) to enable agents to call external MCP servers (e.g., Brave Search) via Docker containers.

**Architecture:**

- New `McpModule` manages MCP server lifecycle via Docker containers
- `McpToolRegistry` bridges MCP tools to existing `ToolRegistry`
- Agent tool configuration stored in `config/agent-tools-config.json`
- Existing `ToolExecutorService` unchanged - handles all tool execution uniformly

**Tech Stack:** NestJS, Dockerode, @modelcontextprotocol/sdk

---

## File Structure

```
src/
├── mcp/                              # NEW MODULE
│   ├── mcp.interfaces.ts             # Interface definitions
│   ├── mcp-client.ts                 # STDIO protocol client
│   ├── mcp-server-manager.ts         # Docker container lifecycle
│   ├── mcp-tool-registry.ts          # Bridge to ToolRegistry
│   ├── mcp.module.ts                 # NestJS module
│   └── index.ts                      # Exports
├── agents/
│   ├── agents.module.ts              # MODIFY - import McpModule
│   └── tools/                        # Existing - no changes needed
config/
├── mcp-config.json                   # MCP server definitions
└── agent-tools-config.json           # Per-agent tool assignments
```

---

## Task 1: Create MCP Interfaces

**Files:**

- Create: `src/mcp/mcp.interfaces.ts`
- Test: `src/mcp/mcp.interfaces.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ServerStatus, McpServerConfig, McpClient, McpTool } from './mcp.interfaces';

describe('McpInterfaces', () => {
  describe('ServerStatus', () => {
    it('should have correct enum values', () => {
      expect(ServerStatus.STOPPED).toBe('stopped');
      expect(ServerStatus.STARTING).toBe('starting');
      expect(ServerStatus.RUNNING).toBe('running');
      expect(ServerStatus.ERROR).toBe('error');
    });
  });

  describe('McpServerConfig', () => {
    it('should accept valid config', () => {
      const config: McpServerConfig = {
        image: 'mcp/brave-search',
        enabled: true,
        timeout: 30000,
      };
      expect(config.image).toBe('mcp/brave-search');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="mcp.interfaces.spec.ts"`  
Expected: FAIL - file not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mcp/mcp.interfaces.ts

export enum ServerStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
}

export interface McpServerConfig {
  image: string;
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
}

export interface McpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  isConnected(): boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ServerInfo {
  name: string;
  config: McpServerConfig;
  status: ServerStatus;
  client: McpClient;
  containerId: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="mcp.interfaces.spec.ts"`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp.interfaces.ts src/mcp/mcp.interfaces.spec.ts
git commit -m "feat(mcp): add MCP interface definitions"
```

---

## Task 2: Create McpClient (STDIO Protocol Client)

**Files:**

- Create: `src/mcp/mcp-client.ts`
- Test: `src/mcp/mcp-client.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { McpClient } from './mcp-client';
import { Readable, Writable } from 'stream';

describe('McpClient', () => {
  let mockStdin: Writable;
  let mockStdout: Readable;

  beforeEach(() => {
    mockStdout = new Readable({
      read() {
        this.push('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n');
      },
    });
    mockStdin = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });
  });

  it('should create client with streams', () => {
    const client = new McpClient(mockStdout, mockStdin);
    expect(client).toBeDefined();
  });

  it('should report not connected initially', () => {
    const client = new McpClient(mockStdout, mockStdin);
    expect(client.isConnected()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="mcp-client.spec.ts"`  
Expected: FAIL - file not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mcp/mcp-client.ts

import { Injectable, Logger } from '@nestjs/common';
import { McpClient as IMcpClient, McpTool } from './mcp.interfaces';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

@Injectable()
export class McpClientImpl implements IMcpClient {
  private readonly logger = new Logger(McpClientImpl.name);
  private client: Client | null = null;
  private connected = false;

  constructor(
    private readonly stdout: NodeJS.ReadableStream,
    private readonly stdin: NodeJS.WritableStream,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    const transport = new StdioClientTransport({
      stdin: this.stdin,
      stdout: this.stdout,
    });

    this.client = new Client(
      {
        name: 'peanutcafe-mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    await this.client.connect(transport);
    this.connected = true;
    this.logger.log('MCP client connected');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.connected = false;
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.client) {
      throw new Error('Client not connected');
    }
    const response = await this.client.request({ method: 'tools/list' }, { method: 'tools/list', params: {} });
    return response.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      throw new Error('Client not connected');
    }
    const response = await this.client.request(
      { method: 'tools/call' },
      { method: 'tools/call', params: { name, arguments: args } },
    );
    return response.content?.[0]?.text || '';
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

**Note:** The SDK constructor requires streams passed during construction, not in connect(). Adjust implementation based on SDK actual API after installation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="mcp-client.spec.ts"`  
Expected: PASS (after npm install dependencies)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-client.ts src/mcp/mcp-client.spec.ts
git commit -m "feat(mcp): implement McpClient STDIO protocol client"
```

---

## Task 3: Create McpServerManager (Docker Container Lifecycle)

**Files:**

- Create: `src/mcp/mcp-server-manager.ts`
- Test: `src/mcp/mcp-server-manager.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { McpServerManager, McpServerConfig, ServerStatus } from './mcp-server-manager';

describe('McpServerManager', () => {
  let manager: McpServerManager;

  beforeEach(() => {
    manager = new McpServerManager();
  });

  it('should create manager instance', () => {
    expect(manager).toBeDefined();
  });

  it('should return STOPPED status for unknown server', () => {
    expect(manager.getServerStatus('unknown')).toBe(ServerStatus.STOPPED);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="mcp-server-manager.spec.ts"`  
Expected: FAIL - file not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mcp/mcp-server-manager.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import { McpServerConfig, ServerStatus, McpClient, ServerInfo } from './mcp.interfaces';

@Injectable()
export class McpServerManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpServerManager.name);
  private docker: Docker;
  private servers = new Map<string, ServerInfo>();
  private config: Record<string, McpServerConfig> = {};

  constructor() {
    this.docker = new Docker();
  }

  async onModuleInit(): Promise<void> {
    const configPath = path.join(process.cwd(), 'config', 'mcp-config.json');
    await this.initialize(configPath);
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose();
  }

  async initialize(configPath: string): Promise<void> {
    if (!fs.existsSync(configPath)) {
      this.logger.warn(`MCP config not found at ${configPath}`);
      return;
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    this.config = config.mcpServers || {};

    for (const [name, serverConfig] of Object.entries(this.config)) {
      if (serverConfig.enabled) {
        await this.startServer(name);
      }
    }
  }

  async startServer(name: string): Promise<void> {
    const config = this.config[name];
    if (!config) {
      throw new Error(`MCP server config not found: ${name}`);
    }

    this.logger.log(`Starting MCP server: ${name}`);
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

    const stdoutStream = await container.attach({
      stream: true,
      stdout: true,
      stderr: false,
    });

    const stdinStream = await container.attach({
      stream: true,
      stdin: true,
      stdout: false,
      stderr: false,
    });

    const { McpClientImpl } = await import('./mcp-client');
    const client = new McpClientImpl(stdoutStream, stdinStream);
    await client.connect();

    this.servers.set(name, {
      name,
      config,
      status: ServerStatus.RUNNING,
      client,
      containerId,
    });

    this.logger.log(`MCP server started: ${name}`);
  }

  async stopServer(name: string): Promise<void> {
    const info = this.servers.get(name);
    if (!info) return;

    await info.client.disconnect();
    const container = this.docker.getContainer(info.containerId);
    try {
      await container.stop();
      await container.remove();
    } catch (e) {
      this.logger.warn(`Error stopping container ${name}: ${e.message}`);
    }
    this.servers.delete(name);
  }

  getServerStatus(name: string): ServerStatus {
    const info = this.servers.get(name);
    return info?.status || ServerStatus.STOPPED;
  }

  getClient(name: string): McpClient {
    const info = this.servers.get(name);
    if (!info) {
      throw new Error(`MCP server not found: ${name}`);
    }
    return info.client;
  }

  async dispose(): Promise<void> {
    for (const name of Array.from(this.servers.keys())) {
      await this.stopServer(name);
    }
  }

  private resolveEnvVars(env: Record<string, string>): string[] {
    return Object.entries(env).map(([key, value]) => {
      const resolved = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
        return process.env[varName] || '';
      });
      return `${key}=${resolved}`;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="mcp-server-manager.spec.ts"`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-server-manager.ts src/mcp/mcp-server-manager.spec.ts
git commit -m "feat(mcp): implement McpServerManager for Docker container lifecycle"
```

---

## Task 4: Create McpToolRegistry (Bridge to ToolRegistry)

**Files:**

- Create: `src/mcp/mcp-tool-registry.ts`
- Test: `src/mcp/mcp-tool-registry.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { McpToolRegistry } from './mcp-tool-registry';
import { ToolRegistry } from '../agents/tools/tool-registry';
import { McpServerManager } from './mcp-server-manager';

describe('McpToolRegistry', () => {
  let mcpToolRegistry: McpToolRegistry;
  let toolRegistry: jest.Mocked<ToolRegistry>;
  let serverManager: jest.Mocked<McpServerManager>;

  beforeEach(() => {
    toolRegistry = {
      registerTool: jest.fn(),
      getTool: jest.fn(),
    } as any;
    serverManager = {
      getClient: jest.fn(),
    } as any;
    mcpToolRegistry = new McpToolRegistry(serverManager, toolRegistry);
  });

  it('should register tools from MCP server', async () => {
    const mockClient = {
      listTools: jest.fn().mockResolvedValue([{ name: 'web_search', description: 'Search the web', inputSchema: {} }]),
    };
    serverManager.getClient.mockReturnValue(mockClient);

    await mcpToolRegistry.registerServerTools('brave-search');

    expect(toolRegistry.registerTool).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="mcp-tool-registry.spec.ts"`  
Expected: FAIL - file not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mcp/mcp-tool-registry.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { McpServerManager } from './mcp-server-manager';
import { ToolRegistry, Tool } from '../agents/tools/tool-registry';
import { McpTool } from './mcp.interfaces';

@Injectable()
export class McpToolRegistry implements OnModuleInit {
  private readonly logger = new Logger(McpToolRegistry.name);
  private initialized = false;

  constructor(
    private readonly mcpServerManager: McpServerManager,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.initialized) return;
    await this.registerAllServerTools();
    this.initialized = true;
  }

  private async registerAllServerTools(): Promise<void> {
    const configPath = path.join(process.cwd(), 'config', 'mcp-config.json');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    const mcpServers = config.mcpServers || {};

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      if (serverConfig.enabled) {
        try {
          await this.registerServerTools(name);
        } catch (e) {
          this.logger.error(`Failed to register tools for ${name}: ${e.message}`);
        }
      }
    }
  }

  async registerServerTools(serverName: string): Promise<void> {
    const client = this.mcpServerManager.getClient(serverName);
    const tools = await client.listTools();

    for (const tool of tools) {
      const mcpTool = tool as McpTool;
      const adaptedTool: Tool = {
        name: `${serverName}.${mcpTool.name}`,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema,
        execute: async (args) => {
          return await client.callTool(mcpTool.name, args);
        },
      };

      this.toolRegistry.registerTool(adaptedTool);
      this.logger.log(`Registered MCP tool: ${adaptedTool.name}`);
    }
  }

  async unregisterServerTools(serverName: string): Promise<void> {
    // Tool removal would require adding unregister method to ToolRegistry
    this.logger.warn(`Unregister not fully implemented for: ${serverName}`);
  }

  async reloadAllTools(): Promise<void> {
    // Re-initialize all MCP servers and their tools
    this.logger.log('Reloading all MCP tools');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="mcp-tool-registry.spec.ts"`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/mcp-tool-registry.ts src/mcp/mcp-tool-registry.spec.ts
git commit -m "feat(mcp): implement McpToolRegistry to bridge MCP tools to ToolRegistry"
```

---

## Task 5: Create McpModule

**Files:**

- Create: `src/mcp/mcp.module.ts`
- Modify: `src/agents/agents.module.ts`

- [ ] **Step 1: Write the failing test (module integration)**

```typescript
import { Test } from '@nestjs/testing';
import { McpModule } from './mcp.module';
import { AgentsModule } from '../agents/agents.module';

describe('McpModule', () => {
  it('should be importable', async () => {
    const module = await Test.createTestingModule({
      imports: [McpModule],
    }).compile();

    expect(module).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="mcp.module.spec.ts"`  
Expected: FAIL - file not found

- [ ] **Step 3: Write McpModule**

```typescript
// src/mcp/mcp.module.ts

import { Module } from '@nestjs/common';
import { McpServerManager } from './mcp-server-manager';
import { McpToolRegistry } from './mcp-tool-registry';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [AgentsModule],
  providers: [McpServerManager, McpToolRegistry],
  exports: [McpServerManager, McpToolRegistry],
})
export class McpModule {}
```

- [ ] **Step 4: Write index.ts**

```typescript
// src/mcp/index.ts

export * from './mcp.interfaces';
export * from './mcp-client';
export * from './mcp-server-manager';
export * from './mcp-tool-registry';
export * from './mcp.module';
```

- [ ] **Step 5: Update AgentsModule to import McpModule**

```typescript
// src/agents/agents.module.ts (MODIFY)

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
import { McpModule } from '../mcp/mcp.module';

@Module({
  imports: [HttpModule, ConfigModule.forFeature(apikeyConfig), ConfigModule.forFeature(geminiConfig), McpModule],
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

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- --testPathPattern="mcp.module.spec.ts"`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/mcp/mcp.module.ts src/mcp/index.ts src/agents/agents.module.ts
git commit -m "feat(mcp): create McpModule and integrate with AgentsModule"
```

---

## Task 6: Create Configuration Files

**Files:**

- Create: `config/mcp-config.json`
- Create: `config/agent-tools-config.json`

- [ ] **Step 1: Create mcp-config.json**

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

- [ ] **Step 2: Create agent-tools-config.json**

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

- [ ] **Step 3: Update .env.example**

```bash
# MCP Configuration
BRAVE_API_KEY=your_brave_api_key_here
```

- [ ] **Step 4: Commit**

```bash
git add config/mcp-config.json config/agent-tools-config.json .env.example
git commit -m "feat(mcp): add MCP and agent tools configuration files"
```

---

## Task 7: Add Dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk dockerode
npm install -D @types/dockerode
```

- [ ] **Step 2: Verify installation**

Run: `npm list @modelcontextprotocol/sdk dockerode`  
Expected: Both packages listed

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps(mcp): add @modelcontextprotocol/sdk and dockerode dependencies"
```

---

## Task 8: Manual Testing

- [ ] **Step 1: Build the project**

Run: `npm run build`  
Expected: No errors

- [ ] **Step 2: Start the application**

Run: `npm run start:dev`  
Expected: Application starts, MCP server manager initializes

- [ ] **Step 3: Connect WebSocket client**

- [ ] **Step 4: Test MCP tool call**

Send: `@Claude 搜索今天的人工智能新闻`  
Expected:

1. Agent recognizes need for web search
2. Agent generates `<tool_call>{"name": "brave-search.brave_web_search", ...}`
3. ToolExecutorService executes via McpToolRegistry → McpClient → Docker container
4. Result returned to agent
5. Agent continues generation with search results

- [ ] **Step 5: Verify in logs**

Look for:

- `Starting MCP server: brave-search`
- `Registered MCP tool: brave-search.brave_web_search`
- `MCP client connected`

---

## Summary

| Task | Description               | Files                                        |
| ---- | ------------------------- | -------------------------------------------- |
| 1    | MCP Interfaces            | `mcp.interfaces.ts`                          |
| 2    | McpClient (STDIO)         | `mcp-client.ts`                              |
| 3    | McpServerManager (Docker) | `mcp-server-manager.ts`                      |
| 4    | McpToolRegistry (Bridge)  | `mcp-tool-registry.ts`                       |
| 5    | McpModule                 | `mcp.module.ts`, modify `agents.module.ts`   |
| 6    | Config Files              | `mcp-config.json`, `agent-tools-config.json` |
| 7    | Dependencies              | `package.json`                               |
| 8    | Manual Testing            | -                                            |

**Total: 8 tasks**
