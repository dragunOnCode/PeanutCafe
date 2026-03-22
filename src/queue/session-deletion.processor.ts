import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { Server } from 'socket.io';
import { SESSION_DELETION_QUEUE } from './session-deletion.queue';
import { SessionDeletionQueue } from './session-deletion.queue';
import { SessionDeletionService } from '../session/session-deletion.service';
import { SessionManager } from '../gateway/session.manager';

const MAX_RETRY_BEFORE_STUCK = 10;

@Injectable()
@Processor(SESSION_DELETION_QUEUE)
export class SessionDeletionProcessor extends WorkerHost {
  private readonly logger = new Logger(SessionDeletionProcessor.name);

  constructor(
    private readonly deletionService: SessionDeletionService,
    private readonly deletionQueue: SessionDeletionQueue,
    private readonly server: Server,
    private readonly sessionManager: SessionManager,
  ) {
    super();
  }

  async process(job: Job<{ sessionId: string }>): Promise<void> {
    const { sessionId } = job.data;
    this.logger.log(`Processing session deletion: ${sessionId}`);
    await this.deletionService.deleteSession(sessionId);
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    this.server.to(`session:${sessionId}`).emit('session:deleted', { sessionId });
    this.sessionManager.getSessionClients(sessionId).forEach((c) => c.disconnect());
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    const attempts = job.attemptsMade ?? 1;

    this.logger.error(`Session ${sessionId} deletion failed after ${attempts} attempts`);

    if (attempts >= MAX_RETRY_BEFORE_STUCK) {
      this.server.to(`session:${sessionId}`).emit('session:delete:stuck', {
        sessionId,
        attempts,
        message: 'Deletion persistently failing, please contact support',
      });
      this.logger.error(`Session ${sessionId} deletion stuck after ${attempts} attempts`);
      return;
    }

    this.server.to(`session:${sessionId}`).emit('session:delete:failed', {
      sessionId,
      attempt: attempts,
      message: 'Deletion failed, retrying...',
    });

    const delay = 30000;
    await this.deletionQueue.add({ sessionId });
    this.logger.log(`Session ${sessionId} re-queued with ${delay}ms delay`);
  }
}
