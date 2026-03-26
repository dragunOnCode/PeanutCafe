import { Injectable, Logger } from '@nestjs/common';
import { AgentRouter } from '../gateway/agent-router';
import { CotWriterService } from './chain-of-thought/cot-writer.service';
import { PlannerService } from './agents/planner.service';
import { ReactorService } from './agents/reactor.service';
import { parseMention } from './handoff/mention-parser';
import type { WorkflowState, ReasoningStep } from './state/workflow.state';

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly agentRouter: AgentRouter,
    private readonly cotWriter: CotWriterService,
    private readonly planner: PlannerService,
    private readonly reactor: ReactorService,
  ) {}

  async executeWorkflow(sessionId: string, userMessage: string, mentionedAgents: string[]): Promise<void> {
    let state: WorkflowState = {
      sessionId,
      messages: [],
      pendingTasks: [],
      completedTasks: [],
      currentAgent: null,
      nextAgent: null,
      isComplete: false,
      chainOfThought: [],
      metadata: {},
    };

    state = await this.hydrateSessionState(state);
    state = await this.routeMessage(state, userMessage, mentionedAgents);

    while (!state.isComplete && state.currentAgent) {
      state = await this.runTask(state);
    }
  }

  private hydrateSessionState(state: WorkflowState): WorkflowState {
    this.logger.log(`Hydrating session state for ${state.sessionId}`);
    return state;
  }

  private routeMessage(state: WorkflowState, userMessage: string, mentionedAgents: string[]): WorkflowState {
    const mention = parseMention(userMessage);
    const nextAgent = mention || mentionedAgents[0] || 'Claude';

    this.logger.log(`Routing to agent: ${nextAgent}`);

    return {
      ...state,
      nextAgent,
      currentAgent: nextAgent,
    };
  }

  private async runTask(state: WorkflowState): Promise<WorkflowState> {
    const agent = this.agentRouter.getAgentById(state.currentAgent!);

    if (!agent) {
      this.logger.warn(`Agent not found: ${state.currentAgent}`);
      return { ...state, isComplete: true };
    }

    this.logger.log(`Running task for agent: ${agent.name}`);

    const context = { sessionId: state.sessionId };
    const tasks = await this.planner.plan(agent.id, state.messages.at(-1)?.content || '', context);

    const steps: ReasoningStep[] = [];
    for await (const step of this.reactor.execute(tasks[0], context)) {
      steps.push(step);
    }

    let fullOutput = '';
    for await (const chunk of agent.streamGenerate('', context)) {
      fullOutput += chunk;
    }

    const handoffMention = parseMention(fullOutput);

    await this.cotWriter.writeAgentThinking(
      state.sessionId,
      agent.id,
      agent.name,
      tasks.map((t) => t.description).join('\n'),
      steps,
      handoffMention ? `@${handoffMention}` : undefined,
    );

    const nextAgent = handoffMention;

    return {
      ...state,
      completedTasks: [...state.completedTasks, ...tasks],
      nextAgent,
      currentAgent: nextAgent,
      isComplete: !nextAgent,
    };
  }
}
