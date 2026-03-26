export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: string;
}

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
  thought: string;
  action: string;
  observation: string;
}

export interface WorkflowState {
  sessionId: string;
  messages: Message[];
  pendingTasks: Task[];
  completedTasks: Task[];
  currentAgent: string | null;
  nextAgent: string | null;
  isComplete: boolean;
  chainOfThought: string[];
  metadata: Record<string, unknown>;
  hasError: boolean;
  errorMessage?: string;
  needsReview: boolean;
  reviewReason?: string;
  lastOutput?: string;
}
