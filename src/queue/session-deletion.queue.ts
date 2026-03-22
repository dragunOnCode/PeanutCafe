import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const SESSION_DELETION_QUEUE = 'session-deletion';

@Injectable()
export class SessionDeletionQueue {
  constructor(@InjectQueue(SESSION_DELETION_QUEUE) private queue: Queue) {}

  async add(data: { sessionId: string }) {
    await this.queue.add('delete-session', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnFail: false,
    });
  }
}
