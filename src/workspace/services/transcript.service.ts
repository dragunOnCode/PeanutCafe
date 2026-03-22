import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);
  private readonly baseDir = 'workspace/sessions';

  private getTranscriptPath(sessionId: string): string {
    return join(this.baseDir, sessionId, 'transcript.jsonl');
  }

  async appendEntry(sessionId: string, entry: TranscriptEntry): Promise<void> {
    const filePath = this.getTranscriptPath(sessionId);
    const dir = dirname(filePath);

    try {
      await fs.mkdir(dir, { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(filePath, line, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to append transcript: ${error.message}`);
    }
  }

  async getEntries(sessionId: string, limit: number = 100): Promise<TranscriptEntry[]> {
    const filePath = this.getTranscriptPath(sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      const entries = lines.slice(-limit).map((line) => JSON.parse(line) as TranscriptEntry);
      return entries;
    } catch {
      return [];
    }
  }
}
