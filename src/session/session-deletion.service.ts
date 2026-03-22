import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { SessionEntity } from '../database/entities/session.entity';

@Injectable()
export class SessionDeletionService {
  private readonly logger = new Logger(SessionDeletionService.name);

  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly workspaceService: WorkspaceService,
    private readonly dataSource: DataSource,
  ) {}

  async deleteSession(sessionId: string): Promise<void> {
    this.logger.log(`Deleting session: ${sessionId}`);

    await this.shortTermMemory.clear(sessionId);
    await this.workspaceService.deleteSessionDirectory(sessionId);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(SessionEntity, sessionId);
    });

    this.logger.log(`Session ${sessionId} deleted successfully`);
  }
}
