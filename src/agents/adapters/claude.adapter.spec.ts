import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ClaudeAdapter } from './claude.adapter';
import { AgentContext, AgentStatus } from '../interfaces/llm-adapter.interface';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;
  let createMock: jest.Mock;

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'MINIMAX_API_KEY') return 'test-api-key';
      if (key === 'MINIMAX_BASE_URL') return 'https://test.example.com';
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  const MockedOpenAI = OpenAI as unknown as jest.Mock;

  const mockContext: AgentContext = {
    sessionId: 'test-session',
    userId: 'test-user',
  };

  const createStream = (...chunks: string[]) => ({
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield {
          choices: [
            {
              delta: {
                content: chunk,
              },
            },
          ],
        };
      }
    },
  });

  const createMixedStream = () => ({
    [Symbol.asyncIterator]: async function* () {
      yield {
        choices: [
          {
            delta: {
              content: 'Claude ',
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              content: null,
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {},
          },
        ],
      };
      yield {
        choices: [],
      };
      yield {
        choices: [
          {
            delta: {
              content: 'content',
            },
          },
        ],
      };
    },
  });

  beforeEach(async () => {
    createMock = jest.fn();
    MockedOpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: createMock,
        },
      },
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeAdapter,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    adapter = module.get<ClaudeAdapter>(ClaudeAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generate', () => {
    it('returns generated content from the OpenAI chat completion API', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Claude response content',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      const result = await adapter.generate('test prompt', mockContext);

      expect(result.content).toBe('Claude response content');
      expect(result.tokenUsage).toEqual({
        prompt: 10,
        completion: 20,
        total: 30,
      });
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'MiniMax-M2.5',
          temperature: 0.7,
          max_tokens: 4000,
        }),
      );
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });

    it('handles empty response content', async () => {
      createMock.mockResolvedValue({
        choices: [{}],
        usage: {},
      });

      const result = await adapter.generate('test prompt', mockContext);

      expect(result.content).toBe('');
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });

    it('throws when the API call fails', async () => {
      createMock.mockRejectedValue(new Error('API error'));

      await expect(adapter.generate('test prompt', mockContext)).rejects.toThrow('API error');
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });
  });

  describe('streamGenerate', () => {
    it('yields incremental chunks from the OpenAI stream API', async () => {
      createMock.mockResolvedValue(createStream('Claude ', 'streamed ', 'content'));

      const generator = adapter.streamGenerate('test prompt', mockContext);

      await expect(generator.next()).resolves.toEqual({ value: 'Claude ', done: false });
      expect(adapter.getStatus()).toBe(AgentStatus.BUSY);

      await expect(generator.next()).resolves.toEqual({ value: 'streamed ', done: false });
      expect(adapter.getStatus()).toBe(AgentStatus.BUSY);

      await expect(generator.next()).resolves.toEqual({ value: 'content', done: false });
      await expect(generator.next()).resolves.toEqual({ value: undefined, done: true });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'MiniMax-M2.5',
          stream: true,
          temperature: 0.7,
          max_tokens: 4000,
        }),
      );
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });

    it('resets status and propagates stream errors', async () => {
      createMock.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [
              {
                delta: {
                  content: 'Claude ',
                },
              },
            ],
          };
          throw new Error('stream api error');
        },
      });

      const generator = adapter.streamGenerate('test prompt', mockContext);

      await expect(generator.next()).resolves.toEqual({ value: 'Claude ', done: false });
      expect(adapter.getStatus()).toBe(AgentStatus.BUSY);
      await expect(generator.next()).rejects.toThrow('stream api error');
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });

    it('skips chunks where delta or content is missing or null', async () => {
      createMock.mockResolvedValue(createMixedStream());

      const generator = adapter.streamGenerate('test prompt', mockContext);

      await expect(generator.next()).resolves.toEqual({ value: 'Claude ', done: false });
      await expect(generator.next()).resolves.toEqual({ value: 'content', done: false });
      await expect(generator.next()).resolves.toEqual({ value: undefined, done: true });
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });
  });

  describe('healthCheck', () => {
    it('returns true when status is not ERROR', async () => {
      await expect(adapter.healthCheck()).resolves.toBe(true);
    });
  });

  describe('getStatus', () => {
    it('returns current status', () => {
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });
  });

  describe('shouldRespond', () => {
    it('always returns true', async () => {
      const result = await adapter.shouldRespond({} as any, {} as any);
      expect(result.should).toBe(true);
    });
  });

  describe('adapter properties', () => {
    it('has correct id, name, model, and callType', () => {
      expect(adapter.id).toBe('claude-001');
      expect(adapter.name).toBe('Claude');
      expect(adapter.model).toBe('MiniMax-M2.5');
      expect(adapter.callType).toBe('http');
    });
  });
});
