import { Module, forwardRef } from '@nestjs/common';
import { McpServerManager } from './mcp-server-manager';
import { McpToolRegistry } from './mcp-tool-registry';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [forwardRef(() => AgentsModule)],
  providers: [McpServerManager, McpToolRegistry],
  exports: [McpServerManager, McpToolRegistry],
})
export class McpModule {}
