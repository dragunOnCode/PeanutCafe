// src/agents/react/react-prompt.builder.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage } from '../utils/build-chat-messages';
import { PromptTemplateService } from '../prompts/prompt-template.service';

export interface ReactPromptVars {
  name: string;
  role: string;
  model: string;
  taskDescription: string;
  availableTools?: string;
  maxSteps?: number;
}

@Injectable()
export class ReactPromptBuilder {
  private readonly logger = new Logger(ReactPromptBuilder.name);
  private readonly reactRulesPath = path.join(process.cwd(), 'config/prompts/_shared/react.md');

  constructor(private readonly templateService: PromptTemplateService) {}

  async buildSystemPrompt(sessionId: string, agentType: string, vars: ReactPromptVars): Promise<string> {
    const baseVars = {
      name: vars.name,
      role: vars.role,
      model: vars.model,
      sessionId,
      capabilities: vars.availableTools ? vars.availableTools.split(',').map((t: string) => t.trim()) : [],
    };

    const basePrompt = await this.templateService.buildPrompt(sessionId, agentType, baseVars);
    const reactRules = this.loadReactRules(vars.maxSteps ?? 10);

    return basePrompt + '\n\n' + reactRules;
  }

  async buildInitialMessages(
    sessionId: string,
    agentType: string,
    task: string,
    vars: ReactPromptVars,
  ): Promise<ChatMessage[]> {
    const systemPrompt = await this.buildSystemPrompt(sessionId, agentType, vars);
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];
  }

  private loadReactRules(maxSteps: number): string {
    try {
      const template = fs.readFileSync(this.reactRulesPath, 'utf-8');
      this.logger.debug(`Loaded react rules from ${this.reactRulesPath}`);
      return template.replace(/\{maxSteps\}/g, String(maxSteps));
    } catch (error) {
      this.logger.error(`Failed to load react rules: ${error.message}`);
      return this.getDefaultReactRules(maxSteps);
    }
  }

  private getDefaultReactRules(maxSteps: number): string {
    return `## ReAct 执行模式

你正在以 ReAct (Reasoning + Acting) 模式执行任务。

### 输出格式

**必须使用以下 XML 标签进行推理可视化：**

#### 思考
\`<thought>你的分析</thought>\`

#### 获取结果
\`<observation>工具执行结果的简明总结</observation>\`

#### 完成任务
\`<done>最终回答或结果</done>\`

#### 交接（如需要）
\`<handoff_agent>目标Agent名称</handoff_agent>\`

### 终止条件

- 使用 \`<done>\` 标签输出最终结果后，任务结束
- 使用 \`<handoff_agent>\` 标签后，触发交接流程
- 最大执行步数：${maxSteps}（达到后强制结束）`;
  }
}
