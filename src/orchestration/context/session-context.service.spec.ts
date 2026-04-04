import { ConfigService } from '@nestjs/config';
import { ShortTermMemoryService, type MemoryEntry } from '../../memory/services/short-term-memory.service';
import { SessionContextService } from './session-context.service';

describe('SessionContextService', () => {
  let service: SessionContextService;
  let shortTermMemory: {
    get: jest.Mock<Promise<MemoryEntry[]>, [string]>;
    append: jest.Mock<Promise<void>, [string, MemoryEntry]>;
  };

  beforeEach(() => {
    shortTermMemory = {
      get: jest.fn<Promise<MemoryEntry[]>, [string]>(),
      append: jest.fn<Promise<void>, [string, MemoryEntry]>(),
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'memory.maxHistory') return 3;
        return null;
      }),
    } as unknown as ConfigService;

    service = new SessionContextService(shortTermMemory as unknown as ShortTermMemoryService, configService);
  });

  it('loads recent turns as canonical session turns', async () => {
    const entries: MemoryEntry[] = [
      { role: 'user', content: 'one', timestamp: '2026-04-04T00:00:00.000Z' },
      { role: 'assistant', content: 'two', agentName: 'Claude', timestamp: '2026-04-04T00:00:01.000Z' },
      { role: 'system', content: 'three', timestamp: '2026-04-04T00:00:02.000Z' },
      { role: 'assistant', content: 'four', agentName: 'Codex', timestamp: '2026-04-04T00:00:03.000Z' },
    ];
    shortTermMemory.get.mockResolvedValue(entries);

    const context = await service.getContext('session-1');

    expect(context.sessionId).toBe('session-1');
    expect(context.turns).toHaveLength(3);
    expect(context.turns[0]).toMatchObject({ role: 'assistant', kind: 'assistant', content: 'two' });
    expect(context.turns[1]).toMatchObject({ role: 'system', kind: 'handoff_summary', content: 'three' });
    expect(context.turns[2]).toMatchObject({ role: 'assistant', kind: 'assistant', content: 'four' });
    expect(context.turns[0].createdAt).toBeInstanceOf(Date);
  });

  it('appends assistant turns without changing prior turns', async () => {
    shortTermMemory.append.mockResolvedValue();

    const turn = await service.appendAssistantTurn('session-1', {
      content: 'implemented change',
      agentId: 'agent-1',
      agentName: 'Claude',
      createdAt: new Date('2026-04-04T00:10:00.000Z'),
    });

    expect(shortTermMemory.append).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        role: 'assistant',
        content: 'implemented change',
        agentId: 'agent-1',
        agentName: 'Claude',
        timestamp: '2026-04-04T00:10:00.000Z',
      }),
    );
    expect(turn).toMatchObject({
      sessionId: 'session-1',
      role: 'assistant',
      kind: 'assistant',
      content: 'implemented change',
      agentName: 'Claude',
    });
  });

  it('appends handoff summary turns for the next agent', async () => {
    shortTermMemory.append.mockResolvedValue();

    const turn = await service.appendHandoffSummary('session-1', {
      content: 'Claude finished analysis. Codex should implement.',
      agentName: 'Claude',
      createdAt: new Date('2026-04-04T00:11:00.000Z'),
    });

    expect(shortTermMemory.append).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        role: 'system',
        content: 'Claude finished analysis. Codex should implement.',
        agentName: 'Claude',
        timestamp: '2026-04-04T00:11:00.000Z',
      }),
    );
    expect(turn).toMatchObject({
      role: 'system',
      kind: 'handoff_summary',
      content: 'Claude finished analysis. Codex should implement.',
    });
  });
});
