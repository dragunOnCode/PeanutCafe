import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Readable, Writable } from 'stream';
import { McpTool } from './mcp.interfaces.js';

interface ClientInfo {
  name: string;
  version: string;
}

export class McpClientImpl {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private connected = false;
  private clientInfo: ClientInfo;

  constructor(
    private readonly stdout: Readable,
    private readonly stdin: Writable,
    clientName = 'PeanutCafe-MCP-Client',
    clientVersion = '1.0.0',
  ) {
    this.clientInfo = { name: clientName, version: clientVersion };
    this.client = new Client(this.clientInfo, {
      capabilities: {},
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.transport = new StdioClientTransport({
      command: 'cat',
      args: [],
    });

    this.transport.onclose = () => {
      this.connected = false;
    };

    await this.client.connect(this.transport);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.transport) {
      return;
    }

    await this.transport.close();
    this.connected = false;
    this.transport = null;
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const result = await this.client.listTools();
    return result.tools as McpTool[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const result = await this.client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const firstContent = content[0];
    if (firstContent?.type === 'text' && firstContent.text) {
      return firstContent.text;
    }
    return JSON.stringify(firstContent);
  }
}
