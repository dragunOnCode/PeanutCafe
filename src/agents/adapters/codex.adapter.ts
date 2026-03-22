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
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('GLM_API_KEY'),
      baseURL: this.configService.getOrThrow<string>('GLM_BASE_URL'),
    });
  }

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    this.status = AgentStatus.BUSY;

    try {
      const messages = this.buildMessages(context);
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

  private buildMessages(context: AgentContext): ChatMessage[] {
    const systemPrompt = `你是 Codex，一个专业的代码审查专家。
你的职责是：
1. 审查代码质量
2. 发现潜在问题
3. 提供优化建议
4. 确保代码安全

当需要读取文件时，使用 <tool_call>{"name": "read_file", "args": {"path": "文件路径"}}</tool_call>
当需要写入文件时，使用 <tool_call>{"name": "write_file", "args": {"path": "文件路径", "content": "文件内容"}}</tool_call>
当需要列出文件时，使用 <tool_call>{"name": "list_files", "args": {}}</tool_call>
当需要执行命令时，使用 <tool_call>{"name": "execute_command", "args": {"command": "命令", "args": ["参数"]}}</tool_call>`;

    return buildChatMessages(systemPrompt, context.conversationHistory);
  }
}
