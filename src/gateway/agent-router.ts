import { Injectable, Logger } from '@nestjs/common';
import { ILLMAdapter } from '../agents/interfaces/llm-adapter.interface';
import { AgentPriorityService } from '../agents/services/agent-priority.service';

export interface RouteResult {
  targetAgents: ILLMAdapter[];
  processedContent: string;
}

@Injectable()
export class AgentRouter {
  private readonly logger = new Logger(AgentRouter.name);

  private agents: Map<string, ILLMAdapter> = new Map();
  private nameToAgent: Map<string, ILLMAdapter> = new Map();

  constructor(private readonly priorityService: AgentPriorityService) {}

  registerAgent(agent: ILLMAdapter): void {
    this.agents.set(agent.id, agent);
    this.nameToAgent.set(agent.name.toLowerCase(), agent);
    this.nameToAgent.set(agent.id.toLowerCase(), agent);
  }

  route(mentionedAgents: string[], content: string): RouteResult {
    const mentioned = mentionedAgents
      .map((name) => name.toLowerCase())
      .map((name) => this.nameToAgent.get(name))
      .filter((agent): agent is ILLMAdapter => agent !== undefined);

    if (mentioned.length > 0) {
      this.logger.log(`Route to mentioned agents: ${mentioned.map((a) => a.name).join(', ')}`);
      return {
        targetAgents: mentioned,
        processedContent: this.removeMentions(content),
      };
    }

    const selectedId = this.priorityService.selectByPriority(Array.from(this.agents.keys()));
    const selectedAgent = this.agents.get(selectedId);

    if (selectedAgent) {
      this.logger.log(`Route to highest priority agent: ${selectedAgent.name}`);
      return {
        targetAgents: [selectedAgent],
        processedContent: content,
      };
    }

    return {
      targetAgents: [],
      processedContent: content,
    };
  }

  getAgentById(id: string): ILLMAdapter | undefined {
    return this.agents.get(id);
  }

  getAgentByName(name: string): ILLMAdapter | undefined {
    return this.nameToAgent.get(name.toLowerCase());
  }

  getAllAgents(): ILLMAdapter[] {
    return Array.from(this.agents.values());
  }

  private removeMentions(content: string): string {
    return content.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
  }
}
