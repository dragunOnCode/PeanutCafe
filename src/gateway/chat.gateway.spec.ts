import { ChatGateway } from './chat.gateway';
import { AgentContext } from '../agents/interfaces/llm-adapter.interface';

describe('ChatGateway streaming agent responses', () => {
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const prompt = 'test prompt';

  let gateway: ChatGateway;
  let serverEmit: jest.Mock;
  let shortTermMemory: { get: jest.Mock; append: jest.Mock };
  let transcriptService: { appendEntry: jest.Mock };
  let messageRepository: { create: jest.Mock; save: jest.Mock };
  let sessionRepository: { exist: jest.Mock; create: jest.Mock; save: jest.Mock };
  let priorityService: { recordUsage: jest.Mock; updateConfig: jest.Mock };

  beforeEach(() => {
    serverEmit = jest.fn();
    shortTermMemory = {
      get: jest.fn().mockResolvedValue([
        {
          role: 'user',
          content: 'previous user message',
          timestamp: '2026-03-21T00:00:00.000Z',
        },
      ]),
      append: jest.fn().mockResolvedValue(undefined),
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

    gateway = new ChatGateway(
      { addClient: jest.fn(), removeClient: jest.fn(), getActiveSessions: jest.fn(), getActiveClientCount: jest.fn() } as never,
      { parseMessage: jest.fn(), route: jest.fn() } as never,
      { registerAgent: jest.fn() } as never,
      shortTermMemory as never,
      transcriptService as never,
      {} as never,
      messageRepository as never,
      sessionRepository as never,
      priorityService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue({
        emit: serverEmit,
      }),
    } as never;
  });

  it('emits streamed chunks and persists the aggregated assistant message once after completion', async () => {
    const agent = {
      id: 'claude-001',
      name: 'Claude',
      generate: jest.fn(),
      streamGenerate: jest.fn(async function* (streamPrompt: string, context: AgentContext) {
        expect(streamPrompt).toBe(prompt);
        expect(context.sessionId).toBe(sessionId);
        expect(context.conversationHistory).toHaveLength(1);
        yield 'Hello';
        yield ' ';
        yield 'world';
      }),
    };

    await (gateway as unknown as { handleAgentResponse: (id: string, agentArg: typeof agent, content: string) => Promise<void> })
      .handleAgentResponse(sessionId, agent, prompt);

    expect(agent.generate).not.toHaveBeenCalled();
    expect(agent.streamGenerate).toHaveBeenCalledWith(prompt, expect.objectContaining({ sessionId }));

    expect(serverEmit.mock.calls.map(([event, payload]) => [event, payload.delta ?? payload.fullContent ?? payload.reason])).toEqual([
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

    expect(shortTermMemory.append).toHaveBeenCalledTimes(1);
    expect(shortTermMemory.append).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        role: 'assistant',
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

    await (gateway as unknown as { handleAgentResponse: (id: string, agentArg: typeof agent, content: string) => Promise<void> })
      .handleAgentResponse(sessionId, agent, prompt);

    expect(serverEmit.mock.calls.map(([event]) => event)).toEqual([
      'agent:thinking',
      'agent:stream',
      'agent:error',
    ]);
    expect(serverEmit.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        agentId: 'codex-001',
        agentName: 'Codex',
        error: 'stream failed',
      }),
    );

    expect(messageRepository.save).not.toHaveBeenCalled();
    expect(shortTermMemory.append).not.toHaveBeenCalled();
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

    await (gateway as unknown as { handleAgentResponse: (id: string, agentArg: typeof agent, content: string) => Promise<void> })
      .handleAgentResponse(sessionId, agent, prompt);

    expect(serverEmit.mock.calls.map(([event]) => event)).toEqual([
      'agent:thinking',
      'agent:error',
    ]);
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

    await (gateway as unknown as { handleAgentResponse: (id: string, agentArg: typeof agent, content: string) => Promise<void> })
      .handleAgentResponse(sessionId, agent, prompt);

    expect(serverEmit.mock.calls.map(([event, payload]) => [event, payload.delta ?? payload.fullContent ?? payload.reason])).toEqual([
      ['agent:thinking', 'Processing request'],
      ['agent:stream:end', ''],
    ]);

    expect(messageRepository.save).not.toHaveBeenCalled();
    expect(shortTermMemory.append).not.toHaveBeenCalled();
    expect(transcriptService.appendEntry).not.toHaveBeenCalled();
    expect(priorityService.recordUsage).not.toHaveBeenCalled();
  });
});
