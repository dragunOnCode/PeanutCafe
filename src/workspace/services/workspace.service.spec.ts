import { WorkspaceService, WorkspaceState, FileItem, TaskItem } from './workspace.service';
import { promises as fs } from 'fs';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(() => {
    service = new WorkspaceService();
    jest.clearAllMocks();
  });

  describe('getWorkspace', () => {
    it('should return default workspace if none exists', async () => {
      const sessionId = 'test-session-1';
      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found'));
      (fs.mkdir as jest.Mock).mockResolvedValueOnce(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await service.getWorkspace(sessionId);

      expect(result.sessionId).toBe(sessionId);
      expect(result.files).toEqual([]);
      expect(result.tasks).toEqual([]);
    });

    it('should return existing workspace', async () => {
      const sessionId = 'test-session-2';
      const existingWorkspace: WorkspaceState = {
        sessionId,
        files: [{ path: 'test.ts', language: 'typescript', author: 'test', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
        tasks: [{ id: 'task_1', title: 'Test', status: 'pending', createdAt: '2024-01-01' }],
        lastUpdate: '2024-01-01T00:00:00.000Z',
      };

      (fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(existingWorkspace));

      const result = await service.getWorkspace(sessionId);

      expect(result).toEqual(existingWorkspace);
    });
  });

  describe('updateWorkspace', () => {
    it('should create workspace file', async () => {
      const sessionId = 'test-session-3';
      const workspace: WorkspaceState = {
        sessionId,
        files: [],
        tasks: [],
        lastUpdate: '2024-01-01T00:00:00.000Z',
      };

      (fs.mkdir as jest.Mock).mockResolvedValueOnce(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

      await service.updateWorkspace(sessionId, workspace);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('addFile', () => {
    it('should add file to workspace', async () => {
      const sessionId = 'test-session-4';
      const file: Omit<FileItem, 'createdAt' | 'updatedAt'> = {
        path: 'test.ts',
        language: 'typescript',
        author: 'test',
      };

      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found'));
      (fs.mkdir as jest.Mock).mockResolvedValueOnce(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

      await service.addFile(sessionId, file);

      const writeCall = (fs.writeFile as jest.Mock).mock.calls[1];
      expect(writeCall[1]).toContain('"path"');
    });
  });

  describe('addTask', () => {
    it('should add task with generated id', async () => {
      const sessionId = 'test-session-5';
      const task: Omit<TaskItem, 'id' | 'createdAt'> = {
        title: 'New task',
        status: 'pending',
      };

      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found'));
      (fs.mkdir as jest.Mock).mockResolvedValueOnce(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValueOnce(undefined);

      const taskId = await service.addTask(sessionId, task);

      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
      const writeCall = (fs.writeFile as jest.Mock).mock.calls[1];
      expect(writeCall[1]).toContain('"title"');
    });
  });
});