import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShortTermMemoryService } from './services/short-term-memory.service';
import { ConversationHistoryService } from './services/conversation-history.service';
import { MessageEntity } from '../database/entities/message.entity';
import { redisConfig, memoryConfig } from '../config/configuration';

@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    ConfigModule.forFeature(memoryConfig),
    TypeOrmModule.forFeature([MessageEntity]),
  ],
  providers: [ShortTermMemoryService, ConversationHistoryService],
  exports: [ShortTermMemoryService, ConversationHistoryService],
})
export class MemoryModule {}
