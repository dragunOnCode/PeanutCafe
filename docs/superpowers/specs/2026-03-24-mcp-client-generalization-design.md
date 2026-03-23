# MCP Client Generalization Design

> Goal: replace the current HTTP-specific `McpClientImpl` with a general MCP client abstraction that supports standard MCP transports by default and isolates `open-websearch` compatibility behind an explicit profile.

## Background

The current MCP integration treats any configured MCP server URL as a simple JSON-over-HTTP endpoint. That assumption is incorrect for standard MCP HTTP servers and fails against the currently integrated `open-websearch` service.

Observed issues in the current implementation:

- HTTP mode sends `tools/list` and `tools/call` without a prior `initialize`
- HTTP mode does not persist or resend `Mcp-Session-Id`
- HTTP mode assumes `application/json` responses and does not parse `text/event-stream`
- `open-websearch` is currently the only integrated HTTP MCP server, but future integrations should not require a new client implementation for every server

The replacement design must make standard MCP the default path while still unblocking the existing `open-websearch` integration.

## Goals

- Introduce a stable `IMcpClient` interface for the rest of the application
- Make standard MCP the default behavior for new servers
- Support at least `stdio` and standard HTTP MCP transports
- Add explicit compatibility support for `open-websearch` in this iteration
- Keep non-standard handling isolated so it does not pollute the standard path

## Non-Goals

- Do not implement a separate client class per MCP server by default
- Do not redesign the tool registry contract used by agents
- Do not broaden scope into unrelated MCP features such as prompts, resources, or subscriptions beyond what is needed for tools

## Design Summary

The implementation will be split into three layers:

1. `IMcpClient`
   A stable interface used by `McpServerManager` and `McpToolRegistry`
2. `StandardMcpClient`
   The default implementation that runs the MCP lifecycle and delegates transport and compatibility details
3. `Transport + Profile`
   Small focused components:
   - transport handles how bytes are sent and received
   - profile handles server-specific compatibility behavior when a server is not fully interoperable with the standard path

This keeps the system extensible without turning every server integration into a bespoke client implementation.

## Architecture

```text
McpServerManager
  -> creates IMcpClient from config
     -> StandardMcpClient
        -> McpTransport
           -> StdioMcpTransport
           -> HttpMcpTransport
        -> McpServerProfile
           -> StandardMcpProfile
           -> OpenWebSearchMcpProfile

McpToolRegistry
  -> uses IMcpClient only
```

## Interfaces and Responsibilities

### `IMcpClient`

Purpose: define the contract that all MCP client implementations must satisfy.

Expected methods:

```ts
export interface IMcpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}
```

Rules:

- The rest of the application depends on this interface only
- All initialization details are hidden behind `connect()`
- Tool callers do not need to know which transport or profile is in use

### `StandardMcpClient`

Purpose: run the common MCP lifecycle for both `stdio` and HTTP-based transports.

Responsibilities:

- manage connection state
- perform MCP initialization exactly once per connection
- send `initialize`
- send `notifications/initialized`
- route `tools/list` and `tools/call`
- delegate actual request/response I/O to a transport
- delegate compatibility choices to a profile

It is the default client for all servers, including `open-websearch`.

### `McpTransport`

Purpose: isolate transport-specific request/response mechanics from protocol lifecycle.

Initial transport implementations:

- `StdioMcpTransport`
- `HttpMcpTransport`

Responsibilities:

- open and close underlying connection resources
- send JSON-RPC messages
- receive and decode raw transport responses
- expose parsed protocol messages back to `StandardMcpClient`

Transport does not decide server-specific compatibility policy.

### `McpServerProfile`

Purpose: isolate server compatibility behavior that should not be hardcoded into the generic transport or client.

Initial profiles:

- `standard`
- `open-websearch`

Responsibilities:

- define HTTP header expectations if needed
- define response parsing rules when a server is technically reachable but behaves differently from the default path
- allow narrow compatibility adjustments without creating a separate client class

This is intentionally lighter than a custom client implementation. A profile exists only when a server needs compatibility handling.

## Transport Design

### `stdio`

The existing stdio path remains supported. It continues to use newline-delimited JSON-RPC message exchange with container exec streams.

Requirements:

- retain existing Docker-spawned stdio support
- keep request ID correlation and timeout handling
- do not regress existing stdio tests

### HTTP

HTTP mode will be rebuilt around the standard MCP session lifecycle.

Expected behavior:

1. `connect()` sends `initialize`
2. client stores returned session identifier when present
3. client sends `notifications/initialized`
4. subsequent tool requests reuse the same logical session

