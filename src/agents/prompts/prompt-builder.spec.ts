// src/agents/prompts/prompt-builder.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PromptBuilder } from './prompt-builder';
import { PromptTemplateService } from './prompt-template.service';

interface MockAgentConfig {
  id: string;
  name: string;
  type: string;
  role: string;
  capabilities: string[];
  model: string;
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder;
  let mockTemplateService: Partial<PromptTemplateService>;

  beforeEach(async () => {
    mockTemplateService = {
      buildPrompt: jest.fn().mockResolvedValue('Mocked system prompt for Claude'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptBuilder, { provide: PromptTemplateService, useValue: mockTemplateService }],
    }).compile();

    builder = module.get<PromptBuilder>(PromptBuilder);
  });

  describe('buildSystemPrompt', () => {
    it('should build system prompt for agent', async () => {
      const agent: MockAgentConfig = {
        id: 'claude-001',
        name: 'Claude',
        type: 'claude',
        role: '架构设计与编码实现',
        capabilities: ['架构设计', '代码生成'],
        model: 'MiniMax-M2.5',
      };

      const context = { sessionId: 'test-session' };

      const result = await builder.buildSystemPrompt(agent, context);

      expect(mockTemplateService.buildPrompt).toHaveBeenCalledWith(
        'test-session',
        'claude',
        expect.objectContaining({
          name: 'Claude',
          role: '架构设计与编码实现',
        }),
      );
      expect(result).toBe('Mocked system prompt for Claude');
    });
  });

  describe('buildMessages', () => {
    it('should build messages array with system prompt', async () => {
      const agent: MockAgentConfig = {
        id: 'claude-001',
        name: 'Claude',
        type: 'claude',
        role: '架构设计与编码实现',
        capabilities: ['架构设计'],
        model: 'MiniMax-M2.5',
      };

      const context = {
        sessionId: 'test-session',
        conversationHistory: [],
      };

      const messages = await builder.buildMessages(agent, context);

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('Mocked system prompt for Claude');
    });

    it('should include conversation history', async () => {
      const agent: MockAgentConfig = {
        id: 'claude-001',
        name: 'Claude',
        type: 'claude',
        role: '架构设计与编码实现',
        capabilities: ['架构设计'],
        model: 'MiniMax-M2.5',
      };

      const context = {
        sessionId: 'test-session',
        conversationHistory: [
          {
            id: '1',
            sessionId: 'test-session',
            role: 'user',
            kind: 'user',
            content: 'Hello',
            createdAt: new Date(),
          },
          {
            id: '2',
            sessionId: 'test-session',
            role: 'assistant',
            kind: 'assistant',
            content: 'Hi there',
            agentName: 'Claude',
            createdAt: new Date(),
          },
        ],
      };

      const messages = await builder.buildMessages(agent, context);

      expect(messages.length).toBe(3);
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
    });
  });
});
