import { Injectable, Logger } from '@nestjs/common';
import type OpenAI from 'openai';

export interface Tool {
  name: string;
  description: string;
  parameters: object;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool ${tool.name} already registered, skipping`);
      return;
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`Registered tool: ${tool.name}`);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  toOpenAITools(): OpenAI.ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as OpenAI.FunctionParameters,
      },
    }));
  }

  validateParameters(toolName: string, args: unknown): boolean {
    const tool = this.getTool(toolName);
    if (!tool) return false;
    return typeof args === 'object' && args !== null;
  }
}
