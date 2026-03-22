import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  completedAt?: string;
}

export interface FileItem {
  path: string;
  language: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceState {
  sessionId: string;
  files: FileItem[];
  tasks: TaskItem[];
  lastUpdate: string;
}

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly baseDir = 'workspace/sessions';

  private getWorkspacePath(sessionId: string): string {
    return join(this.baseDir, sessionId, 'workspace.json');
  }

  async getWorkspace(sessionId: string): Promise<WorkspaceState> {
    const filePath = this.getWorkspacePath(sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as WorkspaceState;
    } catch {
      return this.createDefaultWorkspace(sessionId);
    }
  }

  async updateWorkspace(sessionId: string, workspace: WorkspaceState): Promise<void> {
    const filePath = this.getWorkspacePath(sessionId);
    const dir = join(this.baseDir, sessionId);

    await fs.mkdir(dir, { recursive: true });
    workspace.lastUpdate = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(workspace, null, 2), 'utf-8');
  }

  async addFile(sessionId: string, file: Omit<FileItem, 'createdAt' | 'updatedAt'>): Promise<void> {
    const workspace = await this.getWorkspace(sessionId);
    const now = new Date().toISOString();

    workspace.files.push({
      ...file,
      createdAt: now,
      updatedAt: now,
    });

    await this.updateWorkspace(sessionId, workspace);
  }

  async addTask(sessionId: string, task: Omit<TaskItem, 'id' | 'createdAt'>): Promise<string> {
    const workspace = await this.getWorkspace(sessionId);
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    workspace.tasks.push({
      ...task,
      id,
      createdAt: new Date().toISOString(),
    });

    await this.updateWorkspace(sessionId, workspace);
    return id;
  }

  async deleteSessionDirectory(sessionId: string): Promise<void> {
    const dir = join(this.baseDir, sessionId);
    await fs.rm(dir, { recursive: true, force: true });
  }

  private async createDefaultWorkspace(sessionId: string): Promise<WorkspaceState> {
    const workspace: WorkspaceState = {
      sessionId,
      files: [],
      tasks: [],
      lastUpdate: new Date().toISOString(),
    };

    await this.updateWorkspace(sessionId, workspace);
    return workspace;
  }
}
