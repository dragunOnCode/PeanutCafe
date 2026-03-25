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

  constructor(
    private readonly configService: ConfigService,
    private readonly toolExecutorService: ToolExecutorService,
    private readonly promptBuilder: PromptBuilder,
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('GLM_API_KEY'),
      baseURL: this.configService.getOrThrow<string>('GLM_BASE_URL'),
    });
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = await this.buildMessages(context);
      this.logger.log(`Codex messages history: ${JSON.stringify(messages)}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
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

    this.toolExecutorService.registerSessionTools(context.sessionId);

    try {
      const currentMessages = [...(await this.buildMessages(context))];
      let fullResponse = '';

      while (true) {
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: currentMessages,
          temperature: 0.7,
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

        const toolCalls = this.toolExecutorService.parseToolCalls(buffer);

        if (toolCalls.length === 0) {
          break;
        }

        currentMessages.push({
          role: 'assistant',
          content: buffer,
        });

        const toolResults = await this.toolExecutorService.executeAllToolCalls(toolCalls);

        for (const result of toolResults) {
          currentMessages.push({
            role: 'user',
            content: `[TOOL_RESULT] ${result.toolName}: ${result.success ? result.result : result.error}`,
          });
        }

        buffer = '';
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
