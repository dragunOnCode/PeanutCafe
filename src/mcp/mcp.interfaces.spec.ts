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
