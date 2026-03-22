import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GatewayModule } from './gateway/gateway.module';
import { AgentsModule } from './agents/agents.module';
import { MemoryModule } from './memory/memory.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AgentsModule,
    MemoryModule,
    WorkspaceModule,
    GatewayModule,
    QueueModule,
  ],
})
export class AppModule {}
