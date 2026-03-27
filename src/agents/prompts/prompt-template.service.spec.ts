// src/agents/prompts/prompt-template.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PromptTemplateService } from './prompt-template.service';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('PromptTemplateService', () => {
  let service: PromptTemplateService;
  const testRoot = path.join(__dirname, '../../../../test-temp/prompts');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  const priv = (s: PromptTemplateService) => s as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptTemplateService],
    }).compile();

    service = module.get<PromptTemplateService>(PromptTemplateService);
  });

  afterEach(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('interpolate', () => {
    it('should replace variables correctly', () => {
      const template = '你是 {name}，一个{role}专家。';
      const vars = { name: 'Claude', role: '架构设计' };
      const result = priv(service).interpolate(template, vars);
      expect(result).toBe('你是 Claude，一个架构设计专家。');
    });

    it('should keep unknown variables as placeholder', () => {
      const template = '模型: {model}';
      const vars = { name: 'Claude' };
      const result = priv(service).interpolate(template, vars);
      expect(result).toBe('模型: {model}');
    });

    it('should handle capabilities list', () => {
      const template = '能力:\n{capabilitiesList}';
      const vars = { capabilities: ['架构设计', '代码生成'] };
      const result = priv(service).interpolate(template, vars);
      expect(result).toContain('- 架构设计');
      expect(result).toContain('- 代码生成');
    });
  });

  describe('sanitizePathComponent', () => {
    it('should accept valid path components', () => {
      expect(() => priv(service).sanitizePathComponent('claude')).not.toThrow();
      expect(() => priv(service).sanitizePathComponent('test-session-123')).not.toThrow();
    });

    it('should reject path traversal attempts', () => {
      expect(() => priv(service).sanitizePathComponent('../etc')).toThrow();
      expect(() => priv(service).sanitizePathComponent('..\\windows')).toThrow();
    });
  });

  describe('sanitizeFileName', () => {
    it('should accept valid file names', () => {
      expect(() => priv(service).sanitizeFileName('system')).not.toThrow();
      expect(() => priv(service).sanitizeFileName('capabilities-md')).not.toThrow();
    });

    it('should reject invalid file names', () => {
      expect(() => priv(service).sanitizeFileName('../etc')).toThrow();
      expect(() => priv(service).sanitizeFileName('file.txt')).toThrow();
    });
  });
});
