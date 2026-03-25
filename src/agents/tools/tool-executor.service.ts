import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ToolRegistry, Tool } from './tool-registry';
import { CommandExecutor } from './command-executor';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);
  private readonly sessionWorkspaceDir = 'workspace/sessions';

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly commandExecutor: CommandExecutor,
  ) {}

  parseToolCalls(output: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const regex = /<tool_call>/g;
    const startIndex = 0;
    let match;

    while ((match = regex.exec(output)) !== null) {
      const openIndex = match.index;
      const closeIndex = output.indexOf('</tool_call>', openIndex);
      if (closeIndex === -1) break;

      const jsonStr = output.substring(openIndex + '<tool_call>'.length, closeIndex).trim();
      try {
        const parsed = JSON.parse(jsonStr);
        toolCalls.push({
          id: randomUUID(),
          name: parsed.name,
          args: parsed.args ?? {},
        });
      } catch (e) {
        this.logger.warn(`Failed to parse tool call: ${jsonStr}`);
      }
    }

    return toolCalls;
  }

  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.toolRegistry.getTool(toolCall.name);

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        success: false,
        error: `Tool ${toolCall.name} not found`,
      };
    }

    try {
      const result = await tool.execute(toolCall.args);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        success: true,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async executeAllToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const toolCall of toolCalls) {
      const result = await this.executeToolCall(toolCall);
      results.push(result);
    }
    return results;
  }

  registerSessionTools(sessionId: string): void {
    this.toolRegistry.registerTool(this.createReadFileTool(sessionId));
    this.toolRegistry.registerTool(this.createWriteFileTool(sessionId));
    this.toolRegistry.registerTool(this.createEditFileTool(sessionId));
    this.toolRegistry.registerTool(this.createListFilesTool(sessionId));
    this.toolRegistry.registerTool(this.createExecuteCommandTool(sessionId));
  }

  private createReadFileTool(sessionId: string): Tool {
    return {
      name: 'read_file',
      description: '读取文件内容。适用于查看代码、配置、文档等。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
        },
        required: ['path'],
      },
      execute: async ({ path }: { path: string }) => {
        const fullPath = join(this.sessionWorkspaceDir, sessionId, path);
        try {
          return await fs.readFile(fullPath, 'utf-8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return `Error: File not found: ${path}`;
          }
          throw error;
        }
      },
    };
  }

  private createWriteFileTool(sessionId: string): Tool {
    return {
      name: 'write_file',
      description: '创建或覆写文件。适用于生成代码、配置、报告等。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
      execute: async ({ path, content }: { path: string; content: string }) => {
        const fullPath = join(this.sessionWorkspaceDir, sessionId, path);
        const dir = join(this.sessionWorkspaceDir, sessionId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return `File written: ${path}`;
      },
    };
  }

  private createEditFileTool(sessionId: string): Tool {
    return {
      name: 'edit_file',
      description: '在指定文件中将唯一匹配的一段原内容替换为新内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          oldContent: { type: 'string', description: '原内容，必须在目标文件中唯一匹配一次' },
          newContent: { type: 'string', description: '替换后的新内容' },
        },
        required: ['path', 'oldContent', 'newContent'],
      },
      execute: async ({
        path,
        oldContent,
        newContent,
      }: {
        path: string;
        oldContent: string;
        newContent: string;
      }) => {
        const fullPath = join(this.sessionWorkspaceDir, sessionId, path);

        let content: string;
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`Error: File not found: ${path}`);
          }
          throw error;
        }

        const matches = content.split(oldContent).length - 1;
        if (matches === 0) {
          throw new Error(`Error: Original content not found in file: ${path}`);
        }
        if (matches > 1) {
          throw new Error(`Error: Original content matched multiple locations in file: ${path}`);
        }

        const updatedContent = content.replace(oldContent, newContent);
        await fs.writeFile(fullPath, updatedContent, 'utf-8');
        return `File edited: ${path}`;
      },
    };
  }

  private createListFilesTool(sessionId: string): Tool {
    return {
      name: 'list_files',
      description: '列出目录中的文件。适用于查看项目结构。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径（可选，默认 session workspace）' },
        },
      },
      execute: async ({ path }: { path?: string }) => {
        const dir = path ? join(this.sessionWorkspaceDir, sessionId, path) : join(this.sessionWorkspaceDir, sessionId);
        try {
          const files = await fs.readdir(dir, { withFileTypes: true });
          return files.map((f) => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return `Error: Directory not found: ${path ?? 'session workspace'}`;
          }
          throw error;
        }
      },
    };
  }

  createExecuteCommandTool(sessionId: string): Tool {
    return {
      name: 'execute_command',
      description: '执行白名单内的 shell 命令。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '命令' },
          args: { type: 'array', items: { type: 'string' }, description: '命令参数' },
        },
        required: ['command'],
      },
      execute: async ({ command, args }: { command: string; args?: string[] }) => {
        const result = await this.commandExecutor.execute(command, Array.isArray(args) ? args : [], {
          cwd: join(this.sessionWorkspaceDir, sessionId),
        });
        if (!result.success) {
          return `Command failed: ${result.stderr || 'unknown error'}`;
        }
        return result.stdout || '(no output)';
      },
    };
  }
}
