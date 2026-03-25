# Multi-Agent Prompt Template System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于Markdown文件的分层提示词模板系统，支持会话隔离、缓存优化、模板复用

**Architecture:**

- 核心组件：`PromptTemplateService`（模板读取+缓存）、`PromptBuilder`（组合分层模板）
- 配置：`config/prompts/` 目录存储Markdown模板，会话初始化时复制到 `workspace/sessions/{sessionId}/prompts/`
- 缓存：内存Map缓存，首次读取后缓存内容，PromptWatcherService监听文件变化触发缓存清除

**Tech Stack:** NestJS, TypeScript, fs/promises, crypto (MD5)

---

## 文件结构

```
config/prompts/                          # Markdown模板配置
├── _shared/
│   ├── tools.md
│   └── constraints.md
├── claude/
│   ├── system.md
│   └── capabilities.md
├── codex/
│   ├── system.md
│   └── capabilities.md
└── gemini/
    ├── system.md
    └── capabilities.md

src/agents/prompts/                     # 核心代码
├── prompt-template.service.ts           # 模板读取+缓存
├── prompt-template.service.spec.ts     # 单元测试
├── prompt-builder.ts                   # 组合分层模板
├── prompt-builder.spec.ts              # 单元测试
├── prompt.config.ts                    # 缓存配置
├── prompt-watcher.service.ts           # 文件监控（开发模式）
├── prompt-watcher.service.spec.ts      # 单元测试
├── prompts.module.ts                   # 模块定义
└── prompts.controller.ts                # 管理API

src/agents/adapters/                    # 改造现有Adapter
├── claude.adapter.ts
├── codex.adapter.ts
└── gemini.adapter.ts
```

---

## Task 1: 创建Markdown模板文件

**Files:**

- Create: `config/prompts/_shared/tools.md`
- Create: `config/prompts/_shared/constraints.md`
- Create: `config/prompts/claude/system.md`
- Create: `config/prompts/claude/capabilities.md`
- Create: `config/prompts/codex/system.md`
- Create: `config/prompts/codex/capabilities.md`
- Create: `config/prompts/gemini/system.md`
- Create: `config/prompts/gemini/capabilities.md`

- [ ] **Step 1: 创建 config/prompts/\_shared/tools.md**

```markdown
# 工具定义

当你需要执行操作时，使用以下工具调用格式：

## 文件操作

### 读取文件

当需要读取文件内容时，使用：
<tool_call>{"name": "read_file", "args": {"path": "文件路径"}}</tool_call>

### 写入文件

当需要写入文件时，使用：
<tool_call>{"name": "write_file", "args": {"path": "文件路径", "content": "文件内容"}}</tool_call>

### 列出文件

当需要列出目录文件时，使用：
<tool_call>{"name": "list_files", "args": {}}</tool_call>

## 命令执行

### 执行命令

当需要执行Shell命令时，使用：
<tool_call>{"name": "execute_command", "args": {"command": "命令", "args": ["参数"]}}</tool_call>
```

- [ ] **Step 2: 创建 config/prompts/\_shared/constraints.md**

```markdown
# 通用约束规则

- 代码必须清晰、可维护
- 优先使用标准库和主流框架
- 如果不确定，明确告知用户
- 不要假设文件存在，先检查再操作
```

- [ ] **Step 3: 创建 config/prompts/claude/system.md**

```markdown
# 角色定义

你是 {name}，一个专业的软件架构师和编码专家。

## 身份

- **名称**: {name}
- **角色**: {role}
- **模型**: {model}

## 行为准则

- 设计清晰、可扩展的系统架构
- 编写高质量、可维护的代码
- 提供合理的技术选型建议
- 主动识别代码问题并提出改进方案
```

- [ ] **Step 4: 创建 config/prompts/claude/capabilities.md**

```markdown
# 能力说明

{name} 擅长以下领域：

{capabilities_list}

## 专业领域

- 系统架构设计
- 代码生成与实现
- 技术选型评估
- 代码重构优化

## 沟通风格

- 简洁专业，直接给出方案
- 适当解释技术决策的原因
- 主动提出潜在风险和改进建议
```

- [ ] **Step 5: 创建 config/prompts/codex/system.md**

```markdown
# 角色定义

你是 {name}，一个专业的代码审查专家和质量把控者。

## 身份

- **名称**: {name}
- **角色**: {role}
- **模型**: {model}

## 行为准则

- 严格审查代码质量和安全性
- 发现潜在问题和优化点
- 提供具体可执行的改进建议
- 确保代码符合最佳实践
```

