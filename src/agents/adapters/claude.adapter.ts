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
import { ToolExecutorService } from '../tools/tool-executor.service';
import { PromptBuilder } from '../prompts/prompt-builder';

type NativeMessage = OpenAI.ChatCompletionMessageParam;

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
    private readonly promptBuilder: PromptBuilder,
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
      const messages = await this.buildMessages(context);
      this.logger.log(`Claude messages history: ${JSON.stringify(messages)}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
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
    const tools = this.toolExecutorService.getOpenAITools();

    try {
      const currentMessages: NativeMessage[] = [...(await this.buildMessages(context))];
      this.logger.log(`Claude streamGenerate input messages: ${JSON.stringify(currentMessages)}`);

      while (true) {
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          temperature: 0.7,
          max_tokens: 4000,
          stream: true,
        });

        let textBuffer = '';
        const partialToolCalls = new Map<number, { id: string; name: string; args: string }>();

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) {
            textBuffer += delta.content;
            yield delta.content;
          }

          for (const tcDelta of delta?.tool_calls ?? []) {
            const existing = partialToolCalls.get(tcDelta.index) ?? { id: '', name: '', args: '' };
            if (tcDelta.id) existing.id = tcDelta.id;
            if (tcDelta.function?.name) existing.name += tcDelta.function.name;
            if (tcDelta.function?.arguments) existing.args += tcDelta.function.arguments;
            partialToolCalls.set(tcDelta.index, existing);
          }
        }

        this.logger.log(`Claude streamGenerate response: ${JSON.stringify(textBuffer)}`);

        if (partialToolCalls.size === 0) {
          break;
        }

        const assistantToolCalls = [...partialToolCalls.values()].map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        }));

        currentMessages.push({
          role: 'assistant',
          content: textBuffer || null,
          tool_calls: assistantToolCalls,
        });

        for (const tc of partialToolCalls.values()) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.args);
          } catch {
            this.logger.error(`Claude: failed to parse tool args for ${tc.name}: ${tc.args}`);
            args = {};
          }

          const result = await this.toolExecutorService.executeToolCall({ id: tc.id, name: tc.name, args });
          this.logger.log(`Claude tool [${tc.name}]: ${result.success ? 'ok' : result.error}`);

          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.success ? result.result : `Error: ${result.error}`,
          });
        }
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

  private async buildMessages(context: AgentContext): Promise<NativeMessage[]> {
    const msgs = await this.promptBuilder.buildMessages(
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
    return msgs as unknown as NativeMessage[];
  }
}
