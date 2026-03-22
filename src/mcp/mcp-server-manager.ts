import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import { McpServerConfig, ServerStatus, McpClient, ServerInfo } from './mcp.interfaces';
import { McpClientImpl } from './mcp-client';

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

@Injectable()
export class McpServerManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpServerManager.name);
  private docker: Docker;
  private servers = new Map<string, ServerInfo>();
  private config: Record<string, McpServerConfig> = {};

  constructor() {
    this.docker = new Docker();
  }

  async onModuleInit(): Promise<void> {
    const configPath = path.join(process.cwd(), 'config', 'mcp-config.json');
    await this.initialize(configPath);
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose();
  }

  async initialize(configPath: string): Promise<void> {
    if (!fs.existsSync(configPath)) {
      this.logger.warn(`MCP config not found at ${configPath}`);
      return;
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent) as McpConfig;
    this.config = config.mcpServers || {};

    for (const [name, serverConfig] of Object.entries(this.config)) {
      if (serverConfig.enabled) {
        await this.startServer(name);
      }
    }
  }

  async startServer(name: string): Promise<void> {
    const config = this.config[name];
    if (!config) {
      throw new Error(`MCP server config not found: ${name}`);
    }

    this.logger.log(`Starting MCP server: ${name}`);
    const container = await this.docker.createContainer({
      Image: config.image,
      Env: this.resolveEnvVars(config.env || {}),
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    await container.start();

    const containerInfo = await container.inspect();
    const containerId = containerInfo.Id;

    const exec = await container.exec({
      AttachStdout: true,
      AttachStdin: true,
      Cmd: ['npx', '-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    const client = new McpClientImpl(
      { stdout: stream as unknown as NodeJS.ReadableStream, stdin: stream as unknown as NodeJS.WritableStream },
      containerId,
    );
    await client.connect();

    this.servers.set(name, {
      name,
      config,
      status: ServerStatus.RUNNING,
      client,
      containerId,
    });

    this.logger.log(`MCP server started: ${name}`);
  }

  async stopServer(name: string): Promise<void> {
    const info = this.servers.get(name);
    if (!info) return;

    await info.client.disconnect();
    const container = this.docker.getContainer(info.containerId);
    try {
      await container.stop();
      await container.remove();
    } catch (e) {
      const error = e as Error;
      this.logger.warn(`Error stopping container ${name}: ${error.message}`);
    }
    this.servers.delete(name);
  }

  getServerStatus(name: string): ServerStatus {
    const info = this.servers.get(name);
    return info?.status || ServerStatus.STOPPED;
  }

  getClient(name: string): McpClient {
    const info = this.servers.get(name);
    if (!info) {
      throw new Error(`MCP server not found: ${name}`);
    }
    return info.client;
  }

  async dispose(): Promise<void> {
    for (const name of Array.from(this.servers.keys())) {
      await this.stopServer(name);
    }
  }

  private resolveEnvVars(env: Record<string, string>): string[] {
    return Object.entries(env).map(([key, value]) => {
      const resolved = value.replace(/\$\{(\w+)\}/g, (_: string, varName: string): string => {
        return process.env[varName] || '';
      });
      return `${key}=${resolved}`;
    });
  }
}
