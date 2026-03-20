import { TranscriptService, TranscriptEntry } from './transcript.service';
import { promises as fs } from 'fs';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    appendFile: jest.fn(),
    readFile: jest.fn(),
  },
}));

describe('TranscriptService', () => {
  let service: TranscriptService;

  beforeEach(() => {
    service = new TranscriptService();
    jest.clearAllMocks();
  });

  describe('appendEntry', () => {
    it('should create directory and append JSONL entry', async () => {
      const sessionId = 'test-session-1';
      const entry: TranscriptEntry = {
        role: 'user',
        content: 'Hello',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      await service.appendEntry(sessionId, entry);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.appendFile).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (fs.mkdir as jest.Mock).mockRejectedValueOnce(new Error('mkdir failed'));

      const sessionId = 'test-session-error';
      const entry: TranscriptEntry = {
        role: 'assistant',
        content: 'Hi',
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      await expect(service.appendEntry(sessionId, entry)).resolves.not.toThrow();
    });
  });

  describe('getEntries', () => {
    it('should read and parse JSONL entries with limit', async () => {
      const sessionId = 'test-session-2';
      const entries: TranscriptEntry[] = [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
        { role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:00:01.000Z' },
        { role: 'user', content: 'How are you?', timestamp: '2024-01-01T00:00:02.000Z' },
      ];

      (fs.readFile as jest.Mock).mockResolvedValueOnce(entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const result = await service.getEntries(sessionId, 2);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Hi there!');
      expect(result[1].content).toBe('How are you?');
    });

    it('should return empty array for non-existent file', async () => {
      (fs.readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found'));

      const result = await service.getEntries('non-existent-session');

      expect(result).toEqual([]);
    });

    it('should filter empty lines', async () => {
      const sessionId = 'test-session-3';
      const entries: TranscriptEntry[] = [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
      ];

      (fs.readFile as jest.Mock).mockResolvedValueOnce('\n\n' + JSON.stringify(entries[0]) + '\n');

      const result = await service.getEntries(sessionId);

      expect(result).toHaveLength(1);
    });
  });
});