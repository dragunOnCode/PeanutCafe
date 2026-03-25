import { parseMention, removeMentions } from './mention-parser';

describe('parseMention', () => {
  it('should extract @mention from content', () => {
    const result = parseMention('请 @Claude 实现这个功能');
    expect(result).toBe('Claude');
  });

  it('should return null when no mention found', () => {
    const result = parseMention('请实现这个功能');
    expect(result).toBeNull();
  });

  it('should extract last mention when multiple', () => {
    const result = parseMention('@Claude 完成后交给 @Codex');
    expect(result).toBe('Codex');
  });
});

describe('removeMentions', () => {
  it('should remove all @mentions', () => {
    const result = removeMentions('@Claude 请 @Codex 检视');
    expect(result).toBe('请 检视');
  });

  it('should handle content without mentions', () => {
    const result = removeMentions('普通消息内容');
    expect(result).toBe('普通消息内容');
  });
});
