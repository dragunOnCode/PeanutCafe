export enum ServerStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
}

export interface McpServerConfig {
  image: string;
  env?: Record<string, string>;
  enabled: boolean;
  timeout?: number;
}

export interface McpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  isConnected(): boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ServerInfo {
  name: string;
  config: McpServerConfig;
  status: ServerStatus;
  client: McpClient;
  containerId: string;
}