- [ ] **Step 6: 创建 config/prompts/codex/capabilities.md**

```markdown
# 能力说明

{name} 擅长以下领域：

{capabilities_list}

## 专业领域

- 代码质量审查
- 性能优化分析
- 安全漏洞检测
- 测试覆盖率评估

## 沟通风格

- 客观直接，指出具体问题
- 提供修复建议和代码示例
- 解释问题严重程度和优先级
```

- [ ] **Step 7: 创建 config/prompts/gemini/system.md**

```markdown
# 角色定义

你是 {name}，一个富有创意的设计师和产品顾问。

## 身份

- **名称**: {name}
- **角色**: {role}
- **模型**: {model}

## 行为准则

- 提供创新性的设计方案
- 关注用户体验和界面美学
- 从产品角度提出建议
- 平衡创意与可行性
```

- [ ] **Step 8: 创建 config/prompts/gemini/capabilities.md**

```markdown
# 能力说明

{name} 擅长以下领域：

{capabilities_list}

## 专业领域

- UI/UX设计创意
- 用户体验优化
- 产品方案构思
- 视觉设计方案

## 沟通风格

- 创意发散，提供多种可能
- 关注用户感受和审美
- 结合产品目标和用户需求
```

- [ ] **Step 9: Commit**

```bash
git add config/prompts/
git commit -m "feat(prompts): add markdown template files for all agents"
```

---

## Task 2: 创建 PromptTemplateService

**Files:**

- Create: `src/agents/prompts/prompt-template.service.ts`
- Create: `src/agents/prompts/prompt-template.service.spec.ts`

- [ ] **Step 1: 创建 prompt-template.service.ts**

```typescript
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
    tools: string,
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
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      if (vars[key] !== undefined) {
        return String(vars[key]);
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
```

- [ ] **Step 2: 创建 prompt-template.service.spec.ts**

```typescript
// src/agents/prompts/prompt-template.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PromptTemplateService } from './prompt-template.service';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('PromptTemplateService', () => {
  let service: PromptTemplateService;
  const testSessionId = 'test-session-123';
  const testRoot = path.join(__dirname, '../../../../test-temp/prompts');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptTemplateService],
    }).compile();

    service = module.get<PromptTemplateService>(PromptTemplateService);
  });

  afterEach(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {}
  });

  describe('interpolate', () => {
    it('should replace variables correctly', () => {
      const template = '你是 {name}，一个{role}专家。';
      const vars = { name: 'Claude', role: '架构设计' };
      const result = (service as any).interpolate(template, vars);
      expect(result).toBe('你是 Claude，一个架构设计专家。');
    });

    it('should keep unknown variables as placeholder', () => {
      const template = '模型: {model}';
      const vars = { name: 'Claude' };
      const result = (service as any).interpolate(template, vars);
      expect(result).toBe('模型: {model}');
    });

    it('should handle capabilities list', () => {
      const template = '能力:\n{capabilitiesList}';
      const vars = { capabilities: ['架构设计', '代码生成'] };
      const result = (service as any).interpolate(template, vars);
      expect(result).toContain('- 架构设计');
      expect(result).toContain('- 代码生成');
    });
  });

  describe('sanitizePathComponent', () => {
    it('should accept valid path components', () => {
      expect(() => (service as any).sanitizePathComponent('claude')).not.toThrow();
      expect(() => (service as any).sanitizePathComponent('test-session-123')).not.toThrow();
    });

    it('should reject path traversal attempts', () => {
      expect(() => (service as any).sanitizePathComponent('../etc')).toThrow();
      expect(() => (service as any).sanitizePathComponent('..\\windows')).toThrow();
    });
  });

  describe('sanitizeFileName', () => {
    it('should accept valid file names', () => {
      expect(() => (service as any).sanitizeFileName('system')).not.toThrow();
      expect(() => (service as any).sanitizeFileName('capabilities-md')).not.toThrow();
    });

    it('should reject invalid file names', () => {
      expect(() => (service as any).sanitizeFileName('../etc')).toThrow();
      expect(() => (service as any).sanitizeFileName('file.txt')).toThrow();
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/prompts/prompt-template.service.ts src/agents/prompts/prompt-template.service.spec.ts
git commit -m "feat(prompts): add PromptTemplateService with caching"
```

---

## Task 3: 创建 PromptBuilder

**Files:**

- Create: `src/agents/prompts/prompt-builder.ts`
- Create: `src/agents/prompts/prompt-builder.spec.ts`

