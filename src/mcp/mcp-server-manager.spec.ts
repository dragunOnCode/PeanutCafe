import { McpServerManager, ServerStatus } from './mcp-server-manager';

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
