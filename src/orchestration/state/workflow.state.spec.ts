import type { AgentRunResult } from '../runtime/agent-run-result';
import type { HandoffDirective } from '../runtime/handoff.directive';
import type { WorkflowRunConfig } from '../runtime/workflow-run-config';
import { ReasoningStep, WorkflowState } from './workflow.state';

describe('WorkflowState', () => {
  it('models the reduced runtime state explicitly', () => {
    const config: WorkflowRunConfig = {
      mentionedAgents: [],
      useReAct: true,
      reactMaxSteps: 10,
    };

    const state: WorkflowState = {
      sessionId: 'test-session',
      entryMessageId: 'msg-1',
      activeAgent: null,
      pendingHandoff: null,
      planInput: '',
      lastAgentResult: null,
      control: {
        needsReview: false,
        hasError: false,
      },
      status: 'routing',
      config,
      reasoningSteps: [],
    };

    expect(state.sessionId).toBe('test-session');
    expect(state.status).toBe('routing');
    expect(state.config.reactMaxSteps).toBe(10);
  });

  it('models structured handoff and run results', () => {
    const handoff: HandoffDirective = {
      targetAgent: 'Codex',
      reason: 'Implement the plan',
    };

    const result: AgentRunResult = {
      agentName: 'Claude',
      rawOutput: 'draft<handoff_agent>Codex</handoff_agent>',
      cleanOutput: 'draft',
      needsReview: false,
      handoff,
    };

    expect(result.handoff?.targetAgent).toBe('Codex');
    expect(result.cleanOutput).toBe('draft');
  });

  it('keeps valid reasoning step structure for trace compatibility', () => {
    const step: ReasoningStep = {
      id: '1',
      thought: 'reasoning',
      toolCall: { name: 'execute_command', args: {} },
      observation: 'observation',
      isDone: false,
    };

    expect(step.id).toBe('1');
    expect(step.thought).toBe('reasoning');
  });
});
