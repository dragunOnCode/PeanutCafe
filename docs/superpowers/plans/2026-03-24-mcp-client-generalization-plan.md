# MCP Client Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current MCP client implementation with a standard-first design that supports `stdio`, standard HTTP MCP, and the currently deployed `open-websearch` compatibility profile.

**Architecture:** Keep `McpToolRegistry` and `McpServerManager` dependent on a stable `IMcpClient` contract. Implement a `StandardMcpClient` that owns MCP lifecycle, delegates wire handling to transport helpers, and isolates `open-websearch` compatibility in an explicit profile chosen from config.

**Tech Stack:** NestJS, TypeScript, Jest, dockerode, built-in `fetch`

---

## File Structure

- Modify: `config/mcp-config.json`
  Add explicit `profile` for `open-websearch`
- Modify: `src/mcp/mcp.interfaces.ts`
  Rename the client contract to `IMcpClient`, extend server config with `profile`, and define profile/transport support types if they stay in this file
- Modify or replace: `src/mcp/mcp-client.ts`
  Introduce the general `StandardMcpClient` and shared request/response handling
- Modify: `src/mcp/mcp-server-manager.ts`
  Build the correct client using config-driven transport/profile selection
- Modify: `src/mcp/index.ts`
  Keep MCP public exports aligned with the renamed client contract
- Modify: `src/mcp/mcp-client.spec.ts`
  Cover standard HTTP flow, event-stream parsing, session reuse, and stdio compatibility
- Modify: `src/mcp/mcp.interfaces.spec.ts`
  Keep interface and config tests aligned with `IMcpClient` and `profile`
- Modify: `src/mcp/mcp-server-manager.spec.ts`
  Cover default profile resolution and explicit `open-websearch` profile routing
- Modify: `src/mcp/mcp-tool-registry.ts`
  Switch imports/types from `McpClient` to `IMcpClient` if needed
- Modify: `src/mcp/mcp-tool-registry.spec.ts`
  Keep tests aligned with the renamed interface
- Create if needed:
  - `src/mcp/transports/mcp-transport.interface.ts`
  - `src/mcp/transports/http-mcp-transport.ts`
  - `src/mcp/transports/stdio-mcp-transport.ts`
  - `src/mcp/profiles/mcp-server-profile.interface.ts`
  - `src/mcp/profiles/standard-mcp-profile.ts`
  - `src/mcp/profiles/open-websearch-mcp-profile.ts`

Keep the split as small as possible. If the existing code stays readable, prefer fewer new files.

### Task 1: Lock the Contract and Configuration

**Files:**
- Modify: `src/mcp/mcp.interfaces.ts`
- Modify: `src/mcp/mcp.interfaces.spec.ts`
- Modify: `config/mcp-config.json`
- Modify: `src/mcp/index.ts`

- [ ] **Step 1: Write the failing tests for the interface and config shape**

Add tests that describe the intended contract before implementation:

```ts
it('should allow profile to be configured on a server config', () => {
  const config: McpServerConfig = {
    url: 'http://localhost:3001/mcp',
    enabled: true,
    profile: 'open-websearch',
  };

  expect(config.profile).toBe('open-websearch');
});

it('should describe the generalized client contract', () => {
  const client: IMcpClient = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    listTools: async () => [],
    callTool: async () => 'ok',
    isConnected: () => true,
  };

  expect(client.isConnected()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --testPathPattern="mcp.interfaces.spec.ts"`

Expected: FAIL because `profile` and `IMcpClient` are not defined yet.

- [ ] **Step 3: Implement the minimal interface/config changes**

Update `src/mcp/mcp.interfaces.ts` to establish the new contract:

```ts
export type McpServerProfileName = 'standard' | 'open-websearch';

export interface McpServerConfig {
  image?: string;
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
  profile?: McpServerProfileName;
}

export interface IMcpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  isConnected(): boolean;
}
```

Update `src/mcp/index.ts` to export the final public symbols explicitly. If the implementation class remains publicly named `McpClientImpl`, keep that alias intentional and document it in the file:

```ts
export * from './mcp.interfaces';
export { StandardMcpClient as McpClientImpl } from './mcp-client';
export * from './mcp-server-manager';
export * from './mcp-tool-registry';
export * from './mcp.module';
```

