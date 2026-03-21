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
export class CodexAdapter implements ILLMAdapter {
  private readonly logger = new Logger(CodexAdapter.name);

  readonly id = 'codex-001';
  readonly name = 'Codex';
  readonly model = 'glm-4.5-air';
  readonly type = 'codex';
  readonly role = '代码审查与质量把控';
  readonly capabilities = ['代码审查', '测试建议', '性能优化', '安全检测'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('GLM_API_KEY'),
      baseURL: this.configService.getOrThrow<string>('GLM_BASE_URL'),
    });
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);
      this.logger.log(`Codex messages history: ${JSON.stringify(messages)}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as ChatMessage[],
        temperature: 0.7,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content ?? '';
      this.logger.log(`Codex generate response: ${content}`);

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
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(prompt, context);
      this.logger.log(`Codex stream messages history: ${JSON.stringify(messages)}`);

      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as ChatMessage[],
        temperature: 0.7,
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
      this.logger.error(`Codex streamGenerate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
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

  private buildMessages(prompt: string, context: AgentContext): ChatMessage[] {
    const systemPrompt = `你是 Codex，一个专业的代码审查专家。
你的职责是：
1. 审查代码质量
2. 发现潜在问题
3. 提供优化建议
4. 确保代码安全`;

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
