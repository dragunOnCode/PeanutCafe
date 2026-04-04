export const SESSION_TURN_KINDS = ['user', 'assistant', 'system', 'handoff_summary'] as const;

export type SessionTurnKind = (typeof SESSION_TURN_KINDS)[number];

export interface SessionTurn {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  kind: SessionTurnKind;
  content: string;
  agentId?: string;
  agentName?: string;
  createdAt: Date;
}

export interface SessionContext {
  sessionId: string;
  turns: SessionTurn[];
}
