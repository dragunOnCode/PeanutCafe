import { Injectable } from '@nestjs/common';
import type { ILLMAdapter, AgentContext } from '../../agents/interfaces/llm-adapter.interface';
import type { Task } from '../state/workflow.state';

@Injectable()
export class PlannerService {
  constructor(private readonly llmAdapter: ILLMAdapter) {}

  async plan(agentId: string, task: string, context: AgentContext): Promise<Task[]> {
    const prompt = `你是一个任务规划专家。对于以下任务，请分解为可执行的子任务列表：

任务：${task}

请按顺序列出子任务，每个子任务应该：
1. 清晰可执行
2. 有明确的完成标准
3. 适合作为独立步骤

输出格式（JSON数组）：
[{"id": "1", "description": "子任务描述"}, ...]`;

    try {
      const response = await this.llmAdapter.generate(prompt, context);
      const tasks = JSON.parse(response.content) as Task[];
      return tasks.map(t => ({ ...t, status: 'pending' as const }));
    } catch {
      return [{ id: '1', description: task, status: 'pending' }];
    }
  }
}
