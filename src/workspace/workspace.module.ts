import { Module } from '@nestjs/common';
import { WorkspaceService } from './services/workspace.service';
import { TranscriptService } from './services/transcript.service';

@Module({
  providers: [WorkspaceService, TranscriptService],
  exports: [WorkspaceService, TranscriptService],
})
export class WorkspaceModule {}
