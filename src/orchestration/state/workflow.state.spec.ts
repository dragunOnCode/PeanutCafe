import { WorkflowState, Task, ReasoningStep } from './workflow.state';

describe('WorkflowState', () => {
  it('should have correct initial state', () => {
    const state: WorkflowState = {
      sessionId: 'test-session',
      messages: [],
      pendingTasks: [],
      completedTasks: [],
      currentAgent: null,
      nextAgent: null,
      isComplete: false,
      chainOfThought: [],
      metadata: {},
    };
    expect(state.sessionId).toBe('test-session');
    expect(state.isComplete).toBe(false);
  });

  it('should track tasks correctly', () => {
    const task: Task = {
      id: '1',
      description: 'Test task',
      status: 'pending',
    };
    expect(task.status).toBe('pending');
  });

  it('should have valid reasoning step structure', () => {
    const step: ReasoningStep = {
      id: '1',
      thought: '思考内容',
      action: 'execute_command',
      observation: '执行结果',
    };
    expect(step.id).toBe('1');
    expect(step.thought).toBe('思考内容');
  });
});
