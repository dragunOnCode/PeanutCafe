import { buildWorkflowGraph, WORKFLOW_NODES } from './workflow.graph';
import type { WorkflowState } from '../state/workflow.state';
import type { AgentRouter } from '../../gateway/agent-router';
import type { SessionContextService } from '../context/session-context.service';
import type { CotWriterService } from '../chain-of-thought/cot-writer.service';
import type { AgentContext } from '../../agents/interfaces/llm-adapter.interface';

describe('WORKFLOW_NODES', () => {
  it('should have all required node names', () => {
    expect(WORKFLOW_NODES.HYDRATE).toBe('hydrate_session_state');
    expect(WORKFLOW_NODES.ROUTE).toBe('route_message');
    expect(WORKFLOW_NODES.RUN_TASK).toBe('run_task');
    expect(WORKFLOW_NODES.CHECK_OUTPUT).toBe('check_output');
    expect(WORKFLOW_NODES.AWAIT_REVIEW).toBe('await_human_review');
    expect(WORKFLOW_NODES.ROUTE_AGENT).toBe('route_to_next_agent');
    expect(WORKFLOW_NODES.HANDLE_ERROR).toBe('handle_error');
  });
});

describe('buildWorkflowGraph', () => {
  it('uses SessionContextService history instead of state.messages and appends assistant output back to session context', async () => {
    const streamGenerate = jest.fn(async function* (prompt: string, context: AgentContext) {
      await Promise.resolve();
      yield `answer for ${prompt} with ${context.conversationHistory?.[0]?.content ?? 'no-history'}`;
    });
    const getContextMock = jest.fn().mockResolvedValue({
      sessionId: 'session-1',
      turns: [
        {
          id: 'ctx-1',
          sessionId: 'session-1',
          role: 'user',
          kind: 'user',
          content: 'history from session context',
          createdAt: new Date('2026-04-04T00:00:00.000Z'),
        },
      ],
    });
    const appendAssistantTurnMock = jest.fn().mockResolvedValue(undefined);
    const appendHandoffSummaryMock = jest.fn().mockResolvedValue(undefined);

    const agentRouter = {
      getAgentByName: jest.fn().mockReturnValue({
        id: 'claude-001',
        name: 'Claude',
        streamGenerate,
      }),
    } as unknown as AgentRouter;

    const sessionContextService = {
      getContext: getContextMock,
      appendAssistantTurn: appendAssistantTurnMock,
      appendHandoffSummary: appendHandoffSummaryMock,
    } as unknown as jest.Mocked<SessionContextService>;

    const cotWriter = {
      writeAgentThinking: jest.fn().mockResolvedValue(undefined),
    } as unknown as CotWriterService;

    const graph = buildWorkflowGraph(agentRouter, sessionContextService, new Map(), cotWriter);

    const initialState: WorkflowState = {
      sessionId: 'session-1',
      entryMessageId: 'msg-1',
      activeAgent: null,
      pendingHandoff: null,
      planInput: 'fresh plan input',
      lastAgentResult: null,
      control: {
        needsReview: false,
        hasError: false,
      },
      status: 'routing',
      config: {
        mentionedAgents: ['Claude'],
        useReAct: false,
        reactMaxSteps: 10,
      },
      reasoningSteps: [],
    };

    const steps: Array<Record<string, Partial<WorkflowState>>> = [];
    for await (const step of await graph.stream(initialState)) {
      steps.push(step as Record<string, Partial<WorkflowState>>);
    }

    expect(getContextMock).toHaveBeenCalledWith('session-1');
    expect(streamGenerate).toHaveBeenCalledWith('fresh plan input', expect.any(Object));
    const streamContext = streamGenerate.mock.calls[0]?.[1] as AgentContext | undefined;
    expect(streamContext?.conversationHistory?.[0]).toMatchObject({
      content: 'history from session context',
    });
    expect(appendAssistantTurnMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        content: 'answer for fresh plan input with history from session context',
        agentId: 'claude-001',
        agentName: 'Claude',
      }),
    );

    const finalState = steps.reduce((acc, step) => {
      const stepState = Object.values(step)[0] as Partial<WorkflowState> | undefined;
      return stepState ? { ...acc, ...stepState } : acc;
    }, initialState);
    expect(finalState.lastAgentResult?.cleanOutput).toBe(
      'answer for fresh plan input with history from session context',
    );
  });
});
