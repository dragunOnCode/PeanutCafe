import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { McpServerManager } from './mcp-server-manager';
import { ToolRegistry, Tool } from '../agents/tools/tool-registry';
import { IMcpClient, McpTool, McpServerConfig } from './mcp.interfaces';

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

@Injectable()
export class McpToolRegistry implements OnModuleInit {
  private readonly logger = new Logger(McpToolRegistry.name);
  private initialized = false;

  constructor(
    private readonly mcpServerManager: McpServerManager,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.initialized) return;
    await this.registerAllServerTools();
    this.initialized = true;
  }

  private async registerAllServerTools(): Promise<void> {
    const configPath = path.join(process.cwd(), 'config', 'mcp-config.json');
    if (!fs.existsSync(configPath)) {
      this.logger.warn(`MCP config not found at ${configPath}`);
      return;
    }
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent) as McpConfig;
    const mcpServers = config.mcpServers || {};

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      if (serverConfig.enabled) {
        try {
          await this.registerServerTools(name);
        } catch (e) {
          this.logger.error(`Failed to register tools for ${name}: ${e.message}`);
        }
      }
    }
  }

  async registerServerTools(serverName: string): Promise<void> {
    const client: IMcpClient = this.mcpServerManager.getClient(serverName);
    const tools = await client.listTools();

    for (const tool of tools) {
      const mcpTool = tool;
      const adaptedTool: Tool = {
        name: `${serverName}.${mcpTool.name}`,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema,
        execute: async (args) => {
          return await client.callTool(mcpTool.name, args);
        },
      };

      this.toolRegistry.registerTool(adaptedTool);
      this.logger.log(`Registered MCP tool: ${adaptedTool.name}`);
    }
  }

  async unregisterServerTools(serverName: string): Promise<void> {
    this.logger.warn(`Unregister not fully implemented for: ${serverName}`);
  }

  async reloadAllTools(): Promise<void> {
    this.logger.log('Reloading all MCP tools');
  }
}
