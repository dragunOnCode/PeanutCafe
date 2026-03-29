import { ToolExecutorService, ToolCall } from './tool-executor.service';
import { ToolRegistry } from './tool-registry';
import { CommandExecutor } from './command-executor';
import { promises as fs } from 'fs';
import { join } from 'path';

describe('ToolExecutorService', () => {
  let service: ToolExecutorService;
  let toolRegistry: ToolRegistry;
  let commandExecutor: CommandExecutor;
  const sessionId = 'test-session';
  const sessionDir = join(process.cwd(), 'workspace', 'sessions', sessionId);

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    commandExecutor = new CommandExecutor();
    service = new ToolExecutorService(toolRegistry, commandExecutor);
  });

  afterEach(async () => {
    await fs.rm(sessionDir, { recursive: true, force: true });
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

    it('should unwrap markdown code fence inside tool_call', () => {
      const output =
        '<tool_call>```json\n{"name": "read_file", "args": {"path": "x.txt"}}\n```</tool_call>';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('read_file');
      expect(toolCalls[0].args).toEqual({ path: 'x.txt' });
    });

    it('should recover from trailing comma via jsonrepair', () => {
      const output = '<tool_call>{"name": "echo", "args": {"msg": "hi",}}</tool_call>';
      const toolCalls = service.parseToolCalls(output);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('echo');
      expect(toolCalls[0].args).toEqual({ msg: 'hi' });
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

  describe('edit_file tool', () => {
    beforeEach(() => {
      service.registerSessionTools(sessionId);
    });

    it('should replace a uniquely matched string in the target file', async () => {
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(join(sessionDir, 'notes.txt'), 'alpha\nbeta\nalpha beta\n', 'utf-8');

      const result = await service.executeToolCall({
        id: 'edit-1',
        name: 'edit_file',
        args: {
          path: 'notes.txt',
          oldContent: '\nbeta\n',
          newContent: '\ngamma\n',
        },
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('File edited: notes.txt');
      await expect(fs.readFile(join(sessionDir, 'notes.txt'), 'utf-8')).resolves.toBe('alpha\ngamma\nalpha beta\n');
    });

    it('should fail when the original content is not found', async () => {
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(join(sessionDir, 'notes.txt'), 'alpha\nbeta\n', 'utf-8');

      const result = await service.executeToolCall({
        id: 'edit-2',
        name: 'edit_file',
        args: {
          path: 'notes.txt',
          oldContent: 'missing',
          newContent: 'gamma',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Original content not found in file: notes.txt');
    });

    it('should fail when the original content matches multiple locations', async () => {
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(join(sessionDir, 'notes.txt'), 'repeat\nrepeat\n', 'utf-8');

      const result = await service.executeToolCall({
        id: 'edit-3',
        name: 'edit_file',
        args: {
          path: 'notes.txt',
          oldContent: 'repeat',
          newContent: 'once',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Original content matched multiple locations in file: notes.txt');
    });
  });
});
