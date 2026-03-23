import * as fs from 'fs';
import * as path from 'path';
import { ServerStatus, McpServerConfig, IMcpClient } from './mcp.interfaces';
import { McpClientImpl } from './mcp-client';

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
    it('should allow the open-websearch profile in config data', () => {
      const configPath = path.resolve(process.cwd(), 'config', 'mcp-config.json');
      const configFile = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        mcpServers: Record<string, McpServerConfig>;
      };

      expect(configFile.mcpServers['open-websearch'].profile).toBe('open-websearch');
    });
  });

  describe('IMcpClient', () => {
    it('should match the concrete McpClientImpl contract', () => {
      const client: IMcpClient = new McpClientImpl('http://localhost:3001/mcp');

      expect(typeof client.connect).toBe('function');
      expect(typeof client.disconnect).toBe('function');
      expect(typeof client.listTools).toBe('function');
      expect(typeof client.callTool).toBe('function');
      expect(typeof client.isConnected).toBe('function');
    });
  });
});
