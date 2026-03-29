import { Injectable, Logger } from '@nestjs/common';
import { AgentRouter } from '../gateway/agent-router';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import { ConversationHistoryService } from '../memory/services/conversation-history.service';
import type { WorkflowState, ReasoningStep } from './state/workflow.state';
import { buildWorkflowGraph, SessionStreamHooks } from './graph/workflow.graph';

/**
 * WorkflowEvent - 工作流事件类型
 * 用于 WebSocket 转发给前端
 */
export type WorkflowEvent =
  | { type: 'task_start'; agentName: string; task: string }
  | { type: 'task_complete'; output: string }
  | { type: 'chunk'; agentName: string; delta: string }
  /** 单次 run_task（单个 Agent 一轮 LLM 输出）结束；交接下一个 Agent 前会先收到本条 */
  | { type: 'agent_stream_end'; agentName: string; fullContent: string }
  | { type: 'needs_review'; reason: string }
  | { type: 'needs_decision'; error?: string }
  | { type: 'handoff'; from: string; to: string }
  | { type: 'complete'; finalOutput: string; agentName: string };

/**
 * 简单的异步队列：支持多生产者（push）和单消费者（AsyncIterator）并发使用。
 * 生产者在图执行线程里调用 push / end / fail；
 * 消费者在 streamExecute 的 for-await 里逐个读出事件。
 */
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
    for (const w of this.waiters) w();
    this.waiters.length = 0;
  }

  fail(error: Error): void {
    this.err = error;
    this.done = true;
    for (const w of this.waiters) w();
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
      await new Promise<void>((r) => this.waiters.push(r));
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
    private readonly conversationHistoryService: ConversationHistoryService,
  ) {}

  private getGraph(): ReturnType<typeof buildWorkflowGraph> {
    if (!this.compiledGraph) {
      this.compiledGraph = buildWorkflowGraph(
        this.agentRouter,
        this.conversationHistoryService,
        this.sessionStreamHooks,
      );
    }
    return this.compiledGraph;
  }

  /**
   * 异步流式执行工作流。
   * 使用 AsyncQueue 将图内部产生的 chunk 事件与图节点完成事件合并，
   * 实现真正的实时流式输出。
   */
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

    // 在后台并发运行图，图节点产生的 chunk 通过 chunkCallbacks 推入队列；
    // 图节点完成后产生的 WorkflowEvent 也推入同一队列。
    void (async () => {
      try {
        const graphStream = await graph.stream(state);
        for await (const step of graphStream) {
          const stepState = Object.values(step)[0] as Partial<WorkflowState>;
          state = { ...state, ...stepState };

          this.logger.log(`[OrchestrationService] Graph step: node=${Object.keys(step)[0]}`);

          const event = this.stateToEvent(state);
          if (event) {
            this.logger.log(`[OrchestrationService] Emitting event: type=${event.type}`);
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

  /**
   * 同步执行工作流（供 ChatGateway 使用）
   * 内部调用 streamExecute 并消费所有事件
   */
  async executeWorkflow(sessionId: string, userMessage: string, mentionedAgents: string[]): Promise<void> {
    this.logger.log(`[OrchestrationService] executeWorkflow started: sessionId=${sessionId}`);

    for await (const _ of this.streamExecute(sessionId, userMessage, mentionedAgents)) {
    }

    this.logger.log(`[OrchestrationService] executeWorkflow completed: sessionId=${sessionId}`);
  }

  /**
   * 创建初始工作流状态
   */
  private createInitialState(sessionId: string, userMessage: string, mentionedAgents: string[]): WorkflowState {
    return {
      sessionId,
      messages: [
        {
          id: '1',
          role: 'user',
          content: userMessage,
          timestamp: new Date().toISOString(),
        },
      ],
      pendingTasks: [],
      completedTasks: [],
      currentAgent: null,
      nextAgent: null,
      isComplete: false,
      chainOfThought: [],
      hasError: false,
      needsReview: false,
      metadata: { mentionedAgents },
    };
  }

  /**
   * 将 WorkflowState 转换为 WorkflowEvent
   * 根据状态变化产生相应事件
   */
  private stateToEvent(state: WorkflowState): WorkflowEvent | null {
    if (state.currentAgent && state.nextAgent === state.currentAgent && !state.lastOutput) {
      return { type: 'task_start', agentName: state.currentAgent, task: '任务执行中' };
    }

    if (state.lastOutput && !state.needsReview && !state.hasError && !state.nextAgent) {
      return { type: 'complete', finalOutput: state.lastOutput, agentName: state.currentAgent ?? '' };
    }

    if (state.needsReview) {
      return { type: 'needs_review', reason: state.reviewReason || '任务需要人工审核' };
    }

    if (state.hasError) {
      return { type: 'needs_decision', error: state.errorMessage };
    }

    if (state.nextAgent && state.currentAgent && state.nextAgent !== state.currentAgent) {
      return { type: 'handoff', from: state.currentAgent, to: state.nextAgent };
    }

    return null;
  }

  getCompiledGraph() {
    return this.getGraph();
  }
}
