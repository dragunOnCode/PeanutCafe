import { parseReactOutput, StreamingReactParser } from './parse-react-tags';

describe('parseReactOutput', () => {
  it('解析裸标签', () => {
    const result = parseReactOutput('<thought>分析中</thought>');
    expect(result.thought).toBe('分析中');
  });

  it('解析带空白的标签', () => {
    const result = parseReactOutput('<thought>  分析中  </thought>');
    expect(result.thought).toBe('分析中');
  });

  it('解析跨行标签', () => {
    const result = parseReactOutput('<thought>\n分析中\n</thought>');
    expect(result.thought).toBe('分析中');
  });

  it('解析 done 标签', () => {
    const result = parseReactOutput('<done>完成</done>');
    expect(result.done).toBe('完成');
  });

  it('解析 handoff_agent 标签', () => {
    const result = parseReactOutput('<handoff_agent>Claude</handoff_agent>');
    expect(result.handoffAgent).toBe('Claude');
  });

  it('还原转义标签', () => {
    const result = parseReactOutput('\\<thought\\>分析中\\</thought\\>');
    expect(result.thought).toBe('分析中');
  });

  it('代码块内标签解析', () => {
    const result = parseReactOutput('```\n<thought>分析中</thought>\n```');
    expect(result.thought).toBe('分析中');
  });

  it('无标签时返回 null', () => {
    const result = parseReactOutput('这只是普通文本');
    expect(result.thought).toBeNull();
    expect(result.done).toBeNull();
  });

  it('observation 标签解析', () => {
    const result = parseReactOutput('<observation>工具结果</observation>');
    expect(result.observation).toBe('工具结果');
  });
});

describe('StreamingReactParser', () => {
  it('增量解析 thought 标签', () => {
    const parser = new StreamingReactParser();
    const chunk1 = parser.feed('<though');
    const chunk2 = parser.feed('t>分析');
    const chunk3 = parser.feed('中</thought>');

    expect(chunk3.thought).toBe('分析中');
  });

  it('isComplete 返回 done 状态', () => {
    const parser = new StreamingReactParser();
    parser.feed('<done>完成</done>');
    expect(parser.isComplete()).toBe(true);
  });

  it('isComplete 返回 handoff_agent 状态', () => {
    const parser = new StreamingReactParser();
    parser.feed('<handoff_agent>Target</handoff_agent>');
    expect(parser.isComplete()).toBe(true);
  });

  it('多个标签顺序解析', () => {
    const parser = new StreamingReactParser();
    const result1 = parser.feed('<thought>思考</thought>');
    const result2 = parser.feed('<done>完成</done>');

    expect(result1.thought).toBe('思考');
    expect(result2.done).toBe('完成');
    expect(parser.isComplete()).toBe(true);
  });
});
