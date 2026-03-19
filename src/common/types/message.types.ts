export interface Message {
  id: string;
  sessionId: string;
  userId?: string;
  agentId?: string;
  agentName?: string;
  role: MessageRole;
  content: string;
  mentionedAgents?: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface SharedMemory {
  sessionId: string;
  recentMessages: Message[];
  keyFacts: KeyFact[];
  activeAgents: string[];
  contextWindow: number;
}

export interface KeyFact {
  key: string;
  value: string;
  source: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface WorkspaceChangeEvent {
  type: 'file_created' | 'file_updated' | 'file_deleted';
  path: string;
  author: string;
  language?: string;
  linesOfCode?: number;
  timestamp: Date;
}
