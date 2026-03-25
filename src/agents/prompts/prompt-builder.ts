// src/agents/prompts/prompt-builder.ts
import { Injectable } from '@nestjs/common';
import { PromptTemplateService } from './prompt-template.service';
import { Message } from '../../common/types';
import { ChatMessage } from '../utils/build-chat-messages';

interface AgentContext {
  sessionId: string;
  conversationHistory?: Message[];
  sharedMemory?: Record<string, unknown>;
}

interface PromptAgentConfig {
  id: string;
  name: string;
  type: string;
  role: string;
  capabilities: string[];
  model: string;
}

@Injectable()
export class PromptBuilder {
  constructor(private readonly templateService: PromptTemplateService) {}

  async buildSystemPrompt(agent: PromptAgentConfig, context: AgentContext): Promise<string> {
    const vars = {
      name: agent.name,
      role: agent.role,
      model: agent.model,
      sessionId: context.sessionId,
      capabilities: agent.capabilities,
    };

    return this.templateService.buildPrompt(context.sessionId, agent.type, vars);
  }

  async buildMessages(agent: PromptAgentConfig, context: AgentContext): Promise<ChatMessage[]> {
    const systemPrompt = await this.buildSystemPrompt(agent, context);

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    if (context.conversationHistory?.length) {
      const recentHistory = context.conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    return messages;
  }
}
