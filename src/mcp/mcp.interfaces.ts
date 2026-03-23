export enum ServerStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
}

export type McpServerProfileName = 'standard' | 'open-websearch';

export interface McpServerConfig {
  image?: string; // STDIO mode
  url?: string; // HTTP mode
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
  profile?: McpServerProfileName;
}

export interface IMcpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  isConnected(): boolean;
}

export type McpClient = IMcpClient;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ServerInfo {
  name: string;
  config: McpServerConfig;
  status: ServerStatus;
  client: IMcpClient;
  containerId?: string;
}
