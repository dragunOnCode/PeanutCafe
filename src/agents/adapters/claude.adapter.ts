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
export class ClaudeAdapter implements ILLMAdapter {
  private readonly logger = new Logger(ClaudeAdapter.name);

  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'MiniMax-M2.5';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType: 'http' = 'http';

  private status: AgentStatus = AgentStatus.ONLINE;
  private client: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly toolExecutorService: ToolExecutorService,
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('MINIMAX_API_KEY'),
      baseURL: this.configService.getOrThrow<string>('MINIMAX_BASE_URL'),
    });
    this.logger.log(
      `ClaudeAdapter initialized with model: ${this.model}, baseURL: ${this.configService.getOrThrow<string>('MINIMAX_BASE_URL')}`,
    );
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(context);
      this.logger.log(`Claude messages history: ${JSON.stringify(messages)}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content ?? '';
      this.logger.log(`Claude generate response: ${content}`);

      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

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
    this.status = AgentStatus.BUSY;

    this.toolExecutorService.registerSessionTools(context.sessionId);

    try {
      const currentMessages = [...this.buildMessages(context)];
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
      this.logger.error(`Claude streamGenerate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
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

  private buildMessages(context: AgentContext): ChatMessage[] {
    const systemPrompt = `你是 Claude，一个专业的软件架构师和编码专家。
你的职责是：
1. 设计系统架构
2. 编写高质量代码
3. 提供技术选型建议
4. 进行代码重构

当需要读取文件时，使用 <tool_call>{"name": "read_file", "args": {"path": "文件路径"}}</tool_call>
当需要写入文件时，使用 <tool_call>{"name": "write_file", "args": {"path": "文件路径", "content": "文件内容"}}</tool_call>
当需要列出文件时，使用 <tool_call>{"name": "list_files", "args": {}}</tool_call>
当需要执行命令时，使用 <tool_call>{"name": "execute_command", "args": {"command": "命令", "args": ["参数"]}}</tool_call>`;

    return buildChatMessages(systemPrompt, context.conversationHistory);
  }
}
