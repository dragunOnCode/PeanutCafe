import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AgentConfigService } from './services/agent-config.service';
import { AgentPriorityService } from './services/agent-priority.service';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';

@Module({
  imports: [HttpModule],
  providers: [AgentConfigService, AgentPriorityService, ClaudeAdapter, CodexAdapter, GeminiAdapter],
  exports: [AgentConfigService, AgentPriorityService, ClaudeAdapter, CodexAdapter, GeminiAdapter],
})
export class AgentsModule {}