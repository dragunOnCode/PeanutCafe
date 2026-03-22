import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { McpModule } from './mcp.module';
import { AgentsModule } from '../agents/agents.module';
import { ClaudeAdapter } from '../agents/adapters/claude.adapter';
import { GeminiAdapter } from '../agents/adapters/gemini.adapter';
import { CodexAdapter } from '../agents/adapters/codex.adapter';

describe('McpModule', () => {
  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'MINIMAX_API_KEY') return 'test-api-key';
      if (key === 'MINIMAX_BASE_URL') return 'https://test.example.com';
      if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
      if (key === 'CLAUDE_API_KEY') return 'test-claude-key';
      if (key === 'GLM_API_KEY') return 'test-glm-key';
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  it('should be importable', async () => {
    const module = await Test.createTestingModule({
      imports: [AgentsModule, McpModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfigService)
      .overrideProvider(ClaudeAdapter)
      .useValue({})
      .overrideProvider(GeminiAdapter)
      .useValue({})
      .overrideProvider(CodexAdapter)
      .useValue({})
      .compile();

    expect(module).toBeDefined();
  });
});
