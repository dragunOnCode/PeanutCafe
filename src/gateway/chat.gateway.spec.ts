import { ChatGateway } from './chat.gateway';
import { AgentContext } from '../agents/interfaces/llm-adapter.interface';

describe('ChatGateway streaming agent responses', () => {
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const prompt = 'test prompt';

  let gateway: ChatGateway;
  let serverEmit: jest.Mock;
  let sessionContextService: {
    getContext: jest.Mock;
    appendUserTurn: jest.Mock;
    appendAssistantTurn: jest.Mock;
    appendHandoffSummary: jest.Mock;
  };
  let transcriptService: { appendEntry: jest.Mock };
  let messageRepository: { create: jest.Mock; save: jest.Mock };
  let sessionRepository: { exist: jest.Mock; create: jest.Mock; save: jest.Mock };
  let priorityService: { recordUsage: jest.Mock; updateConfig: jest.Mock };
  let deletionService: { deleteSession: jest.Mock };
  let deletionQueue: { add: jest.Mock };
  let messageRouter: { parseMessage: jest.Mock };
  let agentRouter: { registerAgent: jest.Mock; route: jest.Mock; getAgentByName: jest.Mock };
  let orchestrationService: { streamExecute: jest.Mock };
  let client: { disconnect: jest.Mock; handshake: { query: Record<string, unknown> } };

  beforeEach(() => {
    client = {
      disconnect: jest.fn(),
      handshake: { query: { userId: null } },
    };
    serverEmit = jest.fn();
    sessionContextService = {
      getContext: jest.fn().mockResolvedValue({
        sessionId,
        turns: [
          {
            id: 'turn-1',
            sessionId,
            role: 'user',
            kind: 'user',
            content: prompt,
            createdAt: new Date('2026-03-21T00:00:00.000Z'),
          },
        ],
      }),
      appendUserTurn: jest.fn().mockResolvedValue(undefined),
      appendAssistantTurn: jest.fn().mockResolvedValue(undefined),
      appendHandoffSummary: jest.fn().mockResolvedValue(undefined),
    };
    transcriptService = {
      appendEntry: jest.fn().mockResolvedValue(undefined),
    };
    messageRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    sessionRepository = {
      exist: jest.fn().mockResolvedValue(true),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    priorityService = {
      recordUsage: jest.fn(),
      updateConfig: jest.fn(),
    };
    deletionService = {
      deleteSession: jest.fn().mockResolvedValue(undefined),
    };
    deletionQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };
    messageRouter = {
      parseMessage: jest.fn().mockReturnValue({
        mentionedAgents: [],
      }),
    };
    agentRouter = {
      registerAgent: jest.fn(),
      route: jest.fn().mockReturnValue({
        processedContent: prompt,
        targetAgents: [],
      }),
      getAgentByName: jest.fn().mockImplementation((name: string) => ({
        id: `${name.toLowerCase()}-001`,
        name,
      })),
    };
    orchestrationService = {
      streamExecute: jest.fn(),
    };

    gateway = new ChatGateway(
      {
        addClient: jest.fn(),
        removeClient: jest.fn(),
        getActiveSessions: jest.fn(),
        getActiveClientCount: jest.fn(),
        getSessionClients: jest.fn().mockReturnValue([]),
      } as never,
      messageRouter as never,
      agentRouter as never,
      sessionContextService as never,
      transcriptService as never,
      {} as never,
      messageRepository as never,
      sessionRepository as never,
      priorityService as never,
      {} as never,
      {} as never,
      {} as never,
      deletionService as never,
      deletionQueue as never,
      { initializeSessionPrompts: jest.fn().mockResolvedValue(undefined) } as never,
      { buildMessages: jest.fn() } as never,
      orchestrationService as never,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue({
        emit: serverEmit,
      }),
    } as never;
  });

  it('appends the user turn once to session context and mirrors workflow assistant output only to db/transcript', async () => {
    orchestrationService.streamExecute.mockImplementation(async function* () {
      yield { type: 'chunk', agentName: 'Claude', delta: 'Hello' };
      yield { type: 'agent_stream_end', agentName: 'Claude', fullContent: 'Hello world' };
      yield { type: 'complete', finalOutput: 'Hello world', agentName: 'Claude' };
    });

    const result = await gateway.handleMessage(
      client as any,
      {
        sessionId,
        content: prompt,
      } as any,
    );

    expect(result.success).toBe(true);
    expect(sessionContextService.appendUserTurn).toHaveBeenCalledTimes(1);
    expect(sessionContextService.appendUserTurn).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        content: prompt,
      }),
    );
    expect(sessionContextService.appendAssistantTurn).not.toHaveBeenCalled();
    expect(messageRepository.save).toHaveBeenCalledTimes(2);
    expect(transcriptService.appendEntry).toHaveBeenCalledTimes(2);
    expect(serverEmit).toHaveBeenCalledWith(
      'workflow:agent_stream_end',
      expect.objectContaining({
        sessionId,
        agentName: 'Claude',
        fullContent: 'Hello world',
      }),
    );
  });

  it('emits streamed chunks and persists the aggregated assistant message once after completion', async () => {
    const agent = {
      id: 'claude-001',
      name: 'Claude',
      generate: jest.fn(),
      streamGenerate: jest.fn(async function* (streamPrompt: string, context: AgentContext) {
        expect(streamPrompt).toBe('');
        expect(context.sessionId).toBe(sessionId);
        expect(context.conversationHistory).toHaveLength(1);
        yield 'Hello';
        yield ' ';
        yield 'world';
      }),
    };

    await (
      gateway as unknown as {
        handleAgentResponse: (id: string, agentArg: typeof agent) => Promise<void>;
      }
    ).handleAgentResponse(sessionId, agent);

    expect(agent.generate).not.toHaveBeenCalled();
    expect(agent.streamGenerate).toHaveBeenCalledWith('', expect.objectContaining({ sessionId }));

    expect(
      serverEmit.mock.calls.map(([event, payload]) => [event, payload.delta ?? payload.fullContent ?? payload.reason]),
    ).toEqual([
      ['agent:thinking', 'Processing request'],
      ['agent:stream', 'Hello'],
      ['agent:stream', ' '],
      ['agent:stream', 'world'],
      ['agent:stream:end', 'Hello world'],
    ]);

    expect(messageRepository.create).toHaveBeenCalledTimes(1);
    expect(messageRepository.save).toHaveBeenCalledTimes(1);
    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        userId: null,
        agentId: 'claude-001',
        agentName: 'Claude',
        role: 'assistant',
        content: 'Hello world',
      }),
    );

    expect(sessionContextService.appendAssistantTurn).toHaveBeenCalledTimes(1);
    expect(sessionContextService.appendAssistantTurn).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        content: 'Hello world',
        agentId: 'claude-001',
        agentName: 'Claude',
      }),
    );

    expect(transcriptService.appendEntry).toHaveBeenCalledTimes(1);
    expect(transcriptService.appendEntry).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        role: 'assistant',
        content: 'Hello world',
        agentId: 'claude-001',
        agentName: 'Claude',
      }),
    );

    expect(priorityService.recordUsage).toHaveBeenCalledTimes(1);
    expect(priorityService.recordUsage).toHaveBeenCalledWith('claude-001', 3);
  });

  it('emits agent:error and skips persistence when streaming fails', async () => {
    const agent = {
      id: 'codex-001',
      name: 'Codex',
      generate: jest.fn(),
      streamGenerate: jest.fn(async function* () {
        yield 'partial';
        throw new Error('stream failed');
      }),
    };

    await (
      gateway as unknown as {
        handleAgentResponse: (id: string, agentArg: typeof agent) => Promise<void>;
      }
    ).handleAgentResponse(sessionId, agent);

    expect(serverEmit.mock.calls.map(([event]) => event)).toEqual(['agent:thinking', 'agent:stream', 'agent:error']);
    expect(serverEmit.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        agentId: 'codex-001',
        agentName: 'Codex',
        error: 'stream failed',
      }),
    );

    expect(messageRepository.save).not.toHaveBeenCalled();
    expect(sessionContextService.appendAssistantTurn).not.toHaveBeenCalled();
    expect(transcriptService.appendEntry).not.toHaveBeenCalled();
    expect(priorityService.recordUsage).not.toHaveBeenCalled();
  });

  it('normalizes non-Error thrown values in agent:error payloads', async () => {
    const agent = {
      id: 'gemini-001',
      name: 'Gemini',
      generate: jest.fn(),
      streamGenerate: jest.fn(async function* () {
        throw { code: 'RATE_LIMIT', retryable: true };
      }),
    };

    await (
      gateway as unknown as {
        handleAgentResponse: (id: string, agentArg: typeof agent) => Promise<void>;
      }
    ).handleAgentResponse(sessionId, agent);

    expect(serverEmit.mock.calls.map(([event]) => event)).toEqual(['agent:thinking', 'agent:error']);
    expect(serverEmit.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        agentId: 'gemini-001',
        agentName: 'Gemini',
        error: '{"code":"RATE_LIMIT","retryable":true}',
      }),
    );
  });

  it('emits stream:end but does not persist or record usage when the stream yields no chunks', async () => {
    const agent = {
      id: 'claude-001',
      name: 'Claude',
      generate: jest.fn(),
      streamGenerate: jest.fn(async function* () {
        return;
      }),
    };

    await (
      gateway as unknown as {
        handleAgentResponse: (id: string, agentArg: typeof agent) => Promise<void>;
      }
    ).handleAgentResponse(sessionId, agent);

    expect(
      serverEmit.mock.calls.map(([event, payload]) => [event, payload.delta ?? payload.fullContent ?? payload.reason]),
    ).toEqual([
      ['agent:thinking', 'Processing request'],
      ['agent:stream:end', ''],
    ]);

    expect(messageRepository.save).not.toHaveBeenCalled();
    expect(sessionContextService.appendAssistantTurn).not.toHaveBeenCalled();
    expect(transcriptService.appendEntry).not.toHaveBeenCalled();
    expect(priorityService.recordUsage).not.toHaveBeenCalled();
  });

  it('emits session:deleted and disconnects clients on successful deletion', async () => {
    const deletionSessionId = 'test-session';

    await gateway.handleSessionDelete(client as any, { sessionId: deletionSessionId });

    expect(deletionService.deleteSession).toHaveBeenCalledWith(deletionSessionId);
    expect(serverEmit).toHaveBeenCalledWith('session:delete:started', { sessionId: deletionSessionId });
    expect(serverEmit).toHaveBeenCalledWith('session:deleted', { sessionId: deletionSessionId });
  });

  it('queues deletion on failure', async () => {
    const deletionSessionId = 'test-session';
    deletionService.deleteSession.mockRejectedValue(new Error('DB error'));

    const result = await gateway.handleSessionDelete(client as any, { sessionId: deletionSessionId });

    expect(result).toEqual({ success: true, queued: true });
    expect(deletionQueue.add).toHaveBeenCalledWith({ sessionId: deletionSessionId });
    expect(serverEmit).toHaveBeenCalledWith('session:delete:queued', {
      sessionId: deletionSessionId,
      message: 'Deletion queued for retry',
    });
  });
});
