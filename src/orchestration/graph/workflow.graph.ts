import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import type { WorkflowState } from '../state/workflow.state';
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

type NodeFunc = (state: typeof WorkflowAnnotation.State) => Promise<Partial<typeof WorkflowAnnotation.State>>;

function buildWorkflowGraph() {
  const graph = new StateGraph(WorkflowAnnotation)
    .addNode(WORKFLOW_NODES.HYDRATE, async (state) => {
      console.log(`[LangGraph] hydrate_session_state: sessionId=${state.sessionId}`);
      return { ...state };
    })
    .addNode(WORKFLOW_NODES.ROUTE, async (state) => {
      const mention = parseMention(state.messages.at(-1)?.content || '');
      const nextAgent = mention || (state.metadata.mentionedAgents as string[])?.[0] || 'Claude';
      console.log(`[LangGraph] route_message: resolved agent=${nextAgent}`);
      return { ...state, nextAgent, currentAgent: nextAgent };
    })
    .addNode(WORKFLOW_NODES.RUN_TASK, async (state) => {
      console.log(`[LangGraph] run_task: currentAgent=${state.currentAgent}`);
      return { ...state, hasError: false, errorMessage: undefined };
    })
    .addNode(WORKFLOW_NODES.CHECK_OUTPUT, async (state) => {
      const output = state.lastOutput || '';
      const parsed = parseAgentOutput(output);
      console.log(`[LangGraph] check_output: needsReview=${parsed.needsReview}, nextAgent=${parsed.nextAgent}`);
      return {
        ...state,
        needsReview: parsed.needsReview,
        nextAgent: parsed.nextAgent,
        lastOutput: parsed.cleanOutput,
      };
    })
    .addNode(WORKFLOW_NODES.AWAIT_REVIEW, async (state) => {
      console.log(`[LangGraph] await_human_review: waiting for human decision`);
      return { ...state };
    })
    .addNode(WORKFLOW_NODES.ROUTE_AGENT, async (state) => {
      console.log(`[LangGraph] route_to_next_agent: nextAgent=${state.nextAgent}`);
      return { ...state, currentAgent: state.nextAgent };
    })
    .addNode(WORKFLOW_NODES.HANDLE_ERROR, async (state) => {
      console.log(`[LangGraph] handle_error: error=${state.errorMessage}`);
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
        console.log(`[LangGraph] condition: hasError=true → handle_error`);
        return WORKFLOW_NODES.HANDLE_ERROR;
      }
      if (state.needsReview) {
        console.log(`[LangGraph] condition: needsReview=true → await_human_review`);
        return WORKFLOW_NODES.AWAIT_REVIEW;
      }
      if (state.nextAgent) {
        console.log(`[LangGraph] condition: nextAgent=${state.nextAgent} → route_to_next_agent`);
        return WORKFLOW_NODES.ROUTE_AGENT;
      }
      console.log(`[LangGraph] condition: no branch matched → END`);
      return END;
    });

  return graph.compile();
}

export const compiledGraph = buildWorkflowGraph();
