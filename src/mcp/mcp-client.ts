import { Logger } from '@nestjs/common';
import { Readable, Writable } from 'stream';
import { McpTool } from './mcp.interfaces.js';

interface JsonRpcError {
  message?: string;
}

interface JsonRpcResponseEnvelope {
  id?: number;
  error?: JsonRpcError;
  result?: unknown;
}

type ContainerExec = { stdout: Readable; stdin: Writable };
const CONNECT_ABORTED_MESSAGE = 'HTTP request failed: The operation was aborted.';

export class McpClientImpl {
  private readonly logger = new Logger(McpClientImpl.name);
  private connected = false;
  private requestId = 0;
  private connectPromise: Promise<void> | null = null;
  private connectAttempt = 0;
  private connectAbortController: AbortController | null = null;
  private readonly baseUrl: string | null = null;
  private readonly containerExec: ContainerExec | null = null;
  private readonly containerId: string | null = null;
  private sessionId: string | null = null;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

  constructor(baseUrl: string);
  constructor(containerExec: ContainerExec, containerId: string);
  constructor(first: string | ContainerExec, second?: string) {
    if (typeof first === 'string') {
      this.baseUrl = first;
      return;
    }

    this.containerExec = first;
    this.containerId = second ?? null;

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

    if (this.baseUrl) {
      if (!this.connectPromise) {
        const attempt = ++this.connectAttempt;
        this.sessionId = null;
        const abortController = new AbortController();
        this.connectAbortController = abortController;
        const connectPromise = this.initializeHttpSession(abortController.signal)
          .then(() => {
            if (attempt !== this.connectAttempt) {
              this.sessionId = null;
              throw new Error(CONNECT_ABORTED_MESSAGE);
            }

            this.connected = true;
            this.logger.log(`Connected to MCP server: ${this.baseUrl}`);
          })
          .catch((error) => {
            this.sessionId = null;
            throw error;
          })
          .finally(() => {
            if (this.connectAbortController === abortController) {
              this.connectAbortController = null;
            }
            if (this.connectPromise === connectPromise) {
              this.connectPromise = null;
            }
          });
        this.connectPromise = connectPromise;
      }

      await this.connectPromise;
      return;
    }

    this.connected = true;
    this.logger.log(`Connected to MCP container: ${this.containerId}`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected && !this.connectPromise) {
      return;
    }

    this.connectAttempt++;
    this.connected = false;
    this.sessionId = null;
    const connectAbortController = this.connectAbortController;
    this.connectAbortController = null;
    this.connectPromise = null;
    connectAbortController?.abort();
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Disconnected')));
    this.pendingRequests.clear();
  }

  async listTools(): Promise<McpTool[]> {
    if (this.baseUrl && !this.connected) {
      await this.connect();
    }
    const response = this.baseUrl ? await this.httpRequest('tools/list', {}) : await this.sendRequest('tools/list', {});
    return (response as { tools?: McpTool[] }).tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (this.baseUrl && !this.connected) {
      await this.connect();
    }
    const response = this.baseUrl
      ? await this.httpRequest('tools/call', { name, arguments: args })
      : await this.sendRequest('tools/call', { name, arguments: args });
    const content = (response as { content?: Array<{ type: string; text?: string }> }).content;
    if (content?.[0]?.type === 'text' && content[0].text) {
      return content[0].text;
    }
    return JSON.stringify(content ?? response);
  }

  private async initializeHttpSession(signal?: AbortSignal): Promise<void> {
    await this.performHttpRequest(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'PeanutCafe',
          version: '0.0.1',
        },
      },
      signal,
    );

    await this.performHttpNotification('notifications/initialized', undefined, signal);
  }

  private async httpRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.baseUrl) {
      throw new Error('Not HTTP mode');
    }
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return this.performHttpRequest(method, params);
  }

  private async performHttpRequest(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const id = ++this.requestId;
    const response = await this.postHttp(
      {
        jsonrpc: '2.0',
        id,
        method,
        params,
      },
      signal,
    );

    const message = await this.parseHttpResponse(response, id);
    if (message?.error) {
      throw new Error(message.error.message || 'MCP error');
    }

    return message?.result;
  }

  private async performHttpNotification(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    const response = await this.postHttp(
      {
        jsonrpc: '2.0',
        method,
        ...(params ? { params } : {}),
      },
      signal,
    );

    const message = await this.parseHttpResponse(response);
    if (message?.error) {
      throw new Error(message.error.message || 'MCP error');
    }
  }

  private async postHttp(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    if (!this.baseUrl) {
      throw new Error('Not HTTP mode');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(CONNECT_ABORTED_MESSAGE);
      }
      throw new Error(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.persistSessionId(response);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  private persistSessionId(response: Response): void {
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) {
      this.sessionId = sessionId;
    }
  }

  private async parseHttpResponse(response: Response, expectedId?: number): Promise<JsonRpcResponseEnvelope | undefined> {
    const rawBody = await response.text();
    if (!rawBody.trim()) {
      return undefined;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return this.parseEventStream(rawBody, expectedId);
    }

    return JSON.parse(rawBody) as JsonRpcResponseEnvelope;
  }

  private parseEventStream(body: string, expectedId?: number): JsonRpcResponseEnvelope | undefined {
    const messages = body
      .split(/\r?\n\r?\n/)
      .map((block) =>
        block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n'),
      )
      .filter((payload) => payload.length > 0)
      .map((payload) => JSON.parse(payload) as JsonRpcResponseEnvelope);

    if (expectedId === undefined) {
      return messages.at(-1);
    }

    const expectedMessage = messages.find((message) => message.id === expectedId);
    if (!expectedMessage) {
      throw new Error(`MCP response missing expected id ${expectedId}`);
    }

    return expectedMessage;
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
      this.containerExec.stdin.write(JSON.stringify(request) + '\n');

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
        const message = JSON.parse(line) as JsonRpcResponseEnvelope;
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
