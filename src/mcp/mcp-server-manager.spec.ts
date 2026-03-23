import { McpServerManager } from './mcp-server-manager';
import { ServerStatus } from './mcp.interfaces';

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
});
