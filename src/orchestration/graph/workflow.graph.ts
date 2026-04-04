import { Logger } from '@nestjs/common';
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import type { WorkflowState, ReasoningStep } from '../state/workflow.state';
import type { AgentRouter } from '../../gateway/agent-router';
import type { ConversationHistoryService } from '../../memory/services/conversation-history.service';
import { CotWriterService } from '../chain-of-thought/cot-writer.service';
import { parseAgentOutput, stripSpecialTags } from '../handoff/output-parser';
import type { ReActStreamEvent } from '../../agents/react/react-executor.service';
import { parseMention } from '../handoff/mention-parser';
/* eslint-disable @typescript-eslint/no-non-null-assertion */

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
  reasoningSteps: Annotation<ReasoningStep[]>(),
  currentPlan: Annotation<string>(),
  hasError: Annotation<boolean>(),
  errorMessage: Annotation<string | undefined>(),
  needsReview: Annotation<boolean>(),
  reviewReason: Annotation<string | undefined>(),
  lastOutput: Annotation<string | undefined>(),
  metadata: Annotation<Record<string, unknown>>(),
});

type WorkflowNodeState = typeof WorkflowAnnotation.State;

/** 单次会话内流式输出钩子（多 Agent 时每轮 run_task 结束各触发一次 onAgentStreamEnd） */
export type SessionStreamHooks = {
  onChunk: (agentName: string, delta: string) => void;
  onAgentStreamEnd: (agentName: string, fullContent: string) => void;
};

