import { ReactPromptBuilder } from './react-prompt.builder';
import { PromptTemplateService } from '../prompts/prompt-template.service';

describe('ReactPromptBuilder', () => {
  let builder: ReactPromptBuilder;
  let mockTemplateService: jest.Mocked<PromptTemplateService>;

  beforeEach(() => {
    mockTemplateService = {
      buildPrompt: jest.fn().mockResolvedValue('Base system prompt from template service'),
    } as any;
    builder = new ReactPromptBuilder(mockTemplateService);
  });

  it('构建系统 prompt 时调用 templateService 并追加 ReAct 规则', async () => {
    const prompt = await builder.buildSystemPrompt('session-123', 'claude', {
      name: 'Claude',
      role: '代码审查',
      model: 'test-model',
      taskDescription: '审查代码质量',
      availableTools: 'read_file, write_file',
      maxSteps: 10,
    });

    expect(mockTemplateService.buildPrompt).toHaveBeenCalledWith('session-123', 'claude', {
      name: 'Claude',
      role: '代码审查',
      model: 'test-model',
      sessionId: 'session-123',
      capabilities: ['read_file', 'write_file'],
    });
    expect(prompt).toContain('Base system prompt from template service');
    expect(prompt).toContain('ReAct');
  });

  it('使用默认 maxSteps', async () => {
    const prompt = await builder.buildSystemPrompt('session-456', 'codex', {
      name: 'Codex',
      role: '测试',
      model: 'test-model',
      taskDescription: '测试任务',
    });

    expect(prompt).toContain('10');
    expect(prompt).toContain('Base system prompt from template service');
  });

  it('buildInitialMessages 返回正确的消息结构', async () => {
    const messages = await builder.buildInitialMessages('session-789', 'gemini', '测试任务', {
      name: 'Gemini',
      role: '设计',
      model: 'test-model',
      taskDescription: '测试',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('测试任务');
  });
});
