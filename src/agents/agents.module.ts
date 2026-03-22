import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AgentConfigService } from './services/agent-config.service';
import { AgentPriorityService } from './services/agent-priority.service';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ToolRegistry } from './tools/tool-registry';
import { CommandExecutor } from './tools/command-executor';
import { ToolExecutorService } from './tools/tool-executor.service';
import { apikeyConfig, geminiConfig } from '../config/configuration';

@Module({
  imports: [HttpModule, ConfigModule.forFeature(apikeyConfig), ConfigModule.forFeature(geminiConfig)],
  providers: [
    AgentConfigService,
    AgentPriorityService,
    ClaudeAdapter,
    CodexAdapter,
    GeminiAdapter,
    ToolRegistry,
    CommandExecutor,
    ToolExecutorService,
  ],
  exports: [
    AgentConfigService,
    AgentPriorityService,
    ClaudeAdapter,
    CodexAdapter,
    GeminiAdapter,
    ToolExecutorService,
  ],
})
export class AgentsModule {}
