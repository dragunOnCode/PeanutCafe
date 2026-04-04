import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { SessionDeletionQueue } from './session-deletion.queue';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const password = config.get<string>('REDIS_PASSWORD');
        return {
          connection: {
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: parseInt(String(config.get('REDIS_PORT') ?? '6379'), 10),
            ...(password ? { password } : {}),
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: 'session-deletion',
    }),
  ],
  providers: [SessionDeletionQueue],
  exports: [SessionDeletionQueue],
})
export class QueueModule {}
