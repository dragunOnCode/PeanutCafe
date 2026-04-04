import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GeminiAdapter } from './gemini.adapter';
import { AgentContext, AgentStatus } from '../interfaces/llm-adapter.interface';
import { ToolExecutorService } from '../tools/tool-executor.service';
import { PromptBuilder } from '../prompts/prompt-builder';
import { ReactPromptBuilder } from '../react/react-prompt.builder';
import { ConversationHistoryService } from '../../memory/services/conversation-history.service';
import { ChatMessage } from '../utils/build-chat-messages';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  let createMock: jest.Mock;

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'QWEN_API_KEY') return 'test-api-key';
      if (key === 'QWEN_BASE_URL') return 'https://test.example.com';
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  const mockToolExecutorService = {
    registerSessionTools: jest.fn(),
    getOpenAITools: jest.fn().mockReturnValue([]),
    parseToolCalls: jest.fn().mockReturnValue([]),
    executeToolCall: jest.fn(),
    executeAllToolCalls: jest.fn().mockResolvedValue([]),
  };

  const mockPromptBuilder = {
    buildMessages: jest.fn().mockResolvedValue([
      { role: 'system', content: 'mocked system prompt' },
      { role: 'user', content: 'test prompt' },
    ] as ChatMessage[]),
  };

  const mockReactPromptBuilder = {
    buildSystemPrompt: jest.fn().mockResolvedValue('mocked react system prompt'),
  };

  const mockConversationHistoryService = {
    getContext: jest.fn().mockResolvedValue([]),
  };

  const MockedOpenAI = OpenAI as unknown as jest.Mock;

  const mockContext: AgentContext = {
    sessionId: 'test-session',
    userId: 'test-user',
  };
  const mockMessage = { id: 'msg-1', content: 'hello', type: 'text', timestamp: new Date() } as const;

  const createStream = (...chunks: string[]) => ({
    [Symbol.asyncIterator]: async function* () {
      await Promise.resolve();
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
      await Promise.resolve();
      yield {
        choices: [
          {
            delta: {
              content: 'Gemini ',
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
        GeminiAdapter,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ToolExecutorService,
          useValue: mockToolExecutorService,
        },
        {
          provide: PromptBuilder,
          useValue: mockPromptBuilder,
        },
        {
          provide: ReactPromptBuilder,
          useValue: mockReactPromptBuilder,
        },
        {
          provide: ConversationHistoryService,
          useValue: mockConversationHistoryService,
        },
      ],
    }).compile();

    adapter = module.get<GeminiAdapter>(GeminiAdapter);
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
              content: 'Gemini creative response',
            },
          },
        ],
      });

      const result = await adapter.generate('test prompt', mockContext);

      expect(result.content).toBe('Gemini creative response');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen3-32b',
          temperature: 0.8,
          max_tokens: 4000,
        }),
      );
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });

    it('handles empty response content', async () => {
      createMock.mockResolvedValue({
        choices: [{}],
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
      createMock.mockResolvedValue(createStream('Gemini ', 'streamed ', 'content'));

      const generator = adapter.streamGenerate('test prompt', mockContext);

      await expect(generator.next()).resolves.toEqual({ value: 'Gemini ', done: false });
      expect(adapter.getStatus()).toBe(AgentStatus.BUSY);

      await expect(generator.next()).resolves.toEqual({ value: 'streamed ', done: false });
      expect(adapter.getStatus()).toBe(AgentStatus.BUSY);

      await expect(generator.next()).resolves.toEqual({ value: 'content', done: false });
      await expect(generator.next()).resolves.toEqual({ value: undefined, done: true });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen3-32b',
          stream: true,
          temperature: 0.8,
          max_tokens: 4000,
        }),
      );
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });

    it('resets status and propagates stream errors', async () => {
      createMock.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          await Promise.resolve();
          yield {
            choices: [
              {
                delta: {
                  content: 'Gemini ',
                },
              },
            ],
          };
          throw new Error('stream api error');
        },
      });

      const generator = adapter.streamGenerate('test prompt', mockContext);

      await expect(generator.next()).resolves.toEqual({ value: 'Gemini ', done: false });
      expect(adapter.getStatus()).toBe(AgentStatus.BUSY);
      await expect(generator.next()).rejects.toThrow('stream api error');
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });

    it('skips chunks where delta or content is missing or null', async () => {
      createMock.mockResolvedValue(createMixedStream());

      const generator = adapter.streamGenerate('test prompt', mockContext);

      await expect(generator.next()).resolves.toEqual({ value: 'Gemini ', done: false });
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
      const result = await adapter.shouldRespond(mockMessage, mockContext);
      expect(result.should).toBe(true);
    });
  });

  describe('adapter properties', () => {
    it('has correct id, name, model, and callType', () => {
      expect(adapter.id).toBe('gemini-001');
      expect(adapter.name).toBe('Gemini');
      expect(adapter.model).toBe('qwen3-32b');
      expect(adapter.callType).toBe('http');
    });
  });
});
