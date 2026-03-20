import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ShortTermMemoryService } from './services/short-term-memory.service';
import { redisConfig } from '../config/configuration';

@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [ShortTermMemoryService],
  exports: [ShortTermMemoryService],
})
export class MemoryModule {}
