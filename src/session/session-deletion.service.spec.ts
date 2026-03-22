import { SessionDeletionService } from './session-deletion.service';
import { ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { WorkspaceService } from '../workspace/services/workspace.service';

describe('SessionDeletionService', () => {
  let service: SessionDeletionService;
  let shortTermMemory: jest.Mocked<ShortTermMemoryService>;
  let workspaceService: jest.Mocked<WorkspaceService>;
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    shortTermMemory = {
      clear: jest.fn().mockResolvedValue(undefined),
    } as any;

    workspaceService = {
      deleteSessionDirectory: jest.fn().mockResolvedValue(undefined),
    } as any;

    dataSource = {
      transaction: jest.fn(async (fn) => fn({ delete: jest.fn().mockResolvedValue(undefined) })),
    };

    service = new SessionDeletionService({} as any, shortTermMemory, workspaceService, dataSource);
  });

  describe('deleteSession', () => {
    it('should delete from all storage layers in order', async () => {
      await service.deleteSession('test-session');

      expect(shortTermMemory.clear).toHaveBeenCalledWith('test-session');
      expect(workspaceService.deleteSessionDirectory).toHaveBeenCalledWith('test-session');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should throw if Redis deletion fails', async () => {
      shortTermMemory.clear.mockRejectedValue(new Error('Redis error'));

      await expect(service.deleteSession('test-session')).rejects.toThrow('Redis error');
      expect(workspaceService.deleteSessionDirectory).not.toHaveBeenCalled();
    });

    it('should throw if Workspace deletion fails', async () => {
      workspaceService.deleteSessionDirectory.mockRejectedValue(new Error('FS error'));

      await expect(service.deleteSession('test-session')).rejects.toThrow('FS error');
    });
  });
});
