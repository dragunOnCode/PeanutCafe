import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

const DEFAULT_ALLOWED_COMMANDS = [
  'git', 'npm', 'node', 'npx',
  'python', 'pip',
  'ls', 'cat', 'find', 'grep', 'echo', 'pwd', 'mkdir', 'touch', 'rm', 'cp', 'mv',
];

const BLOCKED_PATTERNS = [';', '&&', '||', '|', '>', '<', '`', '$', '\n'];

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

@Injectable()
export class CommandExecutor {
  private readonly logger = new Logger(CommandExecutor.name);
  private readonly allowedCommands: Set<string>;

  constructor() {
    const envCommands = process.env.ALLOWED_COMMANDS?.split(',').filter(Boolean);
    this.allowedCommands = new Set(envCommands ?? DEFAULT_ALLOWED_COMMANDS);
    this.logger.log(`Allowed commands: ${[...this.allowedCommands].join(', ')}`);
  }

  validateCommand(command: string, args: string[]): boolean {
    if (!this.allowedCommands.has(command)) {
      this.logger.warn(`Command not allowed: ${command}`);
      return false;
    }

    const fullCommand = [command, ...args].join(' ');
    for (const pattern of BLOCKED_PATTERNS) {
      if (fullCommand.includes(pattern)) {
        this.logger.warn(`Blocked pattern in command: ${pattern}`);
        return false;
      }
    }

    return true;
  }

  async execute(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ): Promise<CommandResult> {
    if (!this.validateCommand(command, args)) {
      return {
        success: false,
        stdout: '',
        stderr: 'Command not allowed',
        exitCode: 1,
      };
    }

    const timeout = options?.timeout ?? 30000;
    const cwd = options?.cwd ?? process.cwd();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(command, args, {
        cwd,
        shell: false,
      });

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(0, 1024 * 1024);
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0 && !timedOut,
          stdout,
          stderr,
          exitCode: code ?? -1,
          timedOut,
        });
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          stdout,
          stderr: err.message,
          exitCode: -1,
        });
      });

      setTimeout(() => {
        timedOut = true;
        proc.kill();
        resolve({
          success: false,
          stdout,
          stderr: 'Command timed out',
          exitCode: -1,
          timedOut: true,
        });
      }, timeout);
    });
  }
}
