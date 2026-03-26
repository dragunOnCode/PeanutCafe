import { Injectable, Logger } from '@nestjs/common';
import { AgentRouter } from '../gateway/agent-router';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import type { WorkflowState, ReasoningStep } from './state/workflow.state';
import { compiledGraph, WORKFLOW_NODES } from './graph/workflow.graph';

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

  constructor(
    private readonly agentRouter: AgentRouter,
    private readonly cotWriter: CotWriterService,
    private readonly planner: PlannerService,
    private readonly reactor: ReactorService,
  ) {}

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

    // 使用 compiledGraph.stream() 异步迭代执行
    const graphStream = await compiledGraph.stream(state);
    for await (const step of graphStream) {
      // 合并步骤状态到当前状态
      const stepState = Object.values(step)[0] as Partial<WorkflowState>;
      state = { ...state, ...stepState };

      this.logger.log(`[OrchestrationService] Graph step: node=${Object.keys(step)[0]}`);

      // 将状态转换为事件
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
      // 消费流中的所有事件，不做特殊处理
      // 事件会通过 ChatGateway 的 WebSocket 转发给前端
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
    // 任务开始
    if (state.currentAgent && state.nextAgent === state.currentAgent && !state.lastOutput) {
      return { type: 'task_start', agentName: state.currentAgent, task: '任务执行中' };
    }

    // 工作流完成
    if (state.lastOutput && !state.needsReview && !state.hasError && !state.nextAgent) {
      return { type: 'complete', finalOutput: state.lastOutput };
    }

    // 需要人工审核
    if (state.needsReview) {
      return { type: 'needs_review', reason: state.reviewReason || '任务需要人工审核' };
    }

    // 需要决策（错误恢复）
    if (state.hasError) {
      return { type: 'needs_decision', error: state.errorMessage };
    }

    // Agent 交接
    if (state.nextAgent && state.currentAgent && state.nextAgent !== state.currentAgent) {
      return { type: 'handoff', from: state.currentAgent, to: state.nextAgent };
    }

    return null;
  }

  // 供测试使用的 getter
  getCompiledGraph() {
    return compiledGraph;
  }
}
