import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { CodexAdapter } from './codex.adapter';
import { AgentContext, AgentStatus } from '../interfaces/llm-adapter.interface';

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;
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
        CodexAdapter,
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

    adapter = module.get<CodexAdapter>(CodexAdapter);
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
                content: 'Codex review response',
              },
            },
          ],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await adapter.generate('test prompt', mockContext);

      expect(result.content).toBe('Codex review response');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle empty response content', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          choices: [{}],
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

    it('should set status to ONLINE after generation', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          choices: [{ message: { content: 'test' } }],
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
      expect(adapter.id).toBe('codex-001');
    });

    it('should have correct name', () => {
      expect(adapter.name).toBe('Codex');
    });

    it('should have correct model', () => {
      expect(adapter.model).toBe('codex');
    });

    it('should have callType http', () => {
      expect(adapter.callType).toBe('http');
    });

    it('should have correct role', () => {
      expect(adapter.role).toBe('代码审查与质量把控');
    });

    it('should have correct capabilities', () => {
      expect(adapter.capabilities).toEqual(['代码审查', '测试建议', '性能优化', '安全检测']);
    });
  });
});
