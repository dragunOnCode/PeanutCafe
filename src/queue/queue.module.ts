import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SessionDeletionQueue } from './session-deletion.queue';
import { SessionDeletionProcessor } from './session-deletion.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    BullModule.registerQueue({
      name: 'session-deletion',
    }),
  ],
  providers: [SessionDeletionQueue, SessionDeletionProcessor],
  exports: [SessionDeletionQueue],
})
export class QueueModule {}
