import { Logger } from '@nestjs/common';
import { Readable, Writable } from 'stream';
import { McpTool } from './mcp.interfaces.js';

export class McpClientImpl {
  private readonly logger = new Logger(McpClientImpl.name);
  private connected = false;
  private requestId = 0;
  private baseUrl: string | null = null;
  private containerExec: { stdout: Readable; stdin: Writable } | null = null;
  private containerId: string | null = null;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

  // HTTP 模式构造函数
  constructor(baseUrl: string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(containerExec: any, containerId: string);
  constructor(first: string | any, second?: string) {
    if (typeof first === 'string') {
      this.baseUrl = first;
      this.connected = true;
    } else {
      const exec = first as { stdout: { on: (event: string, cb: (data: Buffer) => void) => void }; stdin: Writable };
      this.containerExec = exec as { stdout: Readable; stdin: Writable };
      this.containerId = second!;
      this.connected = false;

      exec.stdout.on('data', (data: Buffer) => {
        this.handleMessage(data.toString());
      });

      exec.stdout.on('close', () => {
        this.connected = false;
        this.logger.log('MCP client disconnected');
      });
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    if (this.baseUrl) {
      this.logger.log(`Connected to MCP server: ${this.baseUrl}`);
    } else {
      this.logger.log(`Connected to MCP container: ${this.containerId}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Disconnected')));
    this.pendingRequests.clear();
  }

  async listTools(): Promise<McpTool[]> {
    const response = this.baseUrl ? await this.httpRequest('tools/list', {}) : await this.sendRequest('tools/list', {});
    return (response as { tools: McpTool[] }).tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = this.baseUrl
      ? await this.httpRequest('tools/call', { name, arguments: args })
      : await this.sendRequest('tools/call', { name, arguments: args });
    const content = (response as { content: Array<{ type: string; text?: string }> }).content;
    if (content && content[0]?.type === 'text' && content[0].text) {
      return content[0].text;
    }
    return JSON.stringify(content);
  }

  private async httpRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.baseUrl) throw new Error('Not HTTP mode');
    if (!this.connected) throw new Error('Client not connected');

    const id = ++this.requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (error) {
      throw new Error(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'MCP error');
    }

    return data.result;
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.containerExec) {
        reject(new Error('Client not connected'));
        return;
      }

      const id = ++this.requestId;
      const request = { jsonrpc: '2.0', id, method, params };

      this.pendingRequests.set(id, { resolve, reject });
      this.containerExec!.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      setTimeout(() => {
        this.pendingRequests.delete(id);
      }, 35000);
    });
  }

  private handleMessage(data: string): void {
    const lines = data.split('\n').filter((line) => line.trim());
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);
          if (message.error) {
            reject(new Error(message.error.message || 'MCP error'));
          } else {
            resolve(message.result);
          }
        }
      } catch {
        this.logger.warn(`Failed to parse MCP message: ${data}`);
      }
    }
  }
}
