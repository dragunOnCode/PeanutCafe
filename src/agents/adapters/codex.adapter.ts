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
export class CodexAdapter implements ILLMAdapter {
  private readonly logger = new Logger(CodexAdapter.name);

  readonly id = 'codex-001';
  readonly name = 'Codex';
  readonly model = 'codex';
  readonly type = 'codex';
  readonly role = '代码审查与质量把控';
  readonly capabilities = ['代码审查', '测试建议', '性能优化', '安全检测'];
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
      this.logger.error(`Codex generate error: ${error.message}`);
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
    return { should: true, reason: 'Codex adapter always responds', priority: 'medium' };
  }

  async healthCheck(): Promise<boolean> {
    return this.status !== AgentStatus.ERROR;
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildMessages(prompt: string, context: AgentContext): Array<{ role: string; content: string }> {
    const systemPrompt = `你是 Codex，一个专业的代码审查专家。
你的职责是：
1. 审查代码质量
2. 发现潜在问题
3. 提供优化建议
4. 确保代码安全`;

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