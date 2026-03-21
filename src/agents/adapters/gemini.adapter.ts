import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ILLMAdapter,
  AgentContext,
  AgentResponse,
  AgentStatus,
  DecisionResult,
} from '../interfaces/llm-adapter.interface';
import { Message } from '../../common/types';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
    } | null;
  }>;
};

@Injectable()
export class GeminiAdapter implements ILLMAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);

  readonly id = 'gemini-001';
  readonly name = 'Gemini';
  readonly model = 'qwen3-32b';
  readonly type = 'gemini';
  readonly role = '创意发散与视觉设计';
  readonly capabilities = ['创意建议', 'UI/UX设计', '视觉方案', '用户体验'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('QWEN_API_KEY'),
      baseURL: this.configService.getOrThrow<string>('QWEN_BASE_URL'),
    });
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);
      this.logger.log(`Gemini messages history: ${JSON.stringify(messages)}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as ChatMessage[],
        temperature: 0.8,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content ?? '';
      this.logger.log(`Gemini generate response: ${content}`);

      return {
        content,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Gemini generate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
  }

  async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);
      this.logger.log(`Gemini stream messages history: ${JSON.stringify(messages)}`);

      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as ChatMessage[],
        temperature: 0.8,
        max_tokens: 4000,
        stream: true,
      });

      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        const content = chunk.choices?.[0]?.delta?.content ?? '';
        if (content) {
          yield content;
        }
      }
    } catch (error) {
      this.logger.error(`Gemini streamGenerate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
  }

  async shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult> {
    return { should: true, reason: 'Gemini adapter always responds', priority: 'medium' };
  }

  async healthCheck(): Promise<boolean> {
    return this.status !== AgentStatus.ERROR;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildMessages(prompt: string, context: AgentContext): ChatMessage[] {
    const systemPrompt = `你是 Gemini，一个富有创意的设计师和产品顾问。
你的职责是：
1. 提供创意建议
2. 设计UI/UX方案
3. 优化用户体验
4. 提出产品改进方向`;

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    if (context.conversationHistory?.length) {
      const recentMessages = context.conversationHistory.slice(-10);
      for (const msg of recentMessages) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    messages.push({ role: 'user', content: prompt });
    return messages;
  }
}
