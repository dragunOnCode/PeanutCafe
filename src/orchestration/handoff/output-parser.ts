// src/orchestration/handoff/output-parser.ts
// 解析 Agent 输出中的特殊标签，用于工作流条件路由

export interface ParseResult {
  needsReview: boolean; // 是否需要人工审核
  nextAgent: string | null; // 下一个处理的 Agent
  hasError: boolean; // 是否有错误
  cleanOutput: string; // 清理后的输出
}

/**
 * 剥离输出中所有特殊路由标签，返回可安全展示/持久化的纯净文本。
 * 在写入对话历史前调用，防止路由标签污染后续 Agent 的上下文。
 */
export function stripSpecialTags(output: string): string {
  return output
    .replace(/<NEED_REVIEW>/gi, '')
    .replace(/<handoff_agent>[\s\S]*?<\/handoff_agent>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
}

/**
 * 解析 Agent 输出文本，提取特殊标签
 * 支持的标签：
 * - <NEED_REVIEW> - 请求人工审核
 * - <handoff_agent>AgentName</handoff_agent> - Agent 间交接
 */
export function parseAgentOutput(output: string): ParseResult {
  const needsReview = /<NEED_REVIEW>/i.test(output);

  // 匹配 <handoff_agent>AgentName</handoff_agent>，取最后一个（多次交接时以末尾为准）
  const handoffMatches = [...output.matchAll(/<handoff_agent>\s*(\w+)\s*<\/handoff_agent>/gi)];
  const nextAgent = handoffMatches.length > 0 ? handoffMatches[handoffMatches.length - 1][1] : null;

  return {
    needsReview,
    nextAgent,
    hasError: false,
    cleanOutput: stripSpecialTags(output),
  };
}
