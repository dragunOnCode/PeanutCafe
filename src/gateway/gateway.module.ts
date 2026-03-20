import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { MemoryModule } from '../memory/memory.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { DatabaseModule } from '../database/database.module';
import { ChatGateway } from './chat.gateway';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';
import { AgentRouter } from './agent-router';

@Module({
  imports: [AgentsModule, MemoryModule, WorkspaceModule, DatabaseModule],
  providers: [ChatGateway, SessionManager, MessageRouter, AgentRouter],
  exports: [ChatGateway, AgentRouter],
})
export class GatewayModule {}