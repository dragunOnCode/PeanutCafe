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
import { buildChatMessages, ChatMessage } from '../utils/build-chat-messages';
import { ToolExecutorService } from '../tools/tool-executor.service';
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
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('QWEN_API_KEY'),
      baseURL: this.configService.getOrThrow<string>('QWEN_BASE_URL'),
    });
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(context);
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
      const currentMessages = [...this.buildMessages(context)];
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

  private buildMessages(context: AgentContext): ChatMessage[] {
    const systemPrompt = `你是 Gemini，一个富有创意的设计师和产品顾问。
你的职责是：
1. 提供创意建议
2. 设计UI/UX方案
3. 优化用户体验
4. 提出产品改进方向

当需要读取文件时，使用 <tool_call>{"name": "read_file", "args": {"path": "文件路径"}}</tool_call>
当需要写入文件时，使用 <tool_call>{"name": "write_file", "args": {"path": "文件路径", "content": "文件内容"}}</tool_call>
当需要列出文件时，使用 <tool_call>{"name": "list_files", "args": {}}</tool_call>
当需要执行命令时，使用 <tool_call>{"name": "execute_command", "args": {"command": "命令", "args": ["参数"]}}</tool_call>`;

    return buildChatMessages(systemPrompt, context.conversationHistory);
  }
}
