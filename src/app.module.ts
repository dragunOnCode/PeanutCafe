import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GatewayModule } from './gateway/gateway.module';
import { AgentsModule } from './agents/agents.module';
import { McpModule } from './mcp/mcp.module';
import { MemoryModule } from './memory/memory.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { PromptsModule } from './agents/prompts/prompts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AgentsModule,
    McpModule,
    MemoryModule,
    WorkspaceModule,
    GatewayModule,
    QueueModule,
    PromptsModule,
  ],
})
export class AppModule {}
