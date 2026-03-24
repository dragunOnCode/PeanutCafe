import { McpToolRegistry } from './mcp-tool-registry';
import { ToolRegistry } from '../agents/tools/tool-registry';
import { McpServerManager } from './mcp-server-manager';
import { IMcpClient } from './mcp.interfaces';

const createMockClient = (): jest.Mocked<IMcpClient> => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  listTools: jest.fn().mockResolvedValue([{ name: 'web_search', description: 'Search the web', inputSchema: {} }]),
  callTool: jest.fn().mockResolvedValue('result'),
  isConnected: jest.fn().mockReturnValue(true),
});

describe('McpToolRegistry', () => {
  let mcpToolRegistry: McpToolRegistry;
  let toolRegistry: jest.Mocked<ToolRegistry>;
  let serverManager: jest.Mocked<McpServerManager>;

  beforeEach(() => {
    toolRegistry = {
      registerTool: jest.fn(),
      getTool: jest.fn(),
    } as any;
    serverManager = {
      getClient: jest.fn(),
    } as any;
    mcpToolRegistry = new McpToolRegistry(serverManager, toolRegistry);
  });

  it('should register tools from MCP server', async () => {
    const mockClient = createMockClient();
    serverManager.getClient.mockReturnValue(mockClient);

    await mcpToolRegistry.registerServerTools('brave-search');

    expect(toolRegistry.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'brave-search.web_search',
        description: 'Search the web',
        parameters: {},
        execute: expect.any(Function),
      }),
    );

    const registeredTool = toolRegistry.registerTool.mock.calls[0][0];
    await expect(registeredTool.execute({ query: 'coffee' })).resolves.toBe('result');
    expect(mockClient.callTool).toHaveBeenCalledWith('web_search', { query: 'coffee' });
  });
});
