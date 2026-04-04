import type { HandoffDirective } from './handoff.directive';

export interface AgentRunResult {
  agentName: string;
  rawOutput: string;
  cleanOutput: string;
  needsReview: boolean;
  handoff: HandoffDirective | null;
  errorMessage?: string;
}
