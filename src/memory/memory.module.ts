import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShortTermMemoryService } from './services/short-term-memory.service';
import { ConversationHistoryService } from './services/conversation-history.service';
import { MessageEntity } from '../database/entities/message.entity';
import { redisConfig, memoryConfig } from '../config/configuration';
import { SessionContextService } from '../orchestration/context/session-context.service';

@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    ConfigModule.forFeature(memoryConfig),
    TypeOrmModule.forFeature([MessageEntity]),
  ],
  providers: [ShortTermMemoryService, SessionContextService, ConversationHistoryService],
  exports: [ShortTermMemoryService, SessionContextService, ConversationHistoryService],
})
export class MemoryModule {}