The transport must support:

- `application/json`
- `text/event-stream` responses for servers that return MCP responses over SSE-style event streams

This is necessary because `open-websearch` returns `text/event-stream` for successful `initialize` and `tools/list` responses.

## Profile Strategy

### Default profile: `standard`

Behavior:

- selected automatically when config omits `profile`
- assumes standard MCP request and response flow
- should be the path used by any well-behaved MCP server

### Explicit profile: `open-websearch`

Behavior in this iteration:

- still uses the standard client and HTTP transport
- enables compatibility handling needed for the currently deployed `open-websearch` server
- supports session-based HTTP flow
- supports event-stream response parsing

Constraint:

- compatibility logic must remain scoped to this profile
- no global behavior should be added just because one server needs it unless it also improves the default standard implementation

## Configuration Changes

`config/mcp-config.json` will support explicit profile selection.

Example:

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

Rules:

- missing `profile` means `standard`
- `profile` is configuration, not inferred from the server name
- future incompatible servers can add their own profile without changing the top-level interface

## Runtime Flow

### Server startup

`McpServerManager`:

- reads each configured server
- chooses transport based on config shape
- chooses profile from config, defaulting to `standard`
- constructs a `StandardMcpClient`
- connects once during startup

### Tool registration

`McpToolRegistry`:

- continues to call `listTools()` through `IMcpClient`
- remains unaware of transport and profile details

### Tool execution

For a tool invocation:

- `McpToolRegistry` calls `client.callTool(...)`
- `StandardMcpClient` sends the MCP request through its transport
- response parsing is handled by transport and profile
- the caller receives the normalized tool result

## Error Handling

The generalized client must make failures diagnosable.

Minimum cases to handle:

- connection failure to configured URL
- initialization failure
- missing or invalid session ID on HTTP MCP servers
- malformed event-stream payloads
- JSON-RPC error responses
- request timeout
- disconnect during an in-flight request

Logging should distinguish:

- transport failure
- protocol failure
- server-declared MCP error
- profile-specific compatibility failure

## Testing Strategy

### Unit tests

Add or update tests for:

- `StandardMcpClient` standard HTTP initialization flow
- `StandardMcpClient` stdio flow remains intact
- session ID capture and reuse in HTTP mode
- event-stream response parsing
- default profile resolution to `standard`
- explicit profile selection for `open-websearch`
- `open-websearch` compatibility path for `tools/list`

### Integration verification

Run against the local `open-websearch` container:

- client connects successfully
- `McpToolRegistry` registers tools from `open-websearch`
- at least one `search` tool call succeeds

### Regression focus

- no regression for current stdio-based MCP support
- no server-name-specific logic in the tool registry
- no assumption that every HTTP response is plain JSON

## File Impact

Expected files to change:

- `config/mcp-config.json`
- `src/mcp/mcp.interfaces.ts`
- `src/mcp/mcp-client.ts`
- `src/mcp/mcp-server-manager.ts`
- `src/mcp/mcp-client.spec.ts`
- `src/mcp/mcp-server-manager.spec.ts`
- additional MCP transport/profile files if splitting is cleaner than extending the existing file

Possible new files:

- `src/mcp/transports/mcp-transport.interface.ts`
- `src/mcp/transports/http-mcp-transport.ts`
- `src/mcp/transports/stdio-mcp-transport.ts`
- `src/mcp/profiles/mcp-server-profile.interface.ts`
- `src/mcp/profiles/standard-mcp-profile.ts`
- `src/mcp/profiles/open-websearch-mcp-profile.ts`

The exact file split should follow the smallest clean structure that preserves clear boundaries.

## Tradeoff Decision

Chosen approach:

- `IMcpClient + StandardMcpClient + transport/profile extension points`

Rejected alternatives:

- one client implementation per MCP server
  rejected because it duplicates protocol logic and scales poorly
- one large client with server-name conditionals
  rejected because it couples unrelated integrations and becomes difficult to test
- inheritance-first hierarchy with many specialized subclasses
  rejected because it tends to spread behavior across brittle class trees instead of isolating transport and profile decisions

## Acceptance Criteria

- `McpToolRegistry` depends only on `IMcpClient`
- default MCP servers use the standard profile without extra config
- `open-websearch` works when configured with `profile: "open-websearch"`
- standard HTTP MCP flow includes initialization and session reuse
- HTTP responses can be parsed when returned as JSON or event-stream
- current stdio support still works
- tool registration and at least one `open-websearch.search` call succeed in local verification
