import { SessionTurn } from '../../common/types';

/**
 * 内部消息格式，`name` 字段与 OpenAI Chat Completions API 的 name 语义一致，
 * 用于标识多 Agent 会话中每条 assistant 消息的发言方。
 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; name?: string; content: string };

/**
 * system + 近期会话历史。用户输入由网关先写入短期记忆，再通过 {AgentContext.conversationHistory} 传入，此处不再拼接 prompt。
 */
export function buildChatMessages(
  systemPrompt: string,
  conversationHistory: SessionTurn[] | undefined,
  options?: { maxRecent?: number },
): ChatMessage[] {
  const maxRecent = options?.maxRecent ?? 10;
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  if (conversationHistory?.length) {
    for (const msg of conversationHistory.slice(-maxRecent)) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        name: msg.role === 'assistant' ? msg.agentName : undefined,
        content: msg.content,
      });
    }
  }

  return messages;
}
