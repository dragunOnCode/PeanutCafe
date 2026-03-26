// src/agents/prompts/prompt-template.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

interface CachedTemplate {
  content: string;
  hash: string;
  lastModified: Date;
}

interface TemplateVars {
  name: string;
  role: string;
  model: string;
  sessionId: string;
  capabilities?: string[];
  capabilitiesList?: string;
  [key: string]: unknown;
}

@Injectable()
export class PromptTemplateService {
  private readonly logger = new Logger(PromptTemplateService.name);
  private readonly cache = new Map<string, CachedTemplate>();
  private readonly configRoot: string;
  private readonly workspaceRoot: string;

  constructor() {
    this.configRoot = path.join(process.cwd(), 'config', 'prompts');
    this.workspaceRoot = path.join(process.cwd(), 'workspace', 'sessions');
  }

  async initializeSessionPrompts(sessionId: string): Promise<void> {
    const sessionPromptsDir = path.join(this.workspaceRoot, sessionId, 'prompts');
    await fs.mkdir(sessionPromptsDir, { recursive: true });

    await this.copyDirectory(path.join(this.configRoot, '_shared'), path.join(sessionPromptsDir, '_shared'));

    const agents = ['claude', 'codex', 'gemini'];
    for (const agent of agents) {
      const agentConfigDir = path.join(this.configRoot, agent);
      if (await this.exists(agentConfigDir)) {
        await this.copyDirectory(agentConfigDir, path.join(sessionPromptsDir, agent));
      }
    }

    this.logger.log(`Initialized prompts for session: ${sessionId}`);
  }

  async readTemplate(sessionId: string, agentType: string, templateName: string): Promise<string> {
    const sanitizedSessionId = this.sanitizePathComponent(sessionId);
    const sanitizedAgentType = this.sanitizePathComponent(agentType);
    const sanitizedTemplateName = this.sanitizeFileName(templateName);

    const cacheKey = `${sanitizedSessionId}:${sanitizedAgentType}:${sanitizedTemplateName}`;
    const filePath = path.join(
      this.workspaceRoot,
      sanitizedSessionId,
      'prompts',
      sanitizedAgentType,
      `${sanitizedTemplateName}.md`,
    );

    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cached.content;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const hash = crypto.createHash('md5').update(content).digest('hex');

    this.cache.set(cacheKey, { content, hash, lastModified: new Date() });
    this.logger.debug(`Cache miss for ${cacheKey}, refreshed from file`);

    return content;
  }

  private sanitizePathComponent(input: string): string {
    if (/^[a-zA-Z0-9_-]+$/.test(input)) {
      return input;
    }
    throw new Error(`Invalid path component: ${input}`);
  }

  private sanitizeFileName(input: string): string {
    if (/^[a-zA-Z0-9_-]+$/.test(input)) {
      return input;
    }
    throw new Error(`Invalid file name: ${input}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private isCacheValid(cached: CachedTemplate): boolean {
    return true;
  }

  async buildPrompt(sessionId: string, agentType: string, vars: TemplateVars): Promise<string> {
    const [system, capabilities, tools, constraints] = await Promise.all([
      this.readTemplate(sessionId, agentType, 'system'),
      this.readTemplate(sessionId, agentType, 'capabilities'),
      this.tryReadTemplate(sessionId, '_shared', 'tools'),
      this.tryReadTemplate(sessionId, '_shared', 'constraints'),
    ]);

    const examples = await this.tryReadTemplate(sessionId, agentType, 'examples');

    return this.composePrompt(system, capabilities, tools, constraints, examples, vars);
  }

  private composePrompt(
    system: string,
    capabilities: string,
    tools: string | null,
    constraints: string | null,
    examples: string | null,
    vars: TemplateVars,
  ): string {
    const sections: string[] = [];

    if (vars.capabilities) {
      vars.capabilitiesList = vars.capabilities.map((c) => `- ${c}`).join('\n');
    }

    sections.push(this.interpolate(system, vars));
    sections.push(this.interpolate(capabilities, vars));

    if (constraints) {
      sections.push('## 约束规则\n' + this.interpolate(constraints, vars));
    }

    if (tools) {
      sections.push(this.interpolate(tools, vars));
    }

    if (examples) {
      sections.push('## 示例\n' + this.interpolate(examples, vars));
    }

    return sections.join('\n\n');
  }

  private interpolate(template: string, vars: TemplateVars): string {
    return template.replace(/\{(\w+)\}/g, (match: string, key: string) => {
      if (key === 'capabilitiesList' && vars.capabilities && !vars.capabilitiesList) {
        vars.capabilitiesList = vars.capabilities.map((c) => `- ${c}`).join('\n');
      }
      if (vars[key as keyof TemplateVars] !== undefined) {
        return String(vars[key as keyof TemplateVars]);
      }
      return match;
    });
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async tryReadTemplate(sessionId: string, agentType: string, templateName: string): Promise<string | null> {
    try {
      return await this.readTemplate(sessionId, agentType, templateName);
    } catch {
      return null;
    }
  }

  clearSessionCache(sessionId: string): void {
    const keysToDelete = [...this.cache.keys()].filter((key) => key.startsWith(`${sessionId}:`));
    keysToDelete.forEach((key) => this.cache.delete(key));
    this.logger.log(`Cleared ${keysToDelete.length} cache entries for session: ${sessionId}`);
  }

  clearAllCache(): void {
    this.cache.clear();
    this.logger.log('Cleared all prompt template cache');
  }
}
