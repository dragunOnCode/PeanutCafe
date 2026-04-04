import { OrchestrationService } from './orchestration.service';
import type { WorkflowState } from './state/workflow.state';
import type { AgentRouter } from '../gateway/agent-router';
import type { CotWriterService } from './chain-of-thought/cot-writer.service';
import type { PlannerService } from './agents/planner.service';
import type { ReactorService } from './agents/reactor.service';
import type { SessionContextService } from './context/session-context.service';

describe('OrchestrationService', () => {
  let service: OrchestrationService;

  beforeEach(() => {
    service = new OrchestrationService(
      {} as AgentRouter,
      {} as CotWriterService,
      {} as PlannerService,
      {} as ReactorService,
      {} as SessionContextService,
    );
  });

  it('should be instantiable', () => {
    expect(service).toBeInstanceOf(OrchestrationService);
  });

  it('creates runtime-oriented initial state', () => {
    const state = (
      service as unknown as { createInitialState: (typeof service)['createInitialState'] }
    ).createInitialState('session-1', 'plan this', ['Claude']);

    expect(state.planInput).toBe('plan this');
    expect(state.config).toEqual({
      mentionedAgents: ['Claude'],
      useReAct: true,
      reactMaxSteps: 10,
    });
    expect(state.activeAgent).toBeNull();
    expect(state.lastAgentResult).toBeNull();
  });

  it('derives completion events from runtime result and status', () => {
    const state: WorkflowState = {
      sessionId: 'session-1',
      entryMessageId: 'msg-1',
      activeAgent: 'Claude',
      pendingHandoff: null,
      planInput: 'plan this',
      lastAgentResult: {
        agentName: 'Claude',
        rawOutput: 'raw answer',
        cleanOutput: 'clean answer',
        needsReview: false,
        handoff: null,
      },
      control: {
        needsReview: false,
        hasError: false,
      },
      status: 'completed',
      config: {
        mentionedAgents: ['Claude'],
        useReAct: true,
        reactMaxSteps: 10,
      },
      reasoningSteps: [],
    };

    expect((service as unknown as { stateToEvent: (typeof service)['stateToEvent'] }).stateToEvent(state)).toEqual({
      type: 'complete',
      finalOutput: 'clean answer',
      agentName: 'Claude',
    });
  });

  it('derives handoff events from pendingHandoff and activeAgent', () => {
    const state: WorkflowState = {
      sessionId: 'session-1',
      entryMessageId: 'msg-1',
      activeAgent: 'Claude',
      pendingHandoff: {
        targetAgent: 'Codex',
      },
      planInput: 'plan this',
      lastAgentResult: {
        agentName: 'Claude',
        rawOutput: 'raw answer',
        cleanOutput: 'clean answer',
        needsReview: false,
        handoff: {
          targetAgent: 'Codex',
        },
      },
      control: {
        needsReview: false,
        hasError: false,
      },
      status: 'handoff',
      config: {
        mentionedAgents: ['Claude'],
        useReAct: true,
        reactMaxSteps: 10,
      },
      reasoningSteps: [],
    };

    expect((service as unknown as { stateToEvent: (typeof service)['stateToEvent'] }).stateToEvent(state)).toEqual({
      type: 'handoff',
      from: 'Claude',
      to: 'Codex',
    });
  });
});
