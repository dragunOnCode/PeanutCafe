// src/agents/prompts/prompts.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PromptsModule } from './prompts.module';
import { PromptTemplateService } from './prompt-template.service';
import { PromptBuilder } from './prompt-builder';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Prompts Integration', () => {
  let templateService: PromptTemplateService;
  let promptBuilder: PromptBuilder;
  const testSessionId = 'integration-test-session';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PromptsModule],
    }).compile();

    templateService = module.get<PromptTemplateService>(PromptTemplateService);
    promptBuilder = module.get<PromptBuilder>(PromptBuilder);

    // Clean up any existing test session
    const testSessionPath = path.join(process.cwd(), 'workspace', 'sessions', testSessionId);
    try {
      await fs.rm(testSessionPath, { recursive: true, force: true });
    } catch {}
  });

  afterEach(async () => {
    // Clean up after tests
    const testSessionPath = path.join(process.cwd(), 'workspace', 'sessions', testSessionId);
    try {
      await fs.rm(testSessionPath, { recursive: true, force: true });
    } catch {}
  });

  describe('initializeSessionPrompts', () => {
    it('should initialize prompts for a session', async () => {
      await templateService.initializeSessionPrompts(testSessionId);

      // Verify the session prompts directory exists
      const sessionPromptsPath = path.join(process.cwd(), 'workspace', 'sessions', testSessionId, 'prompts');

      const exists = await fs
        .access(sessionPromptsPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify files were copied
      const claudeSystemPath = path.join(sessionPromptsPath, 'claude', 'system.md');
      const claudeSystemExists = await fs
        .access(claudeSystemPath)
        .then(() => true)
        .catch(() => false);
      expect(claudeSystemExists).toBe(true);
    });
  });

  describe('buildMessages with real templates', () => {
    it('should build complete messages for Claude', async () => {
      // Initialize session first
      await templateService.initializeSessionPrompts(testSessionId);

      const messages = await promptBuilder.buildMessages(
        {
          id: 'claude-001',
          name: 'Claude',
          type: 'claude',
          role: '架构设计与编码实现',
          capabilities: ['架构设计', '代码生成'],
          model: 'MiniMax-M2.5',
        },
        { sessionId: testSessionId },
      );

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('Claude');
      expect(messages[0].content).toContain('架构设计');
    });

    it('should build complete messages for Codex', async () => {
      await templateService.initializeSessionPrompts(testSessionId);

      const messages = await promptBuilder.buildMessages(
        {
          id: 'codex-001',
          name: 'Codex',
          type: 'codex',
          role: '代码审查与质量把控',
          capabilities: ['代码审查', '测试建议'],
          model: 'glm-4.5-air',
        },
        { sessionId: testSessionId },
      );

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('Codex');
      expect(messages[0].content).toContain('代码审查');
    });

    it('should build complete messages for Gemini', async () => {
      await templateService.initializeSessionPrompts(testSessionId);

      const messages = await promptBuilder.buildMessages(
        {
          id: 'gemini-001',
          name: 'Gemini',
          type: 'gemini',
          role: '创意发散与视觉设计',
          capabilities: ['创意建议', 'UI/UX设计'],
          model: 'qwen3-32b',
        },
        { sessionId: testSessionId },
      );

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('Gemini');
      expect(messages[0].content).toContain('创意');
    });
  });
});
