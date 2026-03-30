import { ReactPromptBuilder } from './react-prompt.builder';

describe('ReactPromptBuilder', () => {
  let builder: ReactPromptBuilder;

  beforeEach(() => {
    builder = new ReactPromptBuilder();
  });

  it('构建系统 prompt 时插值变量', () => {
    const prompt = builder.buildSystemPrompt({
      name: 'Claude',
      role: '代码审查',
      taskDescription: '审查代码质量',
      availableTools: 'read_file, write_file',
      maxSteps: 10,
    });

    expect(prompt).toContain('Claude');
    expect(prompt).toContain('代码审查');
    expect(prompt).toContain('审查代码质量');
    expect(prompt).toContain('read_file, write_file');
    expect(prompt).toContain('10');
  });

  it('使用默认 maxSteps', () => {
    const prompt = builder.buildSystemPrompt({
      name: 'Claude',
      role: '测试',
      taskDescription: '测试任务',
      availableTools: '',
    });

    expect(prompt).toContain('10');
  });
});