Update `config/mcp-config.json`:

```json
{
  "mcpServers": {
    "open-websearch": {
      "url": "http://localhost:3001/mcp",
      "enabled": true,
      "timeout": 30000,
      "profile": "open-websearch"
    }
  }
}
```

- [ ] **Step 4: Update the interface spec and barrel export expectations**

Add or update assertions in `src/mcp/mcp.interfaces.spec.ts` so the spec covers the new `profile` field and the generalized client contract. Keep the public export name consistent with whatever class name is chosen in implementation.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --runInBand --testPathPattern="mcp.interfaces.spec.ts"`

Expected: PASS with the new interface/config assertions green.

- [ ] **Step 6: Commit**

```bash
git add config/mcp-config.json src/mcp/mcp.interfaces.ts src/mcp/mcp.interfaces.spec.ts src/mcp/index.ts
git commit -m "refactor(mcp): add profile-aware MCP client config"
```

### Task 2: Implement the General Standard MCP Client

**Files:**
- Modify: `src/mcp/mcp-client.ts`
- Create or Modify: `src/mcp/transports/*`
- Create or Modify: `src/mcp/profiles/*`
- Modify: `src/mcp/index.ts`
- Test: `src/mcp/mcp-client.spec.ts`

- [ ] **Step 1: Write failing tests for standard HTTP MCP flow**

Add tests for:

```ts
it('initializes HTTP MCP once and reuses the session id', async () => {
  const responses = [
    makeEventStreamResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'srv', version: '1.0.0' } },
    }, { 'mcp-session-id': 'session-123' }),
    makeJsonResponse({}, 202),
    makeEventStreamResponse({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [{ name: 'search', description: 'Search', inputSchema: {} }] },
    }),
  ];

  global.fetch = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));

  const client = new StandardMcpClient({ transport: httpTransport, profile: openWebSearchProfile });
  await client.connect();
  const tools = await client.listTools();

  expect(tools).toHaveLength(1);
  expect(global.fetch).toHaveBeenNthCalledWith(
    3,
    'http://localhost:3001/mcp',
    expect.objectContaining({
      headers: expect.objectContaining({ 'Mcp-Session-Id': 'session-123' }),
    }),
  );
});

it('parses event-stream tool call responses', async () => {
  // initialize, initialized notification, tools/call
});

it('keeps stdio clients disconnected until connect is called', async () => {
  // preserve current stdio behavior
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --testPathPattern="mcp-client.spec.ts"`

Expected: FAIL because `StandardMcpClient`, event-stream parsing, and session handling do not exist yet.

- [ ] **Step 3: Implement the transport/profile skeleton**

Create the smallest clean set of helpers. One acceptable shape:

```ts
export interface McpServerProfile {
  readonly name: McpServerProfileName;
  parseHttpBody(response: Response, rawBody: string): Promise<unknown>;
}

export interface McpTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendRequest(request: JsonRpcRequest): Promise<unknown>;
  sendNotification?(notification: JsonRpcNotification): Promise<void>;
}
```

If file count becomes noisy, keep these definitions in `mcp-client.ts` for this iteration.

- [ ] **Step 4: Implement `StandardMcpClient` HTTP lifecycle**

Implement:

```ts
async connect(): Promise<void> {
  if (this.connected) return;

  await this.transport.connect();

  const initResult = await this.transport.sendRequest({
    jsonrpc: '2.0',
    id: this.nextRequestId(),
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'peanutcafe-mcp-client', version: '0.1.0' },
    },
  });

  await this.transport.sendNotification?.({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  this.connected = true;
}
```

Implement HTTP support for:

- request headers:
  - `Content-Type: application/json`
  - `Accept: application/json, text/event-stream`
  - `Mcp-Session-Id` when present
- response handling:
  - parse plain JSON when `content-type` is JSON
  - parse first `data:` payload when `content-type` is `text/event-stream`
  - persist `mcp-session-id` from response headers

- [ ] **Step 5: Implement the `open-websearch` profile as a narrow compatibility layer**

Profile behavior for this iteration:

```ts
export const openWebSearchProfile: McpServerProfile = {
  name: 'open-websearch',
  async parseHttpBody(response, rawBody) {
    return parseJsonOrEventStream(rawBody, response.headers.get('content-type'));
  },
};
```

The standard profile can use the same parser if it is robust enough; do not branch by server name unless behavior is actually different.

- [ ] **Step 6: Implement `listTools()` and `callTool()` on top of the new transport**

Target behavior:

```ts
async listTools(): Promise<McpTool[]> {
  await this.connect();
  const result = await this.transport.sendRequest({
    jsonrpc: '2.0',
    id: this.nextRequestId(),
    method: 'tools/list',
    params: {},
  });

  return (result as { tools?: McpTool[] }).tools ?? [];
}
```

`callTool()` should normalize text content exactly as the current caller expects.

- [ ] **Step 7: Finalize the public client export name**

Choose one public naming strategy and apply it consistently:

- Option A: keep the implementation class named `McpClientImpl`
- Option B: rename the class to `StandardMcpClient` and export an alias for compatibility where needed

Update `src/mcp/index.ts` and any affected imports so the public API and tests agree on one name.

- [ ] **Step 8: Run the client tests**

Run: `npm test -- --runInBand --testPathPattern="mcp-client.spec.ts"`

Expected: PASS with HTTP initialization, session reuse, event-stream parsing, and stdio compatibility tests all green.

- [ ] **Step 9: Commit**

```bash
git add src/mcp/mcp-client.ts src/mcp/mcp-client.spec.ts src/mcp/index.ts src/mcp/transports src/mcp/profiles
git commit -m "refactor(mcp): add standard MCP client with profile support"
```

If no new directories were created, adjust `git add` accordingly.

### Task 3: Wire the Manager and Registry to the New Client

**Files:**
- Modify: `src/mcp/mcp-server-manager.ts`
- Modify: `src/mcp/mcp-tool-registry.ts`
- Modify: `src/mcp/mcp-tool-registry.spec.ts`
- Test: `src/mcp/mcp-server-manager.spec.ts`
- Test: `src/mcp/mcp-tool-registry.spec.ts`

- [ ] **Step 1: Write failing tests for manager/client construction**

Add tests like:

```ts
it('creates a standard client for HTTP servers with the configured profile', async () => {
  const manager = new McpServerManager();
  (manager as any).config = {
    openwebsearch: {
      url: 'http://localhost:3001/mcp',
      enabled: true,
      profile: 'open-websearch',
    },
  };

  const client = { connect: jest.fn(), disconnect: jest.fn(), isConnected: jest.fn(), listTools: jest.fn(), callTool: jest.fn() };
  jest.spyOn(manager as any, 'createClient').mockReturnValue(client);

  await (manager as any).startServer('openwebsearch');

  expect(client.connect).toHaveBeenCalled();
  expect(manager.getServerStatus('openwebsearch')).toBe(ServerStatus.RUNNING);
});

it('defaults profile to standard when omitted', async () => {
  const manager = new McpServerManager();
  (manager as any).config = {
    standardServer: { url: 'http://localhost:3002/mcp', enabled: true },
  };

  const client = { connect: jest.fn(), disconnect: jest.fn(), isConnected: jest.fn(), listTools: jest.fn(), callTool: jest.fn() };
  const factorySpy = jest.spyOn(manager as any, 'createClient').mockReturnValue(client);

  await (manager as any).startServer('standardServer');

  expect(factorySpy).toHaveBeenCalledWith(
    expect.objectContaining({ profile: 'standard' }),
    'standardServer',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand --testPathPattern="mcp-server-manager.spec.ts|mcp-tool-registry.spec.ts"`

Expected: FAIL until the manager no longer hardcodes the old client shape.

- [ ] **Step 3: Implement manager-side client construction**

Refactor `src/mcp/mcp-server-manager.ts` so `startServer()` delegates to one creation path:

```ts
private createClient(config: McpServerConfig, serverName: string): IMcpClient {
  const normalized = this.normalizeConfig(config);

  if (normalized.url) {
    return createHttpMcpClient({
      baseUrl: normalized.url,
      timeout: normalized.timeout ?? 30000,
      profile: normalized.profile ?? 'standard',
    });
  }

  if (normalized.image) {
    return createStdioMcpClient({
      docker: this.docker,
      image: normalized.image,
      env: this.resolveEnvVars(normalized.env ?? {}),
      timeout: normalized.timeout ?? 30000,
      profile: normalized.profile ?? 'standard',
    });
  }

  throw new Error(`MCP server config must have either url or image: ${serverName}`);
}
```

- [ ] **Step 4: Update tool registry to depend on `IMcpClient`**

Keep behavior the same, only switch types/imports:

```ts
const client = this.mcpServerManager.getClient(serverName);
const tools = await client.listTools();
```

If the code only needs renamed imports, keep the change minimal.

- [ ] **Step 5: Run manager and registry tests**

Run:

```bash
npm test -- --runInBand --testPathPattern="mcp-server-manager.spec.ts"
npm test -- --runInBand --testPathPattern="mcp-tool-registry.spec.ts"
```

Expected: PASS for both test files.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server-manager.ts src/mcp/mcp-server-manager.spec.ts src/mcp/mcp-tool-registry.ts src/mcp/mcp-tool-registry.spec.ts
git commit -m "refactor(mcp): wire manager and registry to generalized client"
```

### Task 4: Verify `open-websearch` End-to-End

**Files:**
- Modify if needed: `src/mcp/mcp-client.spec.ts`
- Verify: `docker/docker-compose.yml`
- Verify runtime against local container on `http://localhost:3001/mcp`

- [ ] **Step 1: Add a focused compatibility test for `open-websearch`**

Add a test that mirrors the observed real behavior:

```ts
it('supports open-websearch event-stream initialize and tools/list responses', async () => {
  // mocked initialize response returns text/event-stream + mcp-session-id
  // mocked notifications/initialized returns 202
  // mocked tools/list returns text/event-stream
  // expect parsed tool names to match search/fetchGithubReadme shape
});
```

- [ ] **Step 2: Run the focused compatibility test**

Run: `npm test -- --runInBand --testNamePattern="open-websearch"`

Expected: PASS

- [ ] **Step 3: Run the full MCP unit test set**

Run:

```bash
npm test -- --runInBand --testPathPattern="mcp-client.spec.ts|mcp-server-manager.spec.ts|mcp-tool-registry.spec.ts|mcp.interfaces.spec.ts"
```

Expected: PASS

- [ ] **Step 4: Run a local runtime verification against the actual container**

Suggested verification script:

```bash
@'
const { McpClientImpl } = require('./dist/mcp/mcp-client');
async function main() {
  const client = new McpClientImpl({
    baseUrl: 'http://localhost:3001/mcp',
    profile: 'open-websearch',
  });
  await client.connect();
  const tools = await client.listTools();
  console.log(tools.map((tool) => tool.name));
  const result = await client.callTool('search', { query: 'OpenAI MCP', limit: 1, engines: ['bing'] });
  console.log(result);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
'@ | node -
```

If the exported class name changes, update the script to the final public entry point.

- [ ] **Step 5: Build and run the verification**

Run:

```bash
npm run build
node dist/<updated-entry-or-script>
```

Expected:

- tools include `search`
- at least one real search response is returned
- no `Invalid or missing session ID` error appears

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-client.spec.ts src/mcp/mcp-client.ts src/mcp/mcp-server-manager.ts config/mcp-config.json
git commit -m "test(mcp): verify open-websearch compatibility"
```

Only include files changed during verification hardening.

## Final Verification

- [ ] Run: `npm test -- --runInBand --testPathPattern="mcp-.*\\.spec\\.ts"`
- [ ] Run: `npm run build`
- [ ] Confirm the local `open-websearch` server still responds on `http://localhost:3001/mcp`
- [ ] Confirm the application can register `open-websearch.*` tools without startup failure

## Notes for Execution

- Prefer the smallest clean file split; do not create abstraction layers that are unused in this iteration
- Keep `open-websearch` compatibility isolated in profile logic, not server-name conditionals in the manager or registry
- If standard profile and `open-websearch` profile end up sharing the same event-stream parser, keep the parser generic and let the profile only select behavior
- If runtime verification shows the local container health check remains misleading because `GET /mcp` returns `400`, treat that as a follow-up cleanup unless it blocks implementation