- [ ] **Step 1: 创建 prompt-builder.ts**

```typescript
// src/agents/prompts/prompt-builder.ts
import { Injectable } from '@nestjs/common';
import { PromptTemplateService } from './prompt-template.service';
import { Message } from '../../common/types';
import { ChatMessage } from '../utils/build-chat-messages';

interface AgentContext {
  sessionId: string;
  conversationHistory?: Message[];
  sharedMemory?: Record<string, unknown>;
}

interface PromptAgentConfig {
  id: string;
  name: string;
  type: string;
  role: string;
  capabilities: string[];
  model: string;
}

@Injectable()
export class PromptBuilder {
  constructor(private readonly templateService: PromptTemplateService) {}

  async buildSystemPrompt(agent: PromptAgentConfig, context: AgentContext): Promise<string> {
    const vars = {
      name: agent.name,
      role: agent.role,
      model: agent.model,
      sessionId: context.sessionId,
      capabilities: agent.capabilities,
    };

    return this.templateService.buildPrompt(context.sessionId, agent.type, vars);
  }

  async buildMessages(agent: PromptAgentConfig, context: AgentContext): Promise<ChatMessage[]> {
    const systemPrompt = await this.buildSystemPrompt(agent, context);

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    if (context.conversationHistory?.length) {
      const recentHistory = context.conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    return messages;
  }
}
```

- [ ] **Step 2: 创建 prompt-builder.spec.ts**

```typescript
// src/agents/prompts/prompt-builder.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PromptBuilder } from './prompt-builder';
import { PromptTemplateService } from './prompt-template.service';

interface MockAgentConfig {
  id: string;
  name: string;
  type: string;
  role: string;
  capabilities: string[];
  model: string;
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder;
  let mockTemplateService: Partial<PromptTemplateService>;

  beforeEach(async () => {
    mockTemplateService = {
      buildPrompt: jest.fn().mockResolvedValue('Mocked system prompt for Claude'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptBuilder, { provide: PromptTemplateService, useValue: mockTemplateService }],
    }).compile();

    builder = module.get<PromptBuilder>(PromptBuilder);
  });

  describe('buildSystemPrompt', () => {
    it('should build system prompt for agent', async () => {
      const agent: MockAgentConfig = {
        id: 'claude-001',
        name: 'Claude',
        type: 'claude',
        role: '架构设计与编码实现',
        capabilities: ['架构设计', '代码生成'],
        model: 'MiniMax-M2.5',
      };

      const context = { sessionId: 'test-session' };

      const result = await builder.buildSystemPrompt(agent, context);

      expect(mockTemplateService.buildPrompt).toHaveBeenCalledWith(
        'test-session',
        'claude',
        expect.objectContaining({
          name: 'Claude',
          role: '架构设计与编码实现',
        }),
      );
      expect(result).toBe('Mocked system prompt for Claude');
    });
  });

  describe('buildMessages', () => {
    it('should build messages array with system prompt', async () => {
      const agent: MockAgentConfig = {
        id: 'claude-001',
        name: 'Claude',
        type: 'claude',
        role: '架构设计与编码实现',
        capabilities: ['架构设计'],
        model: 'MiniMax-M2.5',
      };

      const context = {
        sessionId: 'test-session',
        conversationHistory: [],
      };

      const messages = await builder.buildMessages(agent, context);

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('Mocked system prompt for Claude');
    });

    it('should include conversation history', async () => {
      const agent: MockAgentConfig = {
        id: 'claude-001',
        name: 'Claude',
        type: 'claude',
        role: '架构设计与编码实现',
        capabilities: ['架构设计'],
        model: 'MiniMax-M2.5',
      };

      const context = {
        sessionId: 'test-session',
        conversationHistory: [
          { id: '1', role: 'user', content: 'Hello', timestamp: new Date() },
          { id: '2', role: 'assistant', content: 'Hi there', agentName: 'Claude', timestamp: new Date() },
        ],
      };

      const messages = await builder.buildMessages(agent, context);

      expect(messages.length).toBe(3);
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/prompts/prompt-builder.ts src/agents/prompts/prompt-builder.spec.ts
git commit -m "feat(prompts): add PromptBuilder for composing messages"
```

---

## Task 4: 创建缓存配置和PromptWatcher（开发模式）

**Files:**

- Create: `src/agents/prompts/prompt.config.ts`
- Create: `src/agents/prompts/prompt-watcher.service.ts`
- Create: `src/agents/prompts/prompt-watcher.service.spec.ts`

