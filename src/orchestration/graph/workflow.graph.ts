import { Logger } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { AgentRouter } from '../../gateway/agent-router';
import type { ReActStreamEvent } from '../../agents/react/react-executor.service';
import type { SessionContextService } from '../context/session-context.service';
import { CotWriterService } from '../chain-of-thought/cot-writer.service';
import { parseMention } from '../handoff/mention-parser';
import { parseAgentOutput, stripSpecialTags } from '../handoff/output-parser';
import type { AgentRunResult } from '../runtime/agent-run-result';
import type { HandoffDirective } from '../runtime/handoff.directive';
import type { WorkflowControlState, WorkflowState, WorkflowStatus, ReasoningStep } from '../state/workflow.state';
import type { ILLMAdapter, AgentContext } from '../../agents/interfaces/llm-adapter.interface';

export const WORKFLOW_NODES = {
  HYDRATE: 'hydrate_session_state',
  ROUTE: 'route_message',
  RUN_TASK: 'run_task',
  CHECK_OUTPUT: 'check_output',
  AWAIT_REVIEW: 'await_human_review',
  ROUTE_AGENT: 'route_to_next_agent',
  HANDLE_ERROR: 'handle_error',
} as const;

export type WorkflowNodeName = (typeof WORKFLOW_NODES)[keyof typeof WORKFLOW_NODES];

const logger = new Logger('WorkflowGraph');

const WorkflowAnnotation = Annotation.Root({
  sessionId: Annotation<string>(),
  entryMessageId: Annotation<string>(),
  activeAgent: Annotation<string | null>(),
  pendingHandoff: Annotation<HandoffDirective | null>(),
  planInput: Annotation<string>(),
  lastAgentResult: Annotation<AgentRunResult | null>(),
  control: Annotation<WorkflowControlState>(),
  status: Annotation<WorkflowStatus>(),
  config: Annotation<WorkflowState['config']>(),
  reviewReason: Annotation<string | undefined>(),
  reasoningSteps: Annotation<ReasoningStep[]>(),
});

type WorkflowNodeState = typeof WorkflowAnnotation.State;

type ReActCapableAdapter = ILLMAdapter & {
  executeWithReAct: (
    message: string,
    context: AgentContext,
    options?: { maxSteps?: number },
  ) => AsyncGenerator<ReActStreamEvent>;
};

function supportsReAct(agent: ILLMAdapter): agent is ReActCapableAdapter {
  return typeof (agent as ReActCapableAdapter).executeWithReAct === 'function';
}

export type SessionStreamHooks = {
  onChunk: (agentName: string, delta: string) => void;
  onAgentStreamEnd: (agentName: string, fullContent: string) => void;
};

function createRunTaskNode(
  agentRouter: AgentRouter,
  sessionContextService: SessionContextService,
  streamHooksBySession: Map<string, SessionStreamHooks>,
  cotWriter: CotWriterService,
) {
  let stepCounter = 0;

  return async (state: WorkflowNodeState) => {
    const agentName = state.activeAgent;
    logger.log(`[LangGraph] run_task: activeAgent=${agentName}`);

    if (!agentName) {
      return {
        ...state,
        status: 'failed',
        control: {
          ...state.control,
          hasError: true,
          errorMessage: 'No agent selected',
        },
      };
    }

    const agent = agentRouter.getAgentByName(agentName);
    if (!agent) {
      return {
        ...state,
        status: 'failed',
        control: {
          ...state.control,
          hasError: true,
          errorMessage: `Agent not found: ${agentName}`,
        },
      };
    }

    const hooks = streamHooksBySession.get(state.sessionId);
    const sessionContext = await sessionContextService.getContext(state.sessionId);
    const context = {
      sessionId: state.sessionId,
      conversationHistory: sessionContext.turns,
    };

    const reasoningSteps: ReasoningStep[] = [];

    try {
      let rawOutput = '';
      let doneContent: string | null = null;
      let handoff: HandoffDirective | null = null;

      if (state.config.useReAct && supportsReAct(agent)) {
        for await (const event of agent.executeWithReAct(state.planInput, context, {
          maxSteps: state.config.reactMaxSteps,
        })) {
          switch (event.type) {
            case 'text_delta':
              rawOutput += event.text;
              hooks?.onChunk(agent.name, event.text);
              break;
            case 'done':
              doneContent = event.content;
              break;
            case 'handoff':
              handoff = { targetAgent: event.agentName };
              break;
            case 'error':
              logger.error(`[LangGraph] run_task: ReAct error event: ${event.message}`);
              break;
          }
        }
      } else {
        for await (const chunk of agent.streamGenerate(state.planInput, context)) {
          rawOutput += chunk;
          hooks?.onChunk(agent.name, chunk);
        }
      }

      const parsed = parseAgentOutput(rawOutput);
      const cleanOutput = doneContent ? stripSpecialTags(doneContent) : parsed.cleanOutput;
      const resolvedHandoff = handoff ?? parsed.handoff;

      stepCounter++;
      reasoningSteps.push({
        id: `step_${stepCounter}`,
        thought: rawOutput,
        toolCall: null,
        observation: '',
        isDone: false,
        handoffAgent: resolvedHandoff?.targetAgent,
      });

      await sessionContextService.appendAssistantTurn(state.sessionId, {
        content: cleanOutput,
        agentId: agent.id,
        agentName: agent.name,
      });

      if (resolvedHandoff?.summaryForNextAgent) {
        await sessionContextService.appendHandoffSummary(state.sessionId, {
          content: resolvedHandoff.summaryForNextAgent,
          agentId: agent.id,
          agentName: agent.name,
        });
      }

      hooks?.onAgentStreamEnd(agent.name, cleanOutput);

      await cotWriter.writeAgentThinking(
        state.sessionId,
        agent.id,
        agent.name,
        state.planInput,
        reasoningSteps,
        resolvedHandoff?.targetAgent,
      );

      return {
        ...state,
        lastAgentResult: {
          agentName: agent.name,
          rawOutput,
          cleanOutput,
          needsReview: parsed.needsReview,
          handoff: resolvedHandoff,
        },
        status: 'running',
        control: {
          needsReview: false,
          hasError: false,
        },
        reasoningSteps,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        ...state,
        lastAgentResult: {
          agentName: agent.name,
          rawOutput: '',
          cleanOutput: '',
          needsReview: false,
          handoff: null,
          errorMessage,
        },
        status: 'failed',
        control: {
          needsReview: false,
          hasError: true,
          errorMessage,
        },
      };
    }
  };
}

