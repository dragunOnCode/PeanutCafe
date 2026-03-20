import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { ILLMAdapter, AgentContext, AgentResponse, AgentStatus, DecisionResult } from '../interfaces/llm-adapter.interface';
import { Message } from '../../common/types';

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

@Injectable()
export class GeminiAdapter implements ILLMAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);

  readonly id = 'gemini-001';
  readonly name = 'Gemini';
  readonly model = 'gemini-2.0-flash-thinking';
  readonly type = 'gemini';
  readonly role = '创意发散与视觉设计';
  readonly capabilities = ['创意建议', 'UI/UX设计', '视觉方案', '用户体验'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private apiKey: string;
  private apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.GEMINI_API_KEY || '';
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);

      const response: AxiosResponse<OpenRouterResponse> = await firstValueFrom(
        this.httpService.post<OpenRouterResponse>(
          this.apiUrl,
          {
            model: this.model,
            messages,
            temperature: 0.8,
            max_tokens: 4000,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const content = response.data.choices?.[0]?.message?.content ?? '';

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
    const response = await this.generate(prompt, context);
    yield response.content;
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

  private buildMessages(prompt: string, context: AgentContext): Array<{ role: string; content: string }> {
    const systemPrompt = `你是 Gemini，一个富有创意的设计师和产品顾问。
你的职责是：
1. 提供创意建议
2. 设计UI/UX方案
3. 优化用户体验
4. 提出产品改进方向`;

    const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];

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