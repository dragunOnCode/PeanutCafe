import { ReActExecutorService, ReActConfig, ReasoningStep } from './react-executor.service';

describe('ReActExecutorService', () => {
  let service: ReActExecutorService;
  let mockToolExecutor: any;
  let mockLLMCaller: jest.Mock;

  beforeEach(() => {
    mockToolExecutor = {
      executeToolCall: jest.fn(),
      getOpenAITools: jest.fn().mockReturnValue([]),
    };
    mockLLMCaller = jest.fn();
    service = new ReActExecutorService(mockToolExecutor, mockLLMCaller);
  });

  it('达到 max_steps 时正确终止', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 2,
      sessionId: 'test',
    };

    // Mock 每次调用返回一个新的 generator
    let callCount = 0;
    mockLLMCaller.mockImplementation(() => {
      callCount++;
      // 只在前两次调用时返回有内容的 generator
      if (callCount <= 2) {
        return (async function* () {
          yield { content: '<thought>thinking</thought>' };
        })();
      }
      return (async function* () {})();
    });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    expect(steps.length).toBeLessThanOrEqual(2);
  });

  it('LLM 输出 done 时正确终止', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 10,
      sessionId: 'test',
    };

    mockLLMCaller.mockImplementation(async function* () {
      yield { content: '<thought>分析完毕</thought>' };
      yield { content: '<done>最终答案</done>' };
    });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    expect(steps.length).toBe(1);
    expect(steps[0].isDone).toBe(true);
    expect(steps[0].thought).toBe('分析完毕');
  });

  it('工具执行失败时继续执行', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 10,
      sessionId: 'test',
    };

    let callCount = 0;
    mockLLMCaller.mockImplementation(async function* () {
      callCount++;
      if (callCount === 1) {
        yield { content: '<thought>需要调用工具</thought>' };
      } else {
        yield { content: '<done>任务完成</done>' };
      }
    });

    mockToolExecutor.executeToolCall
      .mockResolvedValueOnce({ success: false, error: 'Tool error', result: '' })
      .mockResolvedValueOnce({ success: true, result: 'success', toolCallId: '1', toolName: 'test' });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  it('LLM 输出 handoff_agent 时正确终止', async () => {
    const messages: any[] = [{ role: 'user', content: 'test' }];
    const config: ReActConfig = {
      maxSteps: 10,
      sessionId: 'test',
    };

    mockLLMCaller.mockImplementation(async function* () {
      yield { content: '<thought>需要交接</thought>' };
      yield { content: '<handoff_agent>TargetAgent</handoff_agent>' };
    });

    const steps: ReasoningStep[] = [];
    for await (const step of service.execute(messages, config)) {
      steps.push(step);
    }

    expect(steps.length).toBe(1);
    expect(steps[0].handoffAgent).toBe('TargetAgent');
  });
});
