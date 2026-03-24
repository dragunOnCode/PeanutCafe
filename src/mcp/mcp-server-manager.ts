import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import { IMcpClient, McpServerConfig, ServerStatus, ServerInfo } from './mcp.interfaces';
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

    const normalizedConfig = this.normalizeConfig(config);
    const { client, containerId } = await this.createClient(normalizedConfig, name);

    await client.connect();

    this.servers.set(name, {
      name,
      config: normalizedConfig,
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
    if (info.containerId) {
      const container = this.docker.getContainer(info.containerId);
      try {
        await container.stop();
        await container.remove();
      } catch (e) {
        const error = e as Error;
        this.logger.warn(`Error stopping container ${name}: ${error.message}`);
      }
    }
    this.servers.delete(name);
  }

  getServerStatus(name: string): ServerStatus {
    const info = this.servers.get(name);
    return info?.status || ServerStatus.STOPPED;
  }

  getClient(name: string): IMcpClient {
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

  private normalizeConfig(config: McpServerConfig): McpServerConfig {
    return {
      ...config,
      profile: config.profile ?? 'standard',
    };
  }

  private async createClient(
    config: McpServerConfig,
    serverName: string,
  ): Promise<{ client: IMcpClient; containerId?: string }> {
    if (config.url) {
      return { client: this.createHttpClient(config, serverName) };
    }

    if (config.image) {
      return this.createStdioClient(config, serverName);
    }

    throw new Error(`MCP server config must have either url or image: ${serverName}`);
  }

  private createHttpClient(config: McpServerConfig, serverName: string): IMcpClient {
    switch (config.profile) {
      case 'standard':
        return this.createStandardHttpClient(config, serverName);
      case 'open-websearch':
        return this.createOpenWebSearchHttpClient(config, serverName);
      default:
        throw new Error(`Unsupported MCP server profile "${String(config.profile)}" for HTTP server ${serverName}`);
    }
  }

  private createStandardHttpClient(config: McpServerConfig, _serverName: string): IMcpClient {
    return new McpClientImpl(config.url!);
  }

  private createOpenWebSearchHttpClient(config: McpServerConfig, _serverName: string): IMcpClient {
    return new McpClientImpl(config.url!);
  }

  private async createStdioClient(
    config: McpServerConfig,
    serverName: string,
  ): Promise<{ client: IMcpClient; containerId: string }> {
    switch (config.profile) {
      case 'standard':
        return this.createStandardStdioClient(config, serverName);
      default:
        throw new Error(`Unsupported MCP server profile "${String(config.profile)}" for stdio server ${serverName}`);
    }
  }

  private async createStandardStdioClient(
    config: McpServerConfig,
    _serverName: string,
  ): Promise<{ client: IMcpClient; containerId: string }> {
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
      Cmd: this.getStdioServerCommand(),
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    return {
      client: new McpClientImpl(
        { stdout: stream as unknown as Readable, stdin: stream as unknown as Writable },
        containerId,
      ),
      containerId,
    };
  }

  private getStdioServerCommand(): string[] {
    return ['npx', '-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'];
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
