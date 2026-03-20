import { Injectable } from '@nestjs/common';

export interface AgentPriority {
  agentId: string;
  basePriority: number;
  quotaUsedToday: number;
  quotaLimit: number;
  dynamicPriority: number;
}

export interface PriorityConfig {
  [agentId: string]: {
    basePriority: number;
    quotaLimit: number;
  };
}

@Injectable()
export class AgentPriorityService {
  private priorities: Map<string, AgentPriority> = new Map();
  private config: PriorityConfig = {};

  updateConfig(config: PriorityConfig): void {
    this.config = config;
    for (const [agentId, cfg] of Object.entries(config)) {
      const existing = this.priorities.get(agentId);
      this.priorities.set(agentId, {
        agentId,
        basePriority: cfg.basePriority,
        quotaUsedToday: existing?.quotaUsedToday ?? 0,
        quotaLimit: cfg.quotaLimit,
        dynamicPriority: this.calculateDynamicPriority(cfg.basePriority, existing?.quotaUsedToday ?? 0, cfg.quotaLimit),
      });
    }
  }

  private calculateDynamicPriority(basePriority: number, quotaUsed: number, quotaLimit: number): number {
    const quotaRatio = quotaLimit > 0 ? quotaUsed / quotaLimit : 0;
    return basePriority * (1 - quotaRatio * 0.5);
  }

  recordUsage(agentId: string, tokens: number): void {
    const priority = this.priorities.get(agentId);
    if (priority) {
      priority.quotaUsedToday += tokens;
      priority.dynamicPriority = this.calculateDynamicPriority(
        priority.basePriority,
        priority.quotaUsedToday,
        priority.quotaLimit,
      );
    }
  }

  getDynamicPriority(agentId: string): number {
    return this.priorities.get(agentId)?.dynamicPriority ?? 0;
  }

  getAllPriorities(): AgentPriority[] {
    return Array.from(this.priorities.values());
  }

  selectByPriority(agentIds: string[]): string {
    const candidates = agentIds
      .map((id) => ({
        id,
        priority: this.getDynamicPriority(id),
      }))
      .sort((a, b) => b.priority - a.priority);

    return candidates[0]?.id ?? '';
  }
}
