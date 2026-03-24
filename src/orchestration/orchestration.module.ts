import { Module } from '@nestjs/common';
import { OrchestrationService } from './orchestration.service';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [AgentsModule],
  providers: [
    OrchestrationService,
    CotWriterService,
    PlannerService,
    ReactorService,
  ],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
