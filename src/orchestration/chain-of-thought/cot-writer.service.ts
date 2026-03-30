import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { ReasoningStep } from '../state/workflow.state';

@Injectable()
export class CotWriterService {
  private readonly baseDir = 'sessions';

  async writeAgentThinking(
    sessionId: string,
    agentId: string,
    agentName: string,
    plan: string,
    steps: ReasoningStep[],
    handoff?: string,
  ): Promise<void> {
    const content = this.formatCot(agentId, agentName, plan, steps, handoff);
    const filePath = join(this.baseDir, sessionId, 'chain-of-thought.md');
    await this.appendToFile(filePath, content);
  }

  private formatCot(
    agentId: string,
    agentName: string,
    plan: string,
    steps: ReasoningStep[],
    handoff?: string,
  ): string {
    const timestamp = new Date().toISOString();
    const stepsContent = steps
      .map(
        (s) =>
          `**Step ${s.id}**: Thought - ${s.thought}\n         Action - ${s.toolCall?.name ?? 'none'}\n         Observation - ${s.observation}`,
      )
      .join('\n\n');

    return `## Agent: ${agentName} (${timestamp})
### Plan
${plan}

### ReAct Execution
${stepsContent}

### Handoff
${handoff ?? '无'}

---\n\n`;
  }

  private async appendToFile(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const existing = await fs.readFile(filePath, 'utf-8').catch(() => '');
    await fs.writeFile(filePath, existing + content, 'utf-8');
  }
}
