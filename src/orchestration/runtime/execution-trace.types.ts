import type { HandoffDirective } from './handoff.directive';

export interface ExecutionTraceStep {
  id: string;
  thought: string | null;
  observation: string;
  toolName?: string;
}

export interface ExecutionTrace {
  runId: string;
  sessionId: string;
  agentName: string;
  inputSnapshot: string;
  rawOutput: string;
  cleanOutput: string;
  handoff: HandoffDirective | null;
  startedAt: Date;
  endedAt: Date;
  steps: ExecutionTraceStep[];
}
