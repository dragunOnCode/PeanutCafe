import { McpToolRegistry } from './mcp-tool-registry';
import { ToolRegistry } from '../agents/tools/tool-registry';
import { McpServerManager } from './mcp-server-manager';

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
    const mockClient = {
      listTools: jest.fn().mockResolvedValue([{ name: 'web_search', description: 'Search the web', inputSchema: {} }]),
    };
    serverManager.getClient.mockReturnValue(mockClient);

    await mcpToolRegistry.registerServerTools('brave-search');

    expect(toolRegistry.registerTool).toHaveBeenCalled();
  });
});
