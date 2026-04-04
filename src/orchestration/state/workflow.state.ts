import type { AgentRunResult } from '../runtime/agent-run-result';
import type { HandoffDirective } from '../runtime/handoff.directive';
import type { WorkflowRunConfig } from '../runtime/workflow-run-config';

export type TaskStatus = 'pending' | 'in_progress' | 'awaiting_review' | 'completed' | 'failed';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  result?: string;
  reasoning?: string;
}

export interface ReasoningStep {
  id: string;
  thought: string | null;
  toolCall: { name: string; args: Record<string, unknown> } | null;
  observation: string;
  isDone: boolean;
  handoffAgent?: string;
}

export type WorkflowStatus = 'routing' | 'running' | 'handoff' | 'awaiting_review' | 'completed' | 'failed';

export interface WorkflowControlState {
  needsReview: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export interface WorkflowState {
  sessionId: string;
  entryMessageId: string;
  activeAgent: string | null;
  pendingHandoff: HandoffDirective | null;
  planInput: string;
  lastAgentResult: AgentRunResult | null;
  control: WorkflowControlState;
  status: WorkflowStatus;
  config: WorkflowRunConfig;
  reviewReason?: string;
  reasoningSteps: ReasoningStep[];
}
