import { Injectable, Logger } from '@nestjs/common';
import { ToolExecutorService, ToolCall } from '../tools/tool-executor.service';
import { parseReactOutput } from './utils/parse-react-tags';

export interface ReasoningStep {
  id: string;
  thought: string | null;
  toolCall: { name: string; args: Record<string, unknown> } | null;
  observation: string;
  isDone: boolean;
  doneContent?: string;
  handoffAgent?: string;
  message?: ChatMessage;
}

/**
 * Adapter → createRunTaskNode 之间的统一流式事件契约。
 * 每一层只需要关心这一个类型。
 */
export type ReActStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done'; content: string }
  | { type: 'handoff'; agentName: string }
  | { type: 'error'; message: string };

export interface ReActConfig {
  maxSteps: number;
  sessionId: string;
  onThoughtChunk?: (chunk: string) => void;
  onObservation?: (obs: string) => void;
  onDone?: (result: string) => void;
}

export type LLMCaller = (
  messages: ChatMessage[],
  tools: any[],
) => AsyncGenerator<{ content?: string; tool_calls?: any[] }>;

@Injectable()
export class ReActExecutorService {
  private readonly logger = new Logger(ReActExecutorService.name);

  constructor(
    private readonly toolExecutorService: ToolExecutorService,
    private readonly llmCaller: LLMCaller,
  ) {}

  async *execute(initialMessages: ChatMessage[], config: ReActConfig): AsyncGenerator<ReasoningStep> {
    let stepCount = 0;
    const tools = this.toolExecutorService.getOpenAITools();

    const messages: ChatMessage[] = [...initialMessages];

    this.logger.log(`Starting ReAct loop with maxSteps=${config.maxSteps}`);

    while (stepCount < config.maxSteps) {
      const stepId = `step_${stepCount}`;

      let response: AsyncGenerator<{ content?: string; tool_calls?: any[] }>;
      try {
        response = this.llmCaller(messages, tools);
      } catch (error) {
        this.logger.error(`LLM call failed: ${error.message}`);
        yield this.createErrorStep(stepId, `LLM 调用失败: ${error.message}`);
        return;
      }

      let fullContent = '';
      const partialToolCalls = new Map<number, { id: string; name: string; args: string }>();

      try {
        for await (const chunk of response) {
          if (chunk.content) {
            fullContent += chunk.content;
            config.onThoughtChunk?.(chunk.content);
          }
          if (chunk.tool_calls) {
            for (const tc of chunk.tool_calls) {
              const idx: number = tc.index ?? 0;
              const existing = partialToolCalls.get(idx) ?? { id: '', name: '', args: '' };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
              partialToolCalls.set(idx, existing);
            }
          }
        }
      } catch (error) {
        this.logger.error(`LLM streaming failed: ${error.message}`);
        yield this.createErrorStep(stepId, `LLM 流式响应失败: ${error.message}`);
        return;
      }

      const parsed = parseReactOutput(fullContent);

      if (parsed.done) {
        this.logger.log(`ReAct loop terminated: done tag received`);
        config.onDone?.(parsed.done);
        yield {
          id: stepId,
          thought: parsed.thought ?? null,
          toolCall: null,
          observation: '',
          isDone: true,
          doneContent: parsed.done,
        };
        return;
      }

      if (parsed.handoffAgent) {
        this.logger.log(`ReAct loop terminated: handoff to ${parsed.handoffAgent}`);
        yield {
          id: stepId,
          thought: parsed.thought ?? null,
          toolCall: null,
          observation: '',
          isDone: false,
          handoffAgent: parsed.handoffAgent,
        };
        return;
      }

      const toolCalls: ToolCall[] = [...partialToolCalls.values()].map((tc, i) => ({
        id: tc.id || `tc_${Date.now()}_${i}`,
        name: tc.name,
        args: this.safeParseArgs(tc.args),
      }));

      const originalToolCallsForMsg = [...partialToolCalls.values()].map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      }));

      const thought = parsed.thought ?? (fullContent.trim() || null);

      if (toolCalls.length > 0 && thought) {
        const toolCall = toolCalls[0];
        this.logger.debug(`Executing tool: ${toolCall.name}`);

        const toolResult = await this.executeWithRetry(toolCall, stepId);

        if (!toolResult.success) {
          this.logger.warn(`Tool ${toolCall.name} failed: ${toolResult.error}`);
        }

        config.onObservation?.(toolResult.result ?? '');

        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: fullContent,
          tool_calls: originalToolCallsForMsg,
        };

        const toolResultMsg: ChatMessage = {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult.success ? (toolResult.result ?? '') : `Error: ${toolResult.error ?? ''}`,
        };

        messages.push(assistantMsg);
        messages.push(toolResultMsg);

        yield {
          id: stepId,
          thought,
          toolCall: { name: toolCall.name, args: toolCall.args },
          observation: toolResult.result ?? '',
          isDone: false,
          message: assistantMsg,
        };

        yield {
          id: `${stepId}_tool`,
          thought: null,
          toolCall: null,
          observation: toolResult.success ? (toolResult.result ?? '') : `Error: ${toolResult.error ?? ''}`,
          isDone: false,
          message: toolResultMsg,
        };

        stepCount++;
      } else if (thought) {
        this.logger.debug(`Thought without action: ${thought.substring(0, 50)}...`);

        messages.push({ role: 'assistant', content: fullContent });

        yield {
          id: stepId,
          thought,
          toolCall: null,
          observation: '',
          isDone: false,
          message: { role: 'assistant', content: fullContent },
        };
        stepCount++;
      } else {
        this.logger.warn(`Empty LLM response, incrementing stepCount to prevent infinite loop`);
        stepCount++;
      }
    }

    this.logger.log(`ReAct loop reached max_steps limit: ${config.maxSteps}`);
  }

  private safeParseArgs(args: string): Record<string, unknown> {
    if (!args) return {};
    try {
      return JSON.parse(args);
    } catch {
      this.logger.error(`Failed to parse tool args: ${args}`);
      return {};
    }
  }

  private async executeWithRetry(
    toolCall: ToolCall,
    stepId: string,
    maxRetries = 1,
  ): Promise<{ success: boolean; result?: string; error?: string }> {
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        const result = await this.toolExecutorService.executeToolCall(toolCall);
        return {
          success: result.success,
          result: result.result,
          error: result.error,
        };
      } catch (error) {
        attempts++;
        if (attempts > maxRetries) {
          return {
            success: false,
            error: `工具执行失败 (${attempts} 次尝试): ${error.message}`,
          };
        }
        this.logger.warn(`Tool execution attempt ${attempts} failed: ${error.message}`);
      }
    }

    return { success: false, error: '工具执行失败' };
  }

  private createErrorStep(stepId: string, errorMessage: string): ReasoningStep {
    return {
      id: stepId,
      thought: errorMessage,
      toolCall: null,
      observation: '',
      isDone: false,
    };
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}
