import { ConversationHistoryService, ConversationContext } from './conversation-history.service';
import { ShortTermMemoryService, MemoryEntry } from './short-term-memory.service';
import { ConfigService } from '@nestjs/config';

describe('ConversationHistoryService', () => {
  let service: ConversationHistoryService;
  let shortTermMemory: jest.Mocked<ShortTermMemoryService>;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'memory.maxHistory') return 6;
      return null;
    }),
  };

  beforeEach(() => {
    shortTermMemory = {
      get: jest.fn(),
      append: jest.fn(),
    } as any;

    service = new ConversationHistoryService(shortTermMemory, mockConfigService as unknown as ConfigService);
  });

  describe('getContext', () => {
    it('should return limited messages based on maxHistory config', async () => {
      const allMessages: MemoryEntry[] = [];
      for (let i = 0; i < 10; i++) {
        allMessages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
        });
      }
      shortTermMemory.get.mockResolvedValue(allMessages);

      const result = await service.getContext('session-1', 'agent-1');

      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].content).toBe('Message 4');
      expect(result.messages[5].content).toBe('Message 9');
    });

    it('should return empty context for new session', async () => {
      shortTermMemory.get.mockResolvedValue([]);

      const result = await service.getContext('new-session');

      expect(result.messages).toHaveLength(0);
    });
  });

  describe('append', () => {
    it('should delegate to shortTermMemory.append', async () => {
      const entry: MemoryEntry = {
        role: 'user',
        content: 'New message',
        timestamp: new Date().toISOString(),
      };

      await service.append('session-1', entry);

      expect(shortTermMemory.append).toHaveBeenCalledWith('session-1', entry);
    });
  });

  describe('agentId filtering (future)', () => {
    it('should pass agentId to underlying service when provided', async () => {
      const allMessages: MemoryEntry[] = [
        { role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Hi', agentId: 'agent-a', timestamp: new Date().toISOString() },
      ];
      shortTermMemory.get.mockResolvedValue(allMessages);

      const result = await service.getContext('session-1', 'agent-b');

      expect(result.messages).toHaveLength(2);
    });
  });
});
