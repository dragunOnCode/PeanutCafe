import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { MemoryModule } from '../memory/memory.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { SessionDeletionService } from '../session/session-deletion.service';
import { SessionDeletionProcessor } from '../queue/session-deletion.processor';
import { ChatGateway } from './chat.gateway';
import { SessionManager } from './session.manager';
import { MessageRouter } from './message.router';
import { AgentRouter } from './agent-router';

@Module({
  imports: [AgentsModule, MemoryModule, WorkspaceModule, DatabaseModule, QueueModule, OrchestrationModule],
  providers: [
    ChatGateway,
    SessionManager,
    MessageRouter,
    AgentRouter,
    SessionDeletionService,
    SessionDeletionProcessor,
  ],
  exports: [ChatGateway, AgentRouter],
})
export class GatewayModule {}
