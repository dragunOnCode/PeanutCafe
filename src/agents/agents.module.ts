import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AgentConfigService } from './services/agent-config.service';
import { AgentPriorityService } from './services/agent-priority.service';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { apikeyConfig, geminiConfig } from '../config/configuration';

@Module({
  imports: [HttpModule, ConfigModule.forFeature(apikeyConfig), ConfigModule.forFeature(geminiConfig)],
  providers: [AgentConfigService, AgentPriorityService, ClaudeAdapter, CodexAdapter, GeminiAdapter],
  exports: [AgentConfigService, AgentPriorityService, ClaudeAdapter, CodexAdapter, GeminiAdapter],
})
export class AgentsModule {}
