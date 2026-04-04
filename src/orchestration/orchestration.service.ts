import { Injectable, Logger } from '@nestjs/common';
import { AgentRouter } from '../gateway/agent-router';
import { SessionContextService } from './context/session-context.service';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import type { WorkflowState } from './state/workflow.state';
import { buildWorkflowGraph, SessionStreamHooks } from './graph/workflow.graph';

export type WorkflowEvent =
  | { type: 'task_start'; agentName: string; task: string }
  | { type: 'task_complete'; output: string }
  | { type: 'chunk'; agentName: string; delta: string }
  | { type: 'agent_stream_end'; agentName: string; fullContent: string }
  | { type: 'needs_review'; reason: string }
  | { type: 'needs_decision'; error?: string }
  | { type: 'handoff'; from: string; to: string }
  | { type: 'complete'; finalOutput: string; agentName: string };

class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private done = false;
  private err: Error | null = null;

  push(item: T): void {
    this.items.push(item);
    this.waiters.shift()?.();
  }

  end(): void {
    this.done = true;
    for (const waiter of this.waiters) waiter();
    this.waiters.length = 0;
  }

  fail(error: Error): void {
    this.err = error;
    this.done = true;
    for (const waiter of this.waiters) waiter();
    this.waiters.length = 0;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      while (this.items.length > 0) {
        yield this.items.shift()!;
      }
      if (this.done) {
        if (this.err) throw this.err;
        return;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);
  private readonly sessionStreamHooks = new Map<string, SessionStreamHooks>();
  private compiledGraph: ReturnType<typeof buildWorkflowGraph> | null = null;

  constructor(
    private readonly agentRouter: AgentRouter,
    private readonly cotWriter: CotWriterService,
    private readonly planner: PlannerService,
    private readonly reactor: ReactorService,
    private readonly sessionContextService: SessionContextService,
  ) {}

  private getGraph(): ReturnType<typeof buildWorkflowGraph> {
    if (!this.compiledGraph) {
      this.compiledGraph = buildWorkflowGraph(
        this.agentRouter,
        this.sessionContextService,
        this.sessionStreamHooks,
        this.cotWriter,
      );
    }
    return this.compiledGraph;
  }

  async *streamExecute(
    sessionId: string,
    userMessage: string,
    mentionedAgents: string[],
  ): AsyncGenerator<WorkflowEvent> {
    this.logger.log(
      `[OrchestrationService] streamExecute: sessionId=${sessionId}, message=${userMessage.substring(0, 50)}...`,
    );

    const queue = new AsyncQueue<WorkflowEvent>();

    this.sessionStreamHooks.set(sessionId, {
      onChunk: (agentName, delta) => {
        queue.push({ type: 'chunk', agentName, delta });
      },
      onAgentStreamEnd: (agentName, fullContent) => {
        queue.push({ type: 'agent_stream_end', agentName, fullContent });
      },
    });

    let state = this.createInitialState(sessionId, userMessage, mentionedAgents);
    const graph = this.getGraph();

    void (async () => {
      try {
        const graphStream = await graph.stream(state);
        for await (const step of graphStream) {
          const stepState = Object.values(step)[0] as Partial<WorkflowState>;
          state = { ...state, ...stepState };
          const event = this.stateToEvent(state);
          if (event) {
            queue.push(event);
          }
        }
        queue.end();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`[OrchestrationService] Graph error: ${err.message}`);
        queue.fail(err);
      } finally {
        this.sessionStreamHooks.delete(sessionId);
      }
    })();

    for await (const event of queue) {
      yield event;
    }
  }

  async executeWorkflow(sessionId: string, userMessage: string, mentionedAgents: string[]): Promise<void> {
    this.logger.log(`[OrchestrationService] executeWorkflow started: sessionId=${sessionId}`);
    for await (const event of this.streamExecute(sessionId, userMessage, mentionedAgents)) {
      void event;
    }
    this.logger.log(`[OrchestrationService] executeWorkflow completed: sessionId=${sessionId}`);
  }

  private createInitialState(sessionId: string, userMessage: string, mentionedAgents: string[]): WorkflowState {
    return {
      sessionId,
      entryMessageId: 'msg-1',
      activeAgent: null,
      pendingHandoff: null,
      planInput: userMessage,
      lastAgentResult: null,
      control: {
        needsReview: false,
        hasError: false,
      },
      status: 'routing',
      config: {
        mentionedAgents,
        useReAct: true,
        reactMaxSteps: 10,
      },
      reasoningSteps: [],
    };
  }

  private stateToEvent(state: WorkflowState): WorkflowEvent | null {
    if (state.status === 'running' && state.activeAgent && !state.lastAgentResult) {
      return { type: 'task_start', agentName: state.activeAgent, task: '任务执行中' };
    }
    if (state.status === 'completed' && state.lastAgentResult) {
      return {
        type: 'complete',
        finalOutput: state.lastAgentResult.cleanOutput,
        agentName: state.lastAgentResult.agentName,
      };
    }
    if (state.status === 'awaiting_review' && state.control.needsReview) {
      return { type: 'needs_review', reason: state.reviewReason || '任务需要人工审核' };
    }
    if (state.status === 'failed' && state.control.hasError) {
      return { type: 'needs_decision', error: state.control.errorMessage };
    }
    if (state.status === 'handoff' && state.pendingHandoff && state.activeAgent) {
      return { type: 'handoff', from: state.activeAgent, to: state.pendingHandoff.targetAgent };
    }
    return null;
  }

  getCompiledGraph() {
    return this.getGraph();
  }
}
