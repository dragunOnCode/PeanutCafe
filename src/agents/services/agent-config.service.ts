import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AgentConfig } from '../interfaces';

interface AgentsConfigFile {
  agents: AgentConfig[];
  routing: {
    defaultAgent: string;
    mentionPrefix: string;
    autoRespond: boolean;
  };
}

@Injectable()
export class AgentConfigService implements OnModuleInit {
  private readonly logger = new Logger(AgentConfigService.name);
  private agents: Map<string, AgentConfig> = new Map();
  private routing: AgentsConfigFile['routing'];

  onModuleInit() {
    this.loadConfig();
  }

  private loadConfig() {
    const configPath = path.join(process.cwd(), 'config', 'agents.config.json');

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as AgentsConfigFile;

      for (const agent of config.agents) {
        this.agents.set(agent.id, agent);
      }
      this.routing = config.routing;

      this.logger.log(`已加载 ${config.agents.length} 个 Agent 配置，默认 Agent: ${this.routing.defaultAgent}`);
    } catch (error) {
      this.logger.warn(`加载 Agent 配置失败，使用默认配置: ${(error as Error).message}`);
      this.routing = {
        defaultAgent: 'claude-001',
        mentionPrefix: '@',
        autoRespond: true,
      };
    }
  }

  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  getEnabledAgents(): AgentConfig[] {
    return Array.from(this.agents.values()).filter((a) => a.enabled);
  }

  getAllAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  getDefaultAgentId(): string {
    return this.routing.defaultAgent;
  }

  getRoutingConfig(): AgentsConfigFile['routing'] {
    return { ...this.routing };
  }

  isAgentEnabled(agentId: string): boolean {
    return this.agents.get(agentId)?.enabled ?? false;
  }
}
