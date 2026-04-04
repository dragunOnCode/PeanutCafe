import type { HandoffDirective } from '../runtime/handoff.directive';

export interface ParseResult {
  needsReview: boolean;
  handoff: HandoffDirective | null;
  cleanOutput: string;
}

export function stripSpecialTags(output: string): string {
  return output
    .replace(/<NEED_REVIEW>/gi, '')
    .replace(/<handoff_agent>[\s\S]*?<\/handoff_agent>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<observation>[\s\S]*?<\/observation>/gi, '')
    .replace(/<done>[\s\S]*?<\/done>/gi, '')
    .trim();
}

export function parseAgentOutput(output: string): ParseResult {
  const needsReview = /<NEED_REVIEW>/i.test(output);
  const handoffMatches = [...output.matchAll(/<handoff_agent>\s*(\w+)\s*<\/handoff_agent>/gi)];
  const handoff =
    handoffMatches.length > 0
      ? {
          targetAgent: handoffMatches[handoffMatches.length - 1][1],
        }
      : null;

  return {
    needsReview,
    handoff,
    cleanOutput: stripSpecialTags(output),
  };
}