- [ ] **Step 1: 创建 prompt.config.ts**

```typescript
// src/agents/prompts/prompt.config.ts
export const promptConfig = {
  cache: {
    enabled: true,
    maxSize: 1000,
    ttlSeconds: 3600,
  },
  template: {
    maxRecentHistory: 10,
    optionalTemplates: ['constraints.md', 'examples.md'],
  },
  watch: {
    enabled: process.env.NODE_ENV === 'development',
    debounceMs: 500,
  },
};
```

- [ ] **Step 2: 创建 prompt-watcher.service.ts**

```typescript
// src/agents/prompts/prompt-watcher.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as path from 'path';
import { PromptTemplateService } from './prompt-template.service';

@Injectable()
export class PromptWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromptWatcherService.name);
  private watcher: chokidar.FSWatcher | undefined;

  constructor(private readonly templateService: PromptTemplateService) {}

  onModuleInit(): void {
    this.startWatching();
  }

  onModuleDestroy(): void {
    this.closeWatcher();
  }

  startWatching(): void {
    if (process.env.NODE_ENV !== 'development') {
      this.logger.log('PromptWatcher skipped in production mode');
      return;
    }

    const watchPath = path.join(process.cwd(), 'config', 'prompts', '**', '*.md');

    this.watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', (filePath) => {
      this.logger.log(`Prompt file changed: ${filePath}`);
      // 清除所有会话的缓存，下次读取会重新加载
      this.templateService.clearAllCache();
    });

    this.watcher.on('add', (filePath) => {
      this.logger.log(`Prompt file added: ${filePath}`);
    });

    this.logger.log('PromptWatcher started in development mode');
  }

  private closeWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
      this.logger.log('PromptWatcher closed');
    }
  }
}
```

- [ ] **Step 3: 创建 prompt-watcher.service.spec.ts**

```typescript
// src/agents/prompts/prompt-watcher.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PromptWatcherService } from './prompt-watcher.service';
import { PromptTemplateService } from './prompt-template.service';

describe('PromptWatcherService', () => {
  let service: PromptWatcherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptWatcherService, { provide: PromptTemplateService, useValue: { clearSessionCache: jest.fn() } }],
    }).compile();

    service = module.get<PromptWatcherService>(PromptWatcherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should not throw when closing without watcher', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add src/agents/prompts/prompt.config.ts src/agents/prompts/prompt-watcher.service.ts src/agents/prompts/prompt-watcher.service.spec.ts
git commit -m "feat(prompts): add cache config and prompt watcher service"
```

---

## Task 5: 创建 PromptsModule

**Files:**

- Create: `src/agents/prompts/prompts.module.ts`
- Create: `src/agents/prompts/prompts.controller.ts`

- [ ] **Step 1: 创建 prompts.module.ts**

```typescript
// src/agents/prompts/prompts.module.ts
import { Module, Global } from '@nestjs/common';
import { PromptTemplateService } from './prompt-template.service';
import { PromptBuilder } from './prompt-builder';
import { PromptWatcherService } from './prompt-watcher.service';

@Global()
@Module({
  providers: [PromptTemplateService, PromptBuilder, PromptWatcherService],
  exports: [PromptTemplateService, PromptBuilder],
})
export class PromptsModule {}
```

- [ ] **Step 2: 创建 prompts.controller.ts**

```typescript
// src/agents/prompts/prompts.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { PromptTemplateService } from './prompt-template.service';

@Controller('admin/prompts')
export class PromptsController {
  constructor(private readonly templateService: PromptTemplateService) {}

  @Post('cache/refresh')
  async refreshCache(@Body() dto: { sessionId?: string }): Promise<{ cleared: number }> {
    if (dto.sessionId) {
      this.templateService.clearSessionCache(dto.sessionId);
      return { cleared: 1 };
    } else {
      this.templateService.clearAllCache();
      return { cleared: -1 };
    }
  }
}
```

- [ ] **Step 3: 更新 app.module.ts 导入 PromptsModule**

修改 `src/app.module.ts`，在 imports 中添加 `PromptsModule`

- [ ] **Step 4: Commit**

```bash
git add src/agents/prompts/prompts.module.ts src/agents/prompts/prompts.controller.ts src/app.module.ts
git commit -m "feat(prompts): add PromptsModule and admin controller"
```

---

## Task 6: 改造 AgentAdapters

**Files:**

- Modify: `src/agents/adapters/claude.adapter.ts`
- Modify: `src/agents/adapters/codex.adapter.ts`
- Modify: `src/agents/adapters/gemini.adapter.ts`

