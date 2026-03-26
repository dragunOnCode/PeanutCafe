// src/orchestration/handoff/output-parser.ts
// 解析 Agent 输出中的特殊标签，用于工作流条件路由

export interface ParseResult {
  needsReview: boolean; // 是否需要人工审核
  nextAgent: string | null; // 下一个处理的 Agent
  hasError: boolean; // 是否有错误
  cleanOutput: string; // 清理后的输出
}

/**
 * 解析 Agent 输出文本，提取特殊标签
 * 支持的标签：
 * - <NEED_REVIEW> - 请求人工审核
 * - @AgentName - Agent 间交接
 */
export function parseAgentOutput(output: string): ParseResult {
  const needsReview = /<NEED_REVIEW>/i.test(output);
  const handoffMatches = output.match(/@(\w+)/g);
  const nextAgent = handoffMatches ? handoffMatches[handoffMatches.length - 1].slice(1) : null;

  // 清理输出中的特殊标签
  const cleanOutput = output
    .replace(/<NEED_REVIEW>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();

  return {
    needsReview,
    nextAgent,
    hasError: false,
    cleanOutput,
  };
}