export function buildWorkflowGraph(
  agentRouter: AgentRouter,
  sessionContextService: SessionContextService,
  streamHooksBySession: Map<string, SessionStreamHooks>,
  cotWriter: CotWriterService,
) {
  const graph = new StateGraph(WorkflowAnnotation)
    .addNode(WORKFLOW_NODES.HYDRATE, (state) => {
      logger.log(`[LangGraph] hydrate_session_state: sessionId=${state.sessionId}`);
      return { ...state };
    })
    .addNode(WORKFLOW_NODES.ROUTE, (state) => {
      const mention = parseMention(state.planInput);
      const activeAgent = mention || state.config.mentionedAgents[0] || 'Claude';

      logger.log(`[LangGraph] route_message: resolved agent=${activeAgent}`);

      return {
        ...state,
        activeAgent,
        status: 'running',
      };
    })
    .addNode(
      WORKFLOW_NODES.RUN_TASK,
      createRunTaskNode(agentRouter, sessionContextService, streamHooksBySession, cotWriter),
    )
    .addNode(WORKFLOW_NODES.CHECK_OUTPUT, (state) => {
      const result = state.lastAgentResult;
      let pendingHandoff = result?.handoff ?? null;

      if (pendingHandoff && pendingHandoff.targetAgent === state.activeAgent) {
        pendingHandoff = null;
      }

      const hasError = Boolean(result?.errorMessage);
      const needsReview = result?.needsReview ?? false;

      let status: WorkflowStatus = 'completed';
      if (hasError) status = 'failed';
      else if (needsReview) status = 'awaiting_review';
      else if (pendingHandoff) status = 'handoff';

      logger.log(
        `[LangGraph] check_output: status=${status}, handoff=${pendingHandoff?.targetAgent ?? 'none'}, needsReview=${needsReview}`,
      );

      return {
        ...state,
        pendingHandoff,
        status,
        control: {
          needsReview,
          hasError,
          errorMessage: result?.errorMessage,
        },
      };
    })
    .addNode(WORKFLOW_NODES.AWAIT_REVIEW, (state) => {
      logger.log(`[LangGraph] await_human_review: waiting for human decision`);
      return { ...state };
    })
    .addNode(WORKFLOW_NODES.ROUTE_AGENT, (state) => {
      const nextAgent = state.pendingHandoff?.targetAgent ?? null;

      logger.log(`[LangGraph] route_to_next_agent: nextAgent=${nextAgent}`);

      return {
        ...state,
        activeAgent: nextAgent,
        pendingHandoff: null,
        lastAgentResult: null,
        status: 'running',
        control: {
          needsReview: false,
          hasError: false,
        },
      };
    })
    .addNode(WORKFLOW_NODES.HANDLE_ERROR, (state) => {
      logger.log(`[LangGraph] handle_error: error=${state.control.errorMessage}`);
      return {
        ...state,
        status: 'awaiting_review',
        reviewReason: state.control.errorMessage,
      };
    })
    .addEdge(START, WORKFLOW_NODES.HYDRATE)
    .addEdge(WORKFLOW_NODES.HYDRATE, WORKFLOW_NODES.ROUTE)
    .addEdge(WORKFLOW_NODES.ROUTE, WORKFLOW_NODES.RUN_TASK)
    .addEdge(WORKFLOW_NODES.RUN_TASK, WORKFLOW_NODES.CHECK_OUTPUT)
    .addEdge(WORKFLOW_NODES.AWAIT_REVIEW, WORKFLOW_NODES.ROUTE_AGENT)
    .addEdge(WORKFLOW_NODES.ROUTE_AGENT, WORKFLOW_NODES.RUN_TASK)
    .addEdge(WORKFLOW_NODES.HANDLE_ERROR, WORKFLOW_NODES.AWAIT_REVIEW)
    .addConditionalEdges(WORKFLOW_NODES.CHECK_OUTPUT, (state): string => {
      if (state.control.hasError) return WORKFLOW_NODES.HANDLE_ERROR;
      if (state.control.needsReview) return WORKFLOW_NODES.AWAIT_REVIEW;
      if (state.pendingHandoff) return WORKFLOW_NODES.ROUTE_AGENT;
      return END;
    });

  return graph.compile();
}
