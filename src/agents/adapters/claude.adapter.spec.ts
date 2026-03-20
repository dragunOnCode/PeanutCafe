import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { ClaudeAdapter } from './claude.adapter';
import { AgentContext, AgentStatus } from '../interfaces/llm-adapter.interface';

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;
  let httpService: HttpService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'openrouter.apiKey') return 'test-api-key';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeAdapter,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    adapter = module.get<ClaudeAdapter>(ClaudeAdapter);
    httpService = module.get<HttpService>(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generate', () => {
    const mockContext: AgentContext = {
      sessionId: 'test-session',
      userId: 'test-user',
    };

    it('should return generated content from OpenRouter API', async () => {
      const mockResponse: AxiosResponse = {
        data: {
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
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await adapter.generate('test prompt', mockContext);

      expect(result.content).toBe('Claude response content');
      expect(result.tokenUsage).toEqual({
        prompt: 10,
        completion: 20,
        total: 30,
      });
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle empty response content', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          choices: [{}],
          usage: {},
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await adapter.generate('test prompt', mockContext);

      expect(result.content).toBe('');
    });

    it('should throw error when API call fails', async () => {
      const error = new Error('API error');
      mockHttpService.post.mockReturnValue(throwError(() => error));

      await expect(adapter.generate('test prompt', mockContext)).rejects.toThrow('API error');
    });

    it('should set status to BUSY during generation', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          choices: [{ message: { content: 'test' } }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      await adapter.generate('test prompt', mockContext);

      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });
  });

  describe('streamGenerate', () => {
    it('should yield content from generate', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          choices: [{ message: { content: 'streamed content' } }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const generator = adapter.streamGenerate('test prompt', {
        sessionId: 'test',
      });

      const result = await generator.next();
      expect(result.value).toBe('streamed content');
    });
  });

  describe('healthCheck', () => {
    it('should return true when status is not ERROR', async () => {
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
    });
  });

  describe('shouldRespond', () => {
    it('should always return true', async () => {
      const mockMessage = {} as any;
      const mockContext = {} as any;
      const result = await adapter.shouldRespond(mockMessage, mockContext);
      expect(result.should).toBe(true);
    });
  });

  describe('adapter properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('claude-001');
    });

    it('should have correct name', () => {
      expect(adapter.name).toBe('Claude');
    });

    it('should have correct model', () => {
      expect(adapter.model).toBe('anthropic/claude-3-sonnet');
    });

    it('should have callType http', () => {
      expect(adapter.callType).toBe('http');
    });
  });
});
