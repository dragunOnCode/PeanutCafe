import { Message } from '../../common/types';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * system + 近期会话历史。用户输入由网关先写入短期记忆，再通过 {@link AgentContext.conversationHistory} 传入，此处不再拼接 prompt。
 */
export function buildChatMessages(
  systemPrompt: string,
  conversationHistory: Message[] | undefined,
  options?: { maxRecent?: number },
): ChatMessage[] {
  const maxRecent = options?.maxRecent ?? 10;
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  if (conversationHistory?.length) {
    for (const msg of conversationHistory.slice(-maxRecent)) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
  }

  return messages;
}
