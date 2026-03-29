import { Injectable, Logger } from '@nestjs/common';
import { AgentRouter } from '../gateway/agent-router';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import { ConversationHistoryService } from '../memory/services/conversation-history.service';
import type { WorkflowState, ReasoningStep } from './state/workflow.state';
import { buildWorkflowGraph, WORKFLOW_NODES } from './graph/workflow.graph';

/**
 * WorkflowEvent - 工作流事件类型
 * 用于 WebSocket 转发给前端
 */
export type WorkflowEvent =
  | { type: 'task_start'; agentName: string; task: string }
  | { type: 'task_complete'; output: string }
  | { type: 'needs_review'; reason: string }
  | { type: 'needs_decision'; error?: string }
  | { type: 'handoff'; from: string; to: string }
  | { type: 'complete'; finalOutput: string };

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);
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
      this.compiledGraph = buildWorkflowGraph(this.agentRouter, this.conversationHistoryService);
    }
    return this.compiledGraph;
  }

  /**
   * 异步流式执行工作流
   * 产出 WorkflowEvent 供 ChatGateway 通过 WebSocket 转发给前端
   */
  async *streamExecute(
    sessionId: string,
    userMessage: string,
    mentionedAgents: string[],
  ): AsyncGenerator<WorkflowEvent> {
    this.logger.log(
      `[OrchestrationService] streamExecute: sessionId=${sessionId}, message=${userMessage.substring(0, 50)}...`,
    );

    let state = this.createInitialState(sessionId, userMessage, mentionedAgents);

    const graph = this.getGraph();
    const graphStream = await graph.stream(state);
    for await (const step of graphStream) {
      const stepState = Object.values(step)[0] as Partial<WorkflowState>;
      state = { ...state, ...stepState };

      this.logger.log(`[OrchestrationService] Graph step: node=${Object.keys(step)[0]}`);

      const event = this.stateToEvent(state);
      if (event) {
        this.logger.log(`[OrchestrationService] Emitting event: type=${event.type}`);
        yield event;
      }
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
      return { type: 'complete', finalOutput: state.lastOutput };
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
