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

  it('initializes HTTP MCP once, sends the expected handshake, and reuses the session id for listTools', async () => {
    const tools = [
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object' },
      },
    ];
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
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools } }), {
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
    await expect(client.listTools()).resolves.toEqual(tools);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const initializeCall = fetchMock.mock.calls[0];
    const initializedCall = fetchMock.mock.calls[1];
    const listToolsCall = fetchMock.mock.calls[2];

    expect(initializeCall[0]).toBe('http://localhost:3001/mcp');
    expect(initializeCall[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        }),
      }),
    );
    expect(JSON.parse(initializeCall[1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'PeanutCafe',
          version: '0.0.1',
        },
      },
    });

    expect(JSON.parse(initializedCall[1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(initializedCall[1]!.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': 'session-123',
      }),
    );

    expect(JSON.parse(listToolsCall[1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    expect(listToolsCall[1]!.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': 'session-123',
      }),
    );
  });

  it('self-connects for listTools on a fresh HTTP client', async () => {
    const tools = [
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object' },
      },
    ];
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'self-list',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'self-list',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'self-list',
          },
        }),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    await expect(client.listTools()).resolves.toEqual(tools);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual(
      expect.objectContaining({ method: 'initialize' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
  });

  it('self-connects for callTool on a fresh HTTP client', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'self-call',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'self-call',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'fresh tool output' }] } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'self-call',
          },
        }),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    await expect(client.callTool('search', { query: 'fresh' })).resolves.toBe('fresh tool output');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query: 'fresh' },
      },
    });
  });

  it('rejects when an event-stream response does not contain the expected response id', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'session-789',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'session-789',
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
            'data: {"jsonrpc":"2.0","id":999,"result":{"content":[{"type":"text","text":"wrong id"}]}}',
            '',
          ].join('\n'),
          {
            status: 200,
            headers: {
              'content-type': 'text/event-stream',
              'mcp-session-id': 'session-789',
            },
          },
        ),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    await client.connect();

    await expect(client.callTool('search', { query: 'peanut cafe' })).rejects.toThrow(
      'MCP response missing expected id 2',
    );
  });

  it('coalesces concurrent HTTP connect calls into a single initialization sequence', async () => {
    let resolveInitialize: ((response: Response) => void) | undefined;
    const initializeResponse = new Promise<Response>((resolve) => {
      resolveInitialize = resolve;
    });
    const notificationResponse = new Response(null, {
      status: 202,
      headers: {
        'mcp-session-id': 'session-concurrent',
      },
    });
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockImplementationOnce(() => initializeResponse)
      .mockResolvedValue(notificationResponse);
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    const firstConnect = client.connect();
    const secondConnect = client.connect();

    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveInitialize!(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'session-concurrent',
        },
      }),
    );

    await Promise.all([firstConnect, secondConnect]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual(
      expect.objectContaining({
        method: 'initialize',
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  });

  it('rejects a canceled in-flight connect and does not retain session state', async () => {
    let resolveInitialize: ((response: Response) => void) | undefined;
    const initializeResponse = new Promise<Response>((resolve) => {
      resolveInitialize = resolve;
    });
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockImplementationOnce(() => initializeResponse)
      .mockResolvedValue(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'session-race',
          },
        }),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    const pendingConnect = client.connect();
    await Promise.resolve();

    await client.disconnect();

    resolveInitialize!(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'session-race',
        },
      }),
    );

    await expect(pendingConnect).rejects.toThrow('HTTP request failed: The operation was aborted.');

    expect(client.isConnected()).toBe(false);

    fetchMock.mockClear();
    await expect(client.connect()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]!.headers).toEqual(
      expect.not.objectContaining({
        'mcp-session-id': 'session-race',
      }),
    );
  });

  it('aborts an in-flight HTTP connect and does not send initialized after disconnect', async () => {
    let abortSignal: AbortSignal | undefined;
    let rejectInitialize: ((reason?: unknown) => void) | undefined;
    const initializeResponse = new Promise<Response>((_, reject) => {
      rejectInitialize = reject;
    });
    const fetchMock = jest.fn<typeof fetch>().mockImplementationOnce((_input, init) => {
      abortSignal = init?.signal as AbortSignal | undefined;
      return initializeResponse;
    });
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    const pendingConnect = client.connect();
    await Promise.resolve();

    await client.disconnect();

    expect(abortSignal?.aborted).toBe(true);

    rejectInitialize!(new DOMException('The operation was aborted.', 'AbortError'));

    await expect(pendingConnect).rejects.toThrow('HTTP request failed: The operation was aborted.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(false);
  });

  it('starts a fresh handshake for an immediate reconnect after disconnect cancels an in-flight connect', async () => {
    let rejectFirstInitialize: ((reason?: unknown) => void) | undefined;
    const firstInitialize = new Promise<Response>((_, reject) => {
      rejectFirstInitialize = reject;
    });
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockImplementationOnce(() => firstInitialize)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'fresh-retry',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'fresh-retry',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { tools: [{ name: 'search', description: 'Search the web', inputSchema: { type: 'object' } }] } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'fresh-retry',
          },
        }),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    const firstConnect = client.connect();
    await Promise.resolve();

    await client.disconnect();

    const secondConnect = client.connect();

    rejectFirstInitialize!(new DOMException('The operation was aborted.', 'AbortError'));

    await expect(firstConnect).rejects.toThrow('HTTP request failed: The operation was aborted.');
    await expect(secondConnect).resolves.toBeUndefined();
    await expect(client.listTools()).resolves.toEqual([
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object' },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual(
      expect.objectContaining({
        method: 'initialize',
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    });
  });

  it('rejects connect when notifications/initialized returns a JSON-RPC error and clears session state', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'bad-init',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', error: { message: 'initialized failed' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'bad-init',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'fresh-init',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'fresh-init',
          },
        }),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    await expect(client.connect()).rejects.toThrow('initialized failed');
    expect(client.isConnected()).toBe(false);

    await expect(client.connect()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[2][1]!.headers).toEqual(
      expect.not.objectContaining({
        'mcp-session-id': 'bad-init',
      }),
    );
  });

  it('clears any session id captured during a failed handshake before the next connect retry', async () => {
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'stale-session',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'init failed late' } }), {
          status: 500,
          statusText: 'Server Error',
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'stale-session',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'fresh-session',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: {
            'mcp-session-id': 'fresh-session',
          },
        }),
      );
    global.fetch = fetchMock;

    const client = new McpClientImpl('http://localhost:3001/mcp');

    await expect(client.connect()).rejects.toThrow('HTTP 500: Server Error');

    await expect(client.connect()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][1]!.headers).toEqual(
      expect.not.objectContaining({
        'mcp-session-id': 'stale-session',
      }),
    );
    expect(fetchMock.mock.calls[2][1]!.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
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
