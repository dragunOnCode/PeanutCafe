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
import { ReActExecutorService, ReActConfig, LLMCaller } from '../react/react-executor.service';
import { ReactPromptBuilder } from '../react/react-prompt.builder';

type NativeMessage = OpenAI.ChatCompletionMessageParam;

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
    private readonly reactPromptBuilder: ReactPromptBuilder,
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
        messages,
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
    const tools = this.toolExecutorService.getOpenAITools();

    try {
      const currentMessages: NativeMessage[] = [...(await this.buildMessages(context))];
      this.logger.log(`Codex streamGenerate input messages: ${JSON.stringify(currentMessages)}`);

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

        this.logger.log(`Codex streamGenerate response: ${JSON.stringify(textBuffer)}`);

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
            this.logger.error(`Codex: failed to parse tool args for ${tc.name}: ${tc.args}`);
            args = {};
          }

          const result = await this.toolExecutorService.executeToolCall({ id: tc.id, name: tc.name, args });
          this.logger.log(`Codex tool [${tc.name}]: ${result.success ? 'ok' : result.error}`);

          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.success ? result.result : `Error: ${result.error}`,
          });
        }
      }
    } catch (error) {
      this.logger.error(`Codex streamGenerate error: ${error.message}`);
      throw error;
    } finally {
      this.status = AgentStatus.ONLINE;
    }
  }

  /**
   * ReAct 模式的流式执行
   * 通过显式的 Thought → Action → Observation 循环增强推理透明度
   */
  async *executeWithReAct(
    message: string,
    context: AgentContext,
    options?: { maxSteps?: number },
  ): AsyncGenerator<string> {
    this.status = AgentStatus.BUSY;
    this.logger.log(`Codex executeWithReAct started for session ${context.sessionId}`);

    this.toolExecutorService.registerSessionTools(context.sessionId);
    const tools = this.toolExecutorService.getOpenAITools();

    try {
      const systemPrompt = this.reactPromptBuilder.buildSystemPrompt({
        name: this.name,
        role: this.role,
        taskDescription: message,
        availableTools: tools.map((t: any) => t.function.name).join(', '),
        maxSteps: options?.maxSteps ?? 10,
      });

      const messages: any[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ];

      const llmCaller: LLMCaller = async function* (msgs: any[], _tools: any[]) {
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: msgs,
          tools: _tools.length > 0 ? _tools : undefined,
          tool_choice: _tools.length > 0 ? 'auto' : undefined,
          temperature: 0.7,
          max_tokens: 4000,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            yield { content: delta.content };
          }
          if (delta?.tool_calls) {
            yield { tool_calls: delta.tool_calls };
          }
        }
      }.bind(this);

      const executor = new ReActExecutorService(this.toolExecutorService, llmCaller);

      const config: ReActConfig = {
        maxSteps: options?.maxSteps ?? 10,
        sessionId: context.sessionId,
        onThoughtChunk: (chunk) => {
          this.logger.debug(`Thought chunk: ${chunk.substring(0, 50)}...`);
        },
        onObservation: (obs) => {
          this.logger.debug(`Observation: ${obs.substring(0, 50)}...`);
        },
        onDone: (result) => {
          this.logger.log(`ReAct completed with result: ${result.substring(0, 50)}...`);
        },
      };

      for await (const step of executor.execute(messages, config)) {
        if (step.thought) {
          yield `<thought>${step.thought}</thought>`;
        }
        if (step.observation) {
          yield `<observation>${step.observation}</observation>`;
        }
        if (step.isDone) {
          yield `<done>${step.observation}</done>`;
        }
        if (step.handoffAgent) {
          yield `<handoff_agent>${step.handoffAgent}</handoff_agent>`;
        }
      }
    } finally {
      this.status = AgentStatus.ONLINE;
      this.logger.log(`Codex executeWithReAct finished for session ${context.sessionId}`);
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
