import { McpClientImpl } from './mcp-client';

describe('McpClientImpl', () => {
  it('should create client with container exec', () => {
    const mockContainerExec = {
      stdout: { on: jest.fn() } as any,
      stdin: { write: jest.fn() } as any,
    };
    const client = new McpClientImpl(mockContainerExec, 'container-123');
    expect(client).toBeDefined();
  });

  it('should report not connected initially', () => {
    const mockContainerExec = {
      stdout: { on: jest.fn() } as any,
      stdin: { write: jest.fn() } as any,
    };
    const client = new McpClientImpl(mockContainerExec, 'container-123');
    expect(client.isConnected()).toBe(false);
  });
});
