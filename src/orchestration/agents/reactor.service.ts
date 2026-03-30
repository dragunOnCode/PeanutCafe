import { Injectable } from '@nestjs/common';
import { ClaudeAdapter } from '../../agents/adapters/claude.adapter';
import type { AgentContext } from '../../agents/interfaces/llm-adapter.interface';
import type { Task, ReasoningStep } from '../state/workflow.state';

// 废弃
@Injectable()
export class ReactorService {
  constructor(private readonly llmAdapter: ClaudeAdapter) {}

  async *execute(task: Task, context: AgentContext): AsyncGenerator<ReasoningStep> {
    let stepId = 1;
    let observation = '';

    while (!this.isComplete(observation) && stepId <= 10) {
      const thought = await this.reason(task, observation, context);
      const action = await this.act(thought, task, context);
      observation = this.observe(action);

      yield {
        id: String(stepId++),
        thought,
        toolCall: { name: action, args: {} },
        observation,
        isDone: false,
      };
    }
  }

  private async reason(task: Task, observation: string, context: AgentContext): Promise<string> {
    const prompt = `任务：${task.description}
当前进度：${observation || '刚开始'}

请思考下一步应该做什么。`;

    const response = await this.llmAdapter.generate(prompt, context);
    return response.content;
  }

  private async act(thought: string, task: Task, context: AgentContext): Promise<string> {
    const prompt = `任务：${task.description}
思考：${thought}

请决定执行什么操作来推进任务。`;

    const response = await this.llmAdapter.generate(prompt, context);
    return response.content;
  }

  private observe(action: string): string {
    return `观察：${action} 已执行`;
  }

  private isComplete(observation: string): boolean {
    return observation.includes('完成') || observation.includes('completed');
  }
}
