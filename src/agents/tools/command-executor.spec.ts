import { CommandExecutor } from './command-executor';

describe('CommandExecutor', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    executor = new CommandExecutor();
  });

  describe('validateCommand', () => {
    it('should allow git commands', () => {
      expect(executor.validateCommand('git', ['status'])).toBe(true);
    });

    it('should allow ls command', () => {
      expect(executor.validateCommand('ls', [])).toBe(true);
    });

    it('should reject cd command', () => {
      expect(executor.validateCommand('cd', ['..'])).toBe(false);
    });

    it('should reject commands with semicolon', () => {
      expect(executor.validateCommand('ls', [';', 'rm', '-rf'])).toBe(false);
    });

    it('should reject commands with &&', () => {
      expect(executor.validateCommand('echo', ['a', '&&', 'ls'])).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute allowed command', async () => {
      const result = await executor.execute('echo', ['hello']);
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('should reject disallowed command', async () => {
      const result = await executor.execute('cd', ['..']);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('not allowed');
    });
  });
});
