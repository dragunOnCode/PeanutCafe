import { parseAgentOutput, stripSpecialTags } from './output-parser';

describe('parseAgentOutput', () => {
  it('detects the NEED_REVIEW tag', () => {
    const result = parseAgentOutput('design complete <NEED_REVIEW>');

    expect(result.needsReview).toBe(true);
    expect(result.handoff).toBeNull();
  });

  it('extracts a structured handoff target from the last handoff tag', () => {
    const result = parseAgentOutput('draft<handoff_agent>Claude</handoff_agent><handoff_agent>Codex</handoff_agent>');

    expect(result.handoff).toEqual({
      targetAgent: 'Codex',
    });
  });

  it('returns clean output without workflow tags', () => {
    const result = parseAgentOutput('<NEED_REVIEW>design ready<handoff_agent>Codex</handoff_agent>');

    expect(result.cleanOutput).toBe('design ready');
  });

  it('returns no handoff when the output has no handoff tags', () => {
    const result = parseAgentOutput('plain output');

    expect(result.needsReview).toBe(false);
    expect(result.handoff).toBeNull();
    expect(result.cleanOutput).toBe('plain output');
  });
});

describe('stripSpecialTags', () => {
  it('removes handoff, review, and react tags from output', () => {
    const result = stripSpecialTags(
      '<thought>analysis</thought>answer<handoff_agent>Codex</handoff_agent><done>done</done>',
    );

    expect(result).toBe('answer');
  });
});
