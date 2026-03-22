import { Module, forwardRef } from '@nestjs/common';
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
import { McpModule } from '../mcp/mcp.module';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forFeature(apikeyConfig),
    ConfigModule.forFeature(geminiConfig),
    forwardRef(() => McpModule),
  ],
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
    ToolRegistry,
  ],
})
export class AgentsModule {}
