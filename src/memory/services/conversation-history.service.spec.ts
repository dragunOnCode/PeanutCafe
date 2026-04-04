import { ConversationHistoryService } from './conversation-history.service';
import { ShortTermMemoryService, MemoryEntry } from './short-term-memory.service';
import { ConfigService } from '@nestjs/config';
import { SessionContextService } from '../../orchestration/context/session-context.service';

describe('ConversationHistoryService', () => {
  let service: ConversationHistoryService;
  let shortTermMemory: {
    get: jest.Mock<Promise<MemoryEntry[]>, [string]>;
    append: jest.Mock<Promise<void>, [string, MemoryEntry]>;
  };
  let sessionContextService: {
    getContext: jest.Mock;
    appendUserTurn: jest.Mock;
    appendAssistantTurn: jest.Mock;
    appendHandoffSummary: jest.Mock;
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'memory.maxHistory') return 6;
      return null;
    }),
  };

  beforeEach(() => {
    shortTermMemory = {
      get: jest.fn<Promise<MemoryEntry[]>, [string]>(),
      append: jest.fn<Promise<void>, [string, MemoryEntry]>(),
    };

    sessionContextService = {
      getContext: jest.fn(),
      appendUserTurn: jest.fn(),
      appendAssistantTurn: jest.fn(),
      appendHandoffSummary: jest.fn(),
    };

    service = new ConversationHistoryService(
      shortTermMemory as unknown as ShortTermMemoryService,
      mockConfigService as unknown as ConfigService,
      sessionContextService as unknown as SessionContextService,
    );
  });

  describe('getContext', () => {
    it('should return limited messages based on maxHistory config', async () => {
      sessionContextService.getContext.mockResolvedValue({
        sessionId: 'session-1',
        turns: [
          {
            id: '1',
            sessionId: 'session-1',
            role: 'user',
            kind: 'user',
            content: 'Message 0',
            createdAt: new Date(2024, 0, 1, 0, 0),
          },
          {
            id: '2',
            sessionId: 'session-1',
            role: 'assistant',
            kind: 'assistant',
            content: 'Message 1',
            agentName: 'Claude',
            createdAt: new Date(2024, 0, 1, 0, 1),
          },
        ],
      });

      const result = await service.getContext('session-1', 'agent-1');

      expect(sessionContextService.getContext).toHaveBeenCalledWith('session-1');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Message 0');
      expect(result.messages[1].content).toBe('Message 1');
    });

    it('should return empty context for new session', async () => {
      sessionContextService.getContext.mockResolvedValue({ sessionId: 'new-session', turns: [] });

      const result = await service.getContext('new-session');

      expect(result.messages).toHaveLength(0);
    });
  });

  describe('append', () => {
    it('should delegate user entries to session context service', async () => {
      const entry: MemoryEntry = {
        role: 'user',
        content: 'New message',
        timestamp: new Date().toISOString(),
      };

      await service.append('session-1', entry);

      expect(sessionContextService.appendUserTurn).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          content: 'New message',
        }),
      );
    });
  });

  describe('agentId filtering (future)', () => {
    it('should keep the compatibility method signature when agentId is provided', async () => {
      sessionContextService.getContext.mockResolvedValue({
        sessionId: 'session-1',
        turns: [
          { id: '1', sessionId: 'session-1', role: 'user', kind: 'user', content: 'Hello', createdAt: new Date() },
          {
            id: '2',
            sessionId: 'session-1',
            role: 'assistant',
            kind: 'assistant',
            content: 'Hi',
            agentId: 'agent-a',
            createdAt: new Date(),
          },
        ],
      });

      const result = await service.getContext('session-1', 'agent-b');

      expect(result.messages).toHaveLength(2);
      expect(sessionContextService.getContext).toHaveBeenCalledWith('session-1');
    });
  });
});
