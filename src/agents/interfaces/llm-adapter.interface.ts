import { Message, SharedMemory, WorkspaceChangeEvent } from '../../common/types';

export interface ILLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly type: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly callType: 'http';

  generate(prompt: string, context: AgentContext): Promise<AgentResponse>;
  streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string>;
  shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult>;
  healthCheck(): Promise<boolean>;
  getStatus(): AgentStatus;
}

export interface AgentContext {
  sessionId: string;
  userId?: string;
  conversationHistory?: Message[];
  sharedMemory?: SharedMemory;
  workspaceChange?: WorkspaceChangeEvent;
}

export interface AgentResponse {
  content: string;
  reasoning?: string;
  tokenUsage?: TokenUsage;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface DecisionResult {
  should: boolean;
  reason?: string;
  priority?: 'high' | 'medium' | 'low';
}

export enum AgentStatus {
  ONLINE = 'online',
  BUSY = 'busy',
  OFFLINE = 'offline',
  ERROR = 'error',
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  type: string;
  role: string;
  capabilities: string[];
  callType: 'http';
  enabled: boolean;
  priority: number;
  config: {
    temperature: number;
    maxTokens: number;
    timeout: number;
  };
}
