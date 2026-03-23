import { McpClientImpl } from './mcp-client';

describe('McpClientImpl stdio transport', () => {
  it('stays disconnected in stdio mode until connect is called', async () => {
    const mockContainerExec = {
      stdout: { on: jest.fn() } as any,
      stdin: { write: jest.fn() } as any,
    };

    const client = new McpClientImpl(mockContainerExec, 'container-123');

    expect(client.isConnected()).toBe(false);

    await client.connect();

    expect(client.isConnected()).toBe(true);
  });
});

describe('McpClientImpl HTTP transport', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('initializes HTTP MCP once and reuses the session id', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'session-123',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'session-123',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'session-123',
          },
        }),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    await client.connect();
    await client.connect();
    await client.listTools();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3001/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3001/mcp',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': 'session-123',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:3001/mcp',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': 'session-123',
        }),
      }),
    );
  });

  it('parses event-stream tool call responses and returns text content', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          ['event: message', 'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}', ''].join('\n'),
          {
            status: 200,
            headers: {
              'content-type': 'text/event-stream',
              'mcp-session-id': 'session-456',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'session-456',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'event: message',
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":50}}',
            '',
            'event: message',
            'data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"tool output"}]}}',
            '',
          ].join('\n'),
          {
            status: 200,
            headers: {
              'content-type': 'text/event-stream',
              'mcp-session-id': 'session-456',
            },
          },
        ),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    await client.connect();
    await expect(client.callTool('search', { query: 'peanut cafe' })).resolves.toBe('tool output');
  });
});
