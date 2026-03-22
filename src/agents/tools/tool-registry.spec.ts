import { ToolRegistry, Tool } from './tool-registry';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('registerTool', () => {
    it('should register a tool', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };
      registry.registerTool(tool);
      expect(registry.getTool('test_tool')).toBe(tool);
    });

    it('should not duplicate tools', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };
      registry.registerTool(tool);
      registry.registerTool(tool);
      const tools = registry.getAllTools();
      expect(tools).toHaveLength(1);
    });
  });

  describe('getTool', () => {
    it('should return undefined for non-existent tool', () => {
      expect(registry.getTool('non_existent')).toBeUndefined();
    });
  });

  describe('validateParameters', () => {
    it('should return true for valid args', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
        execute: async () => 'result',
      };
      registry.registerTool(tool);
      expect(registry.validateParameters('test_tool', {})).toBe(true);
    });

    it('should return false for null args', () => {
      expect(registry.validateParameters('test_tool', null)).toBe(false);
    });
  });
});