function createRunTaskNode(
  agentRouter: AgentRouter,
  conversationHistoryService: ConversationHistoryService,
  streamHooksBySession: Map<string, SessionStreamHooks>,
  cotWriter: CotWriterService,
) {
  let stepCounter = 0;
  return async (state: WorkflowNodeState) => {
    logger.log(`[LangGraph] run_task: currentAgent=${state.currentAgent}`);
    if (!state.currentAgent) {
      logger.log(`[LangGraph] run_task: no currentAgent, skipping`);
      return { ...state, hasError: true, errorMessage: 'No agent selected' };
    }

    const agent = agentRouter.getAgentByName(state.currentAgent);
    if (!agent) {
      logger.log(`[LangGraph] run_task: agent not found: ${state.currentAgent}`);
      return { ...state, hasError: true, errorMessage: `Agent not found: ${state.currentAgent}`, nextAgent: null };
    }

    const userMessage = state.messages.at(-1)?.content || '';
    const plan = state.currentPlan || userMessage;
    const historyContext = await conversationHistoryService.getContext(state.sessionId, agent.id);
    const conversationHistory = historyContext.messages.map((m, idx) => ({
      id: `msg_${idx}`,
      sessionId: state.sessionId,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      agentId: m.agentId,
      agentName: m.agentName,
      timestamp: m.timestamp,
      createdAt: new Date(m.timestamp),
    }));

    const context = {
      sessionId: state.sessionId,
      conversationHistory,
    };

    const hooks = streamHooksBySession.get(state.sessionId);
    const reasoningSteps: ReasoningStep[] = [];

    try {
      logger.log(`[LangGraph] run_task: calling LLM with message: ${userMessage.substring(0, 50)}...`);

      const useReAct = state.metadata.useReAct !== false;

      let fullContent = '';
      let cleanContent = '';
      let handoffAgent: string | null = null;

      if (useReAct && 'executeWithReAct' in agent) {
        logger.log(`[LangGraph] run_task: using ReAct mode for ${state.currentAgent}`);

        let doneContent: string | null = null;

        for await (const event of (agent as any).executeWithReAct(userMessage, context, {
          maxSteps: (state.metadata.reactMaxSteps as number) ?? 10,
        }) as AsyncGenerator<ReActStreamEvent>) {
          switch (event.type) {
            case 'text_delta':
              fullContent += event.text;
              hooks?.onChunk(state.currentAgent!, event.text);
              break;
            case 'done':
              doneContent = event.content;
              break;
            case 'handoff':
              handoffAgent = event.agentName;
              break;
            case 'error':
              logger.error(`[LangGraph] run_task: ReAct error event: ${event.message}`);
              break;
          }
        }

        cleanContent = doneContent ?? fullContent;
      } else {
        logger.log(`[LangGraph] run_task: using standard mode for ${state.currentAgent}`);
        for await (const chunk of agent.streamGenerate(userMessage, context)) {
          fullContent += chunk;
          hooks?.onChunk(state.currentAgent!, chunk);
        }

        cleanContent = stripSpecialTags(fullContent);
        const parsed = parseAgentOutput(fullContent);
        handoffAgent = parsed.nextAgent;
      }

      logger.log(`[LangGraph] run_task: LLM response received, length=${fullContent.length}`);

      stepCounter++;
      reasoningSteps.push({
        id: `step_${stepCounter}`,
        thought: fullContent,
        toolCall: null,
        observation: '',
        isDone: false,
      });

      await conversationHistoryService.append(state.sessionId, {
        role: 'assistant',
        content: cleanContent,
        agentId: agent.id,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      });

      hooks?.onAgentStreamEnd(state.currentAgent!, cleanContent);

      let lastOutput = fullContent;
      if (handoffAgent && !lastOutput.includes('<handoff_agent>')) {
        lastOutput += `<handoff_agent>${handoffAgent}</handoff_agent>`;
      }

      await cotWriter.writeAgentThinking(
        state.sessionId,
        agent.id,
        agent.name,
        plan,
        reasoningSteps,
        handoffAgent || undefined,
      );

      return {
        ...state,
        hasError: false,
        errorMessage: undefined,
        lastOutput,
        reasoningSteps,
        currentPlan: plan,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.log(`[LangGraph] run_task: error=${errorMsg}`);
      return { ...state, hasError: true, errorMessage: errorMsg };
    }
  };
}

export function buildWorkflowGraph(
  agentRouter: AgentRouter,
  conversationHistoryService: ConversationHistoryService,
  streamHooksBySession: Map<string, SessionStreamHooks>,
  cotWriter: CotWriterService,
) {
  const graph = new StateGraph(WorkflowAnnotation)
    .addNode(WORKFLOW_NODES.HYDRATE, async (state) => {
      logger.log(`[LangGraph] hydrate_session_state: sessionId=${state.sessionId}`);
      return { ...state };
    })
    .addNode(WORKFLOW_NODES.ROUTE, async (state) => {
      const mention = parseMention(state.messages.at(-1)?.content || '');
      const nextAgent = mention || (state.metadata.mentionedAgents as string[])?.[0] || 'Claude';
      const userMessage = state.messages.at(-1)?.content || '';
      logger.log(`[LangGraph] route_message: resolved agent=${nextAgent}`);
      return { ...state, nextAgent, currentAgent: nextAgent, currentPlan: userMessage };
    })
    .addNode(
      WORKFLOW_NODES.RUN_TASK,
      createRunTaskNode(agentRouter, conversationHistoryService, streamHooksBySession, cotWriter),
    )
    .addNode(WORKFLOW_NODES.CHECK_OUTPUT, async (state) => {
      const output = state.lastOutput || '';
      const parsed = parseAgentOutput(output);

      // 自我交接：Agent 将任务交还给自己，视为任务完成
      let nextAgent = parsed.nextAgent;
      if (nextAgent && nextAgent === state.currentAgent) {
        logger.log(`[LangGraph] check_output: self-handoff detected (${nextAgent}), clearing to null`);
        nextAgent = null;
      }

      logger.log(`[LangGraph] check_output: needsReview=${parsed.needsReview}, nextAgent=${nextAgent}`);
      return { ...state, needsReview: parsed.needsReview, nextAgent, lastOutput: parsed.cleanOutput };
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
      if (state.nextAgent && state.nextAgent !== state.currentAgent) {
        logger.log(`[LangGraph] condition: nextAgent=${state.nextAgent} → route_to_next_agent`);
        return WORKFLOW_NODES.ROUTE_AGENT;
      }
      if (state.nextAgent && state.nextAgent === state.currentAgent) {
        logger.log(`[LangGraph] condition: self-handoff detected (${state.nextAgent}), treating as END`);
      } else {
        logger.log(`[LangGraph] condition: no branch matched → END`);
      }
      return END;
    });

  return graph.compile();
}
