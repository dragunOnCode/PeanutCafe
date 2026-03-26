// src/orchestration/handoff/output-parser.spec.ts
import { parseAgentOutput } from './output-parser';

describe('parseAgentOutput', () => {
  it('should detect NEED_REVIEW tag', () => {
    const result = parseAgentOutput('设计文档完成 <NEED_REVIEW>');
    expect(result.needsReview).toBe(true);
  });

  it('should extract handoff agent', () => {
    const result = parseAgentOutput('完成啦 @Codex');
    expect(result.nextAgent).toBe('Codex');
  });

  it('should clean output', () => {
    const result = parseAgentOutput('<NEED_REVIEW>设计完成@Codex');
    expect(result.cleanOutput).toBe('设计完成@Codex');
  });

  it('should handle multiple agents return last', () => {
    const result = parseAgentOutput('@Claude @Codex');
    expect(result.nextAgent).toBe('Codex');
  });

  it('should handle no tags', () => {
    const result = parseAgentOutput('普通输出');
    expect(result.needsReview).toBe(false);
    expect(result.nextAgent).toBeNull();
    expect(result.cleanOutput).toBe('普通输出');
  });
});
