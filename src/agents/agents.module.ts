import { Module } from '@nestjs/common';
import { AgentConfigService } from './services/agent-config.service';
import { AgentPriorityService } from './services/agent-priority.service';

@Module({
  providers: [AgentConfigService, AgentPriorityService],
  exports: [AgentConfigService, AgentPriorityService],
})
export class AgentsModule {}
