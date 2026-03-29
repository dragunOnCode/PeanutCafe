import { Module, forwardRef } from '@nestjs/common';
import { OrchestrationService } from './orchestration.service';
import { WorkflowController } from './workflow.controller';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import { AgentsModule } from '../agents/agents.module';
import { GatewayModule } from '../gateway/gateway.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [AgentsModule, MemoryModule, forwardRef(() => GatewayModule)],
  controllers: [WorkflowController],
  providers: [OrchestrationService, CotWriterService, PlannerService, ReactorService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
