import { Module } from '@nestjs/common';
import { AgentConfigService } from './services/agent-config.service';

@Module({
  providers: [AgentConfigService],
  exports: [AgentConfigService],
})
export class AgentsModule {}