- [ ] **Step 1: 改造 claude.adapter.ts**

修改 `src/agents/adapters/claude.adapter.ts`:

1. 在 constructor 中注入 `PromptBuilder`
2. 修改 `buildMessages` 方法委托给 `PromptBuilder`

```typescript
// src/agents/adapters/claude.adapter.ts (关键修改)
constructor(
  private readonly configService: ConfigService,
  private readonly toolExecutorService: ToolExecutorService,
  private readonly promptBuilder: PromptBuilder,  // 新增
) {
  // ... existing constructor body
}

private buildMessages(context: AgentContext): ChatMessage[] {
  return this.promptBuilder.buildMessages(
    {
      id: this.id,
      name: this.name,
      type: this.type,
      model: this.model,
      role: this.role,
      capabilities: this.capabilities,
    },
    context
  );
}
```

- [ ] **Step 2: 改造 codex.adapter.ts**

同样修改 `src/agents/adapters/codex.adapter.ts`

- [ ] **Step 3: 改造 gemini.adapter.ts**

同样修改 `src/agents/adapters/gemini.adapter.ts`

- [ ] **Step 4: Commit**

```bash
git add src/agents/adapters/claude.adapter.ts src/agents/adapters/codex.adapter.ts src/agents/adapters/gemini.adapter.ts
git commit -m "refactor(adapters): integrate PromptBuilder into all agents"
```

---

## Task 7: 集成测试 - 会话初始化

**Files:**

- Create: `src/agents/prompts/prompts.integration.spec.ts`

- [ ] **Step 1: 创建集成测试**

```typescript
// src/agents/prompts/prompts.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PromptsModule } from './prompts.module';
import { PromptTemplateService } from './prompt-template.service';
import { PromptBuilder } from './prompt-builder';

describe('Prompts Integration', () => {
  let templateService: PromptTemplateService;
  let promptBuilder: PromptBuilder;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PromptsModule],
    }).compile();

    templateService = module.get<PromptTemplateService>(PromptTemplateService);
    promptBuilder = module.get<PromptBuilder>(PromptBuilder);
  });

  describe('initializeSessionPrompts', () => {
    it('should initialize prompts for a session', async () => {
      const sessionId = 'integration-test-session';
      await templateService.initializeSessionPrompts(sessionId);

      const prompt = await templateService.buildPrompt(sessionId, 'claude', {
        name: 'Claude',
        role: '架构设计与编码实现',
        model: 'MiniMax-M2.5',
        capabilities: ['架构设计', '代码生成'],
      });

      expect(prompt).toContain('Claude');
      expect(prompt).toContain('架构设计与编码实现');
    });
  });

  describe('buildMessages with real templates', () => {
    it('should build complete messages for Claude', async () => {
      const sessionId = 'integration-test-session-2';
      await templateService.initializeSessionPrompts(sessionId);

      const messages = await promptBuilder.buildMessages(
        {
          id: 'claude-001',
          name: 'Claude',
          type: 'claude',
          role: '架构设计与编码实现',
          capabilities: ['架构设计', '代码生成'],
          model: 'MiniMax-M2.5',
        },
        { sessionId },
      );

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('Claude');
      expect(messages[0].content).toContain('架构设计');
    });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/prompts/prompts.integration.spec.ts
git commit -m "test(prompts): add integration tests for prompt system"
```

---

## Task 8: 集成到会话创建流程

**Files:**

- Modify: `src/gateway/session.manager.ts` 或相关会话服务

- [ ] **Step 1: 在会话创建时初始化提示词模板**

找到创建新会话的地方，添加 `await promptTemplateService.initializeSessionPrompts(sessionId);`

- [ ] **Step 2: Commit**

```bash
git add src/gateway/session.manager.ts
git commit -m "feat(session): initialize prompt templates on session creation"
```

---

## 实施检查清单

- [ ] Task 1: 创建Markdown模板文件 (8个文件)
- [ ] Task 2: 创建PromptTemplateService
- [ ] Task 3: 创建PromptBuilder
- [ ] Task 4: 创建缓存配置和PromptWatcher
- [ ] Task 5: 创建PromptsModule
- [ ] Task 6: 改造AgentAdapters
- [ ] Task 7: 集成测试
- [ ] Task 8: 集成到会话创建流程
- [ ] 运行 `npm run lint` 确保代码风格正确
- [ ] 运行 `npm run test` 确保所有测试通过

---

**文档版本:** v1.0.0
**最后更新:** 2026-03-26
