const mockClientFactory = jest.fn();

jest.mock('./mcp-client', () => ({
  McpClientImpl: jest.fn().mockImplementation((...args: unknown[]) => mockClientFactory(...args)),
}));

import { McpServerManager } from './mcp-server-manager';
import { IMcpClient, ServerStatus } from './mcp.interfaces';

const createMockClient = (): jest.Mocked<IMcpClient> => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  listTools: jest.fn().mockResolvedValue([]),
  callTool: jest.fn().mockResolvedValue('result'),
  isConnected: jest.fn().mockReturnValue(true),
});

describe('McpServerManager', () => {
  let manager: McpServerManager;

  beforeEach(() => {
    manager = new McpServerManager();
  });

  afterEach(() => {
    mockClientFactory.mockReset();
    jest.restoreAllMocks();
  });

  it('should create manager instance', () => {
    expect(manager).toBeDefined();
  });

  it('should return STOPPED status for unknown server', () => {
    expect(manager.getServerStatus('unknown')).toBe(ServerStatus.STOPPED);
  });

  it('selects the open-websearch HTTP factory for open-websearch profile', async () => {
    const client = createMockClient();
    mockClientFactory.mockReturnValue(client);
    const createOpenWebSearchHttpClientSpy = jest.spyOn(manager as any, 'createOpenWebSearchHttpClient');

    (manager as any).config = {
      openwebsearch: {
        url: 'http://localhost:3001/mcp',
        enabled: true,
        profile: 'open-websearch',
      },
    };

    await (manager as any).startServer('openwebsearch');

    expect(createOpenWebSearchHttpClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:3001/mcp',
        profile: 'open-websearch',
      }),
      'openwebsearch',
    );
  });

  it('defaults profile to standard when omitted', async () => {
    const client = createMockClient();
    mockClientFactory.mockReturnValue(client);
    const createStandardHttpClientSpy = jest.spyOn(manager as any, 'createStandardHttpClient');

    (manager as any).config = {
      standardServer: {
        url: 'http://localhost:3002/mcp',
        enabled: true,
      },
    };

    await (manager as any).startServer('standardServer');

    expect(createStandardHttpClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:3002/mcp',
        profile: 'standard',
      }),
      'standardServer',
    );
  });

  it('selects the standard stdio factory for standard profile', async () => {
    const client = createMockClient();
    const createStandardStdioClientSpy = jest.spyOn(manager as any, 'createStandardStdioClient').mockResolvedValue({
      client,
      containerId: 'container-123',
    });

    (manager as any).config = {
      standardStdioServer: {
        image: 'peanut/std-mcp:latest',
        enabled: true,
      },
    };

    await (manager as any).startServer('standardStdioServer');

    expect(createStandardStdioClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'peanut/std-mcp:latest',
        profile: 'standard',
      }),
      'standardStdioServer',
    );
    expect(manager.getServerStatus('standardStdioServer')).toBe(ServerStatus.RUNNING);
  });

  it('connects the created client and marks server RUNNING', async () => {
    const client = createMockClient();
    mockClientFactory.mockReturnValue(client);
    const connectOrder: string[] = [];
    client.connect.mockImplementation(async () => {
      connectOrder.push('connect');
      expect(manager.getServerStatus('standardServer')).toBe(ServerStatus.STOPPED);
    });

    (manager as any).config = {
      standardServer: {
        url: 'http://localhost:3002/mcp',
        enabled: true,
      },
    };

    await (manager as any).startServer('standardServer');

    expect(connectOrder).toEqual(['connect']);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(manager.getServerStatus('standardServer')).toBe(ServerStatus.RUNNING);
    expect(manager.getClient('standardServer')).toBe(client);
  });

  it('fails clearly for unsupported HTTP profiles', async () => {
    const client = createMockClient();
    mockClientFactory.mockReturnValue(client);

    (manager as any).config = {
      incompatibleServer: {
        url: 'http://localhost:3003/mcp',
        enabled: true,
        profile: 'unsupported-profile',
      },
    };

    await expect((manager as any).startServer('incompatibleServer')).rejects.toThrow(
      'Unsupported MCP server profile "unsupported-profile" for HTTP server incompatibleServer',
    );
  });

  it('fails clearly for unsupported stdio profiles', async () => {
    (manager as any).config = {
      incompatibleStdioServer: {
        image: 'peanut/std-mcp:latest',
        enabled: true,
        profile: 'unsupported-profile',
      },
    };

    await expect((manager as any).startServer('incompatibleStdioServer')).rejects.toThrow(
      'Unsupported MCP server profile "unsupported-profile" for stdio server incompatibleStdioServer',
    );
  });

  it('fails clearly for open-websearch stdio profile', async () => {
    (manager as any).config = {
      openWebSearchStdioServer: {
        image: 'peanut/std-mcp:latest',
        enabled: true,
        profile: 'open-websearch',
      },
    };

    await expect((manager as any).startServer('openWebSearchStdioServer')).rejects.toThrow(
      'Unsupported MCP server profile "open-websearch" for stdio server openWebSearchStdioServer',
    );
  });
});
