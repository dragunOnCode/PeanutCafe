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

  it('creates a standard client for HTTP servers with configured profile', async () => {
    const client = createMockClient();
    mockClientFactory.mockReturnValue(client);
    const createHttpClientSpy = jest.spyOn(manager as any, 'createHttpClient');

    (manager as any).config = {
      openwebsearch: {
        url: 'http://localhost:3001/mcp',
        enabled: true,
        profile: 'open-websearch',
      },
    };

    await (manager as any).startServer('openwebsearch');

    expect(createHttpClientSpy).toHaveBeenCalledWith(
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
    const createHttpClientSpy = jest.spyOn(manager as any, 'createHttpClient');

    (manager as any).config = {
      standardServer: {
        url: 'http://localhost:3002/mcp',
        enabled: true,
      },
    };

    await (manager as any).startServer('standardServer');

    expect(createHttpClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:3002/mcp',
        profile: 'standard',
      }),
      'standardServer',
    );
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
});
