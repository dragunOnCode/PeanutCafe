import { Module } from '@nestjs/common';
import { ShortTermMemoryService } from './services/short-term-memory.service';

@Module({
  providers: [ShortTermMemoryService],
  exports: [ShortTermMemoryService],
})
export class MemoryModule {}
