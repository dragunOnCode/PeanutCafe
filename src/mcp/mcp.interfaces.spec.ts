import { ServerStatus, McpServerConfig, IMcpClient } from './mcp.interfaces';

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
    it('should accept the open-websearch profile', () => {
      const config: McpServerConfig = {
        url: 'http://localhost:3001/mcp',
        enabled: true,
        timeout: 30000,
        profile: 'open-websearch',
      };

      expect(config.profile).toBe('open-websearch');
    });
  });

  describe('IMcpClient', () => {
    it('should expose the generalized client contract shape', () => {
      const client: IMcpClient = {
        connect: async () => undefined,
        disconnect: async () => undefined,
        listTools: async () => [],
        callTool: async () => '',
        isConnected: () => true,
      };

      expect(typeof client.connect).toBe('function');
      expect(typeof client.disconnect).toBe('function');
      expect(typeof client.listTools).toBe('function');
      expect(typeof client.callTool).toBe('function');
      expect(typeof client.isConnected).toBe('function');
    });
  });
});
