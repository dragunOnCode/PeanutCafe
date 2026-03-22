import { ToolExecutorService, ToolCall } from './tool-executor.service';
import { ToolRegistry } from './tool-registry';
import { CommandExecutor } from './command-executor';

describe('ToolExecutorService', () => {
  let service: ToolExecutorService;
  let toolRegistry: ToolRegistry;
  let commandExecutor: CommandExecutor;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    commandExecutor = new CommandExecutor();
    service = new ToolExecutorService(toolRegistry, commandExecutor);
  });

  describe('parseToolCalls', () => {
    it('should parse single tool call', () => {
      const output = '<tool_call>{"name": "test", "args": {}}</tool_call>';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('test');
    });

    it('should parse multiple tool calls', () => {
      const output = `
        <tool_call>{"name": "tool1", "args": {}}</tool_call>
        <tool_call>{"name": "tool2", "args": {"key": "value"}}</tool_call>
      `;
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(2);
    });

    it('should return empty for no tool calls', () => {
      const output = 'Just normal text';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(0);
    });

    it('should generate UUID for each tool call', () => {
      const output = '<tool_call>{"name": "test", "args": {}}</tool_call>';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls[0].id).toBeDefined();
      expect(toolCalls[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('executeToolCall', () => {
    it('should return error for non-existent tool', async () => {
      const toolCall: ToolCall = { id: '123', name: 'non_existent', args: {} };
      const result = await service.executeToolCall(toolCall);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should execute registered tool', async () => {
      toolRegistry.registerTool({
        name: 'echo',
        description: 'Echo test',
        parameters: { type: 'object' },
        execute: async ({ msg }) => `Echo: ${msg}`,
      });

      const toolCall: ToolCall = { id: '123', name: 'echo', args: { msg: 'hello' } };
      const result = await service.executeToolCall(toolCall);
      expect(result.success).toBe(true);
      expect(result.result).toBe('Echo: hello');
    });
  });
});
