import { Injectable, Logger } from '@nestjs/common';
import { ToolExecutorService, ToolCall } from '../tools/tool-executor.service';
import { StreamingReactParser } from './utils/parse-react-tags';

export interface ReasoningStep {
  id: string;
  thought: string | null;
  toolCall: { name: string; args: Record<string, unknown> } | null;
  observation: string;
  isDone: boolean;
  handoffAgent?: string;
}

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

  async *execute(messages: ChatMessage[], config: ReActConfig): AsyncGenerator<ReasoningStep> {
    const parser = new StreamingReactParser();
    let stepCount = 0;
    const tools = this.toolExecutorService.getOpenAITools();

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
      let toolCallsFromResponse: ToolCall[] = [];

      try {
        for await (const chunk of response) {
          if (chunk.content) {
            fullContent += chunk.content;
            const parsed = parser.feed(chunk.content);
            if (parsed.thought) {
              config.onThoughtChunk?.(parsed.thought);
            }
          }
          if (chunk.tool_calls) {
            toolCallsFromResponse = this.parseToolCalls(chunk.tool_calls);
          }
        }
      } catch (error) {
        this.logger.error(`LLM streaming failed: ${error.message}`);
        yield this.createErrorStep(stepId, `LLM 流式响应失败: ${error.message}`);
        return;
      }

      const parsed = parser.feed('');

      if (parsed.done) {
        this.logger.log(`ReAct loop terminated: done tag received`);
        config.onDone?.(parsed.done);
        yield {
          id: stepId,
          thought: parsed.thought ?? null,
          toolCall: null,
          observation: '',
          isDone: true,
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

      if (toolCallsFromResponse.length > 0 && parsed.thought) {
        const toolCall = toolCallsFromResponse[0];
        this.logger.debug(`Executing tool: ${toolCall.name}`);

        const toolResult = await this.executeWithRetry(toolCall, stepId);

        if (!toolResult.success) {
          this.logger.warn(`Tool ${toolCall.name} failed: ${toolResult.error}`);
        }

        config.onObservation?.(toolResult.result ?? '');

        messages.push({ role: 'assistant', content: `<thought>${parsed.thought}</thought>` });
        messages.push({ role: 'user', content: `<observation>${toolResult.result ?? toolResult.error}</observation>` });

        yield {
          id: stepId,
          thought: parsed.thought,
          toolCall: { name: toolCall.name, args: toolCall.args },
          observation: toolResult.result ?? '',
          isDone: false,
        };

        stepCount++;
      } else if (parsed.thought) {
        // LLM 输出 thought 但没有工具调用，也没有 done/handoff
        // 记录 reasoning 步骤并计数，防止无限循环
        this.logger.debug(`Thought without action: ${parsed.thought.substring(0, 50)}...`);
        messages.push({ role: 'assistant', content: `<thought>${parsed.thought}</thought>` });
        yield {
          id: stepId,
          thought: parsed.thought,
          toolCall: null,
          observation: '',
          isDone: false,
        };
        stepCount++;
      } else {
        // 无任何输出（空 generator 或 无效响应）
        // 仍然计数以防止无限循环
        this.logger.warn(`Empty LLM response, incrementing stepCount to prevent infinite loop`);
        stepCount++;
      }
    }

    this.logger.log(`ReAct loop reached max_steps limit: ${config.maxSteps}`);
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

  private parseToolCalls(toolCalls: any[]): ToolCall[] {
    return toolCalls.map((tc, index) => ({
      id: tc.id ?? `tc_${Date.now()}_${index}`,
      name: tc.function?.name ?? tc.name,
      args:
        typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments ?? tc.arguments ?? {}),
    }));
  }

  private createErrorStep(stepId: string, errorMessage: string): ReasoningStep {
    return {
      id: stepId,
      thought: null,
      toolCall: null,
      observation: '',
      isDone: false,
    };
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
