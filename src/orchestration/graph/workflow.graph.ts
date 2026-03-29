import { Logger } from '@nestjs/common';
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import type { WorkflowState } from '../state/workflow.state';
import type { AgentRouter } from '../../gateway/agent-router';
import type { ConversationHistoryService } from '../../memory/services/conversation-history.service';
import { parseAgentOutput } from '../handoff/output-parser';
import { parseMention } from '../handoff/mention-parser';

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
  messages: Annotation<WorkflowState['messages']>(),
  pendingTasks: Annotation<WorkflowState['pendingTasks']>(),
  completedTasks: Annotation<WorkflowState['completedTasks']>(),
  currentAgent: Annotation<string | null>(),
  nextAgent: Annotation<string | null>(),
  isComplete: Annotation<boolean>(),
  chainOfThought: Annotation<string[]>(),
  hasError: Annotation<boolean>(),
  errorMessage: Annotation<string | undefined>(),
  needsReview: Annotation<boolean>(),
  reviewReason: Annotation<string | undefined>(),
  lastOutput: Annotation<string | undefined>(),
  metadata: Annotation<Record<string, unknown>>(),
});

type WorkflowNodeState = typeof WorkflowAnnotation.State;

function createRunTaskNode(agentRouter: AgentRouter, conversationHistoryService: ConversationHistoryService) {
  return async (state: WorkflowNodeState) => {
    logger.log(`[LangGraph] run_task: currentAgent=${state.currentAgent}`);
    if (!state.currentAgent) {
      logger.log(`[LangGraph] run_task: no currentAgent, skipping`);
      return { ...state, hasError: true, errorMessage: 'No agent selected' };
    }

    const agent = agentRouter.getAgentByName(state.currentAgent);
    if (!agent) {
      logger.log(`[LangGraph] run_task: agent not found: ${state.currentAgent}`);
      return { ...state, hasError: true, errorMessage: `Agent not found: ${state.currentAgent}` };
    }

    const userMessage = state.messages.at(-1)?.content || '';
    const historyContext = await conversationHistoryService.getContext(state.sessionId, agent.id);
    const conversationHistory = historyContext.messages.map((m, idx) => ({
      id: `msg_${idx}`,
      sessionId: state.sessionId,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      timestamp: m.timestamp,
      createdAt: new Date(m.timestamp),
    }));

    const context = {
      sessionId: state.sessionId,
      conversationHistory,
    };

    try {
      logger.log(`[LangGraph] run_task: calling LLM with message: ${userMessage.substring(0, 50)}...`);
      let fullContent = '';
      for await (const chunk of agent.streamGenerate(userMessage, context)) {
        fullContent += chunk;
      }
      logger.log(`[LangGraph] run_task: LLM response received, length=${fullContent.length}`);
      return { ...state, hasError: false, errorMessage: undefined, lastOutput: fullContent };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.log(`[LangGraph] run_task: error=${errorMsg}`);
      return { ...state, hasError: true, errorMessage: errorMsg };
    }
  };
}

export function buildWorkflowGraph(agentRouter: AgentRouter, conversationHistoryService: ConversationHistoryService) {
  const graph = new StateGraph(WorkflowAnnotation)
    .addNode(WORKFLOW_NODES.HYDRATE, async (state) => {
      logger.log(`[LangGraph] hydrate_session_state: sessionId=${state.sessionId}`);
      return { ...state };
    })
    .addNode(WORKFLOW_NODES.ROUTE, async (state) => {
      const mention = parseMention(state.messages.at(-1)?.content || '');
      const nextAgent = mention || (state.metadata.mentionedAgents as string[])?.[0] || 'Claude';
      logger.log(`[LangGraph] route_message: resolved agent=${nextAgent}`);
      return { ...state, nextAgent, currentAgent: nextAgent };
    })
    .addNode(WORKFLOW_NODES.RUN_TASK, createRunTaskNode(agentRouter, conversationHistoryService))
    .addNode(WORKFLOW_NODES.CHECK_OUTPUT, async (state) => {
      const output = state.lastOutput || '';
      const parsed = parseAgentOutput(output);
      logger.log(`[LangGraph] check_output: needsReview=${parsed.needsReview}, nextAgent=${parsed.nextAgent}`);
      return { ...state, needsReview: parsed.needsReview, nextAgent: parsed.nextAgent, lastOutput: parsed.cleanOutput };
    })
    .addNode(WORKFLOW_NODES.AWAIT_REVIEW, async (state) => {
      logger.log(`[LangGraph] await_human_review: waiting for human decision`);
      return { ...state };
    })
    .addNode(WORKFLOW_NODES.ROUTE_AGENT, async (state) => {
      logger.log(`[LangGraph] route_to_next_agent: nextAgent=${state.nextAgent}`);
      return { ...state, currentAgent: state.nextAgent };
    })
    .addNode(WORKFLOW_NODES.HANDLE_ERROR, async (state) => {
      logger.log(`[LangGraph] handle_error: error=${state.errorMessage}`);
      return { ...state };
    })
    .addEdge(START, WORKFLOW_NODES.HYDRATE)
    .addEdge(WORKFLOW_NODES.HYDRATE, WORKFLOW_NODES.ROUTE)
    .addEdge(WORKFLOW_NODES.ROUTE, WORKFLOW_NODES.RUN_TASK)
    .addEdge(WORKFLOW_NODES.RUN_TASK, WORKFLOW_NODES.CHECK_OUTPUT)
    .addEdge(WORKFLOW_NODES.AWAIT_REVIEW, WORKFLOW_NODES.ROUTE_AGENT)
    .addEdge(WORKFLOW_NODES.ROUTE_AGENT, WORKFLOW_NODES.RUN_TASK)
    .addEdge(WORKFLOW_NODES.HANDLE_ERROR, WORKFLOW_NODES.AWAIT_REVIEW)
    .addConditionalEdges(WORKFLOW_NODES.CHECK_OUTPUT, (state): string => {
      if (state.hasError) {
        logger.log(`[LangGraph] condition: hasError=true → handle_error`);
        return WORKFLOW_NODES.HANDLE_ERROR;
      }
      if (state.needsReview) {
        logger.log(`[LangGraph] condition: needsReview=true → await_human_review`);
        return WORKFLOW_NODES.AWAIT_REVIEW;
      }
      if (state.nextAgent) {
        logger.log(`[LangGraph] condition: nextAgent=${state.nextAgent} → route_to_next_agent`);
        return WORKFLOW_NODES.ROUTE_AGENT;
      }
      logger.log(`[LangGraph] condition: no branch matched → END`);
      return END;
    });

  return graph.compile();
}
