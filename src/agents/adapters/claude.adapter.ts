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
export class ClaudeAdapter implements ILLMAdapter {
  private readonly logger = new Logger(ClaudeAdapter.name);

  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'anthropic/claude-3-sonnet';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private apiKey: string;
  private apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(private readonly httpService: HttpService) {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
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
            temperature: 0.7,
            max_tokens: 4000,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://lobster.com',
              'X-Title': 'Lobster Coding Assistant',
            },
          },
        ),
      );

      const content = response.data.choices?.[0]?.message?.content ?? '';
      const usage = response.data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      return {
        content,
        tokenUsage: {
          prompt: usage.prompt_tokens ?? 0,
          completion: usage.completion_tokens ?? 0,
          total: usage.total_tokens ?? 0,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Claude generate error: ${error.message}`);
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
    return { should: true, reason: 'Claude adapter always responds', priority: 'medium' };
  }

  async healthCheck(): Promise<boolean> {
    return this.status !== AgentStatus.ERROR;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildMessages(prompt: string, context: AgentContext): Array<{ role: string; content: string }> {
    const systemPrompt = `你是 Claude，一个专业的软件架构师和编码专家。
你的职责是：
1. 设计系统架构
2. 编写高质量代码
3. 提供技术选型建议
4. 进行代码重构`;

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