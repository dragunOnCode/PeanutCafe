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
import { ChatMessage } from '../utils/build-chat-messages';
import { ToolExecutorService } from '../tools/tool-executor.service';
import { PromptBuilder } from '../prompts/prompt-builder';
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

  constructor(
    private readonly configService: ConfigService,
    private readonly toolExecutorService: ToolExecutorService,
    private readonly promptBuilder: PromptBuilder,
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('QWEN_API_KEY'),
      baseURL: this.configService.getOrThrow<string>('QWEN_BASE_URL'),
    });
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = await this.buildMessages(context);
      this.logger.log(`Gemini messages history: ${JSON.stringify(messages)}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
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

    this.toolExecutorService.registerSessionTools(context.sessionId);

    try {
      const currentMessages = [...(await this.buildMessages(context))];
      let fullResponse = '';

      while (true) {
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: currentMessages,
          temperature: 0.8,
          max_tokens: 4000,
          stream: true,
        });

        let buffer = '';

        for await (const chunk of stream as AsyncIterable<StreamChunk>) {
          const content = chunk.choices?.[0]?.delta?.content ?? '';
          if (content) {
            buffer += content;
            fullResponse += content;
            yield content;
          }
        }

        this.logger.log(`Gemini response buffer: ${buffer}`);

        const toolCalls = this.toolExecutorService.parseToolCalls(buffer);

        if (toolCalls.length === 0) {
          break;
        }

        this.logger.log(`Gemini tool calls: ${JSON.stringify(toolCalls)}`);

        currentMessages.push({
          role: 'assistant',
          content: buffer,
        });

        const toolResults = await this.toolExecutorService.executeAllToolCalls(toolCalls);
        this.logger.log(`Gemini tool results: ${JSON.stringify(toolResults)}`);

        for (const result of toolResults) {
          currentMessages.push({
            role: 'user',
            content: `[TOOL_RESULT] ${result.toolName}: ${result.success ? result.result : result.error}`,
          });
        }

        buffer = '';
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

  private async buildMessages(context: AgentContext): Promise<ChatMessage[]> {
    return this.promptBuilder.buildMessages(
      {
        id: this.id,
        name: this.name,
        type: this.type,
        model: this.model,
        role: this.role,
        capabilities: this.capabilities,
      },
      context as any,
    );
  }
}
