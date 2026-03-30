import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage } from '../utils/build-chat-messages';

export interface ReactPromptVars {
  name: string;
  role?: string;
  taskDescription: string;
  availableTools?: string;
  maxSteps?: number;
}

@Injectable()
export class ReactPromptBuilder {
  private readonly logger = new Logger(ReactPromptBuilder.name);
  private readonly templatePath = path.join(process.cwd(), 'config/prompts/_shared/react.md');

  buildSystemPrompt(vars: ReactPromptVars): string {
    const template = this.loadTemplate();
    return this.interpolate(template, vars);
  }

  buildInitialMessages(task: string, vars: ReactPromptVars): ChatMessage[] {
    const systemPrompt = this.buildSystemPrompt(vars);
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];
  }

  private loadTemplate(): string {
    try {
      const template = fs.readFileSync(this.templatePath, 'utf-8');
      this.logger.debug(`Loaded template from ${this.templatePath}`);
      return template;
    } catch (error) {
      this.logger.error(`Failed to load template: ${error.message}`);
      throw new Error(`Failed to load prompt template from ${this.templatePath}`);
    }
  }

  private interpolate(template: string, vars: ReactPromptVars): string {
    const defaults = {
      role: '通用助手',
      availableTools: '无可用工具',
      maxSteps: 10,
    };

    const resolved = { ...defaults, ...vars };

    return template
      .replace(/\{name\}/g, resolved.name)
      .replace(/\{role\}/g, resolved.role ?? defaults.role!)
      .replace(/\{taskDescription\}/g, resolved.taskDescription)
      .replace(/\{availableTools\}/g, resolved.availableTools ?? defaults.availableTools!)
      .replace(/\{maxSteps\}/g, String(resolved.maxSteps ?? defaults.maxSteps));
  }
}
