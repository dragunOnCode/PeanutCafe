import { Logger } from '@nestjs/common';
import { McpTool } from './mcp.interfaces.js';

export class McpClientImpl {
  private readonly logger = new Logger(McpClientImpl.name);
  private connected = false;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

  constructor(
    private readonly containerExec: {
      stdout: NodeJS.ReadableStream;
      stdin: NodeJS.WritableStream;
    },
    private readonly containerId: string,
  ) {
    this.containerExec.stdout.on('data', (data: Buffer) => {
      this.handleMessage(data.toString());
    });

    this.containerExec.stdout.on('close', () => {
      this.connected = false;
      this.logger.log('MCP client disconnected');
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.connected = true;
    this.logger.log(`Connected to MCP container: ${this.containerId}`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    this.pendingRequests.forEach(({ reject }) => {
      reject(new Error('Disconnected'));
    });
    this.pendingRequests.clear();
  }

  async listTools(): Promise<McpTool[]> {
    const response = await this.sendRequest('tools/list', {});
    return (response as { tools: McpTool[] }).tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
    const content = (response as { content: Array<{ type: string; text?: string }> }).content;
    if (content && content[0]?.type === 'text' && content[0].text) {
      return content[0].text;
    }
    return JSON.stringify(content);
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Client not connected'));
        return;
      }

      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.containerExec.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
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
      } catch (e) {
        this.logger.warn(`Failed to parse MCP message: ${data}`);
      }
    }
  }
}
