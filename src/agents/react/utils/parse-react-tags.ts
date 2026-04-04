import { Logger } from '@nestjs/common';

export interface ParsedReactOutput {
  thought: string | null;
  observation: string | null;
  done: string | null;
  handoffAgent: string | null;
  raw: string;
}

/**
 * 解析 ReAct 输出中的 XML 标签
 * 支持从代码块或纯文本中提取 thought、observation、done、handoff_agent 标签
 *
 * @param content - 原始 LLM 输出内容
 * @returns 包含各标签解析结果的对象
 */
export function parseReactOutput(content: string): ParsedReactOutput {
  // 第一步：规范化转义字符
  // LLM 输出的 XML 标签中的 < > 会被转义为 \< \>，这里还原为真正的标签字符
  const normalized = content.replace(/\\</g, '<').replace(/\\>/g, '>');

  // 第二步：优先从代码块中提取标签
  // 因为 LLM 可能在代码块内输出thinking过程
  const codeBlocks = extractCodeBlocks(normalized);
  for (const block of codeBlocks) {
    const parsed = extractTagsFromText(block);
    if (parsed) return { ...parsed, raw: content };
  }

  // 第三步：如果代码块中没有完整标签，则从整个文本中提取
  return extractTagsFromText(normalized, { raw: content });
}

/**
 * 从文本中提取所有类型的 ReAct 标签
 * 将提取结果组装成 ParsedReactOutput 结构返回
 *
 * @param text - 要解析的文本（已规范化的）
 * @param opts - 可选配置，目前仅用于传递原始 raw 文本
 */
function extractTagsFromText(text: string, opts?: { raw?: string }): ParsedReactOutput {
  return {
    thought: extractSingleTag(text, 'thought'),
    observation: extractSingleTag(text, 'observation'),
    done: extractSingleTag(text, 'done'),
    handoffAgent: extractSingleTag(text, 'handoff_agent'),
    raw: opts?.raw ?? text,
  };
}

/**
 * 使用正则提取单个标签的内容
 * 匹配模式: <tagName>任意内容</tagName>
 * 使用 [\s\S]*? 非贪婪匹配以支持多行内容
 *
 * @param text - 原始文本
 * @param tagName - 标签名（如 'thought', 'observation'）
 * @returns 标签内容，如果未找到则返回 null
 */
function extractSingleTag(text: string, tagName: string): string | null {
  // i 标志表示不区分大小写匹配
  // match[1] 是捕获组 (\s\S]*?) 的内容，即标签包裹的文本
  const pattern = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, 'i');
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * 提取文本中所有 Markdown 代码块
 * LLM 常在代码块内输出思考过程（如 ```thought ... ```）
 *
 * @param text - 原始文本
 * @returns 代码块数组，每项包含完整的 ```...``` 标记
 */
function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  // ``` 匹配代码块开始/结束，[\s\S]*? 非贪婪匹配任意内容（包括换行）
  const regex = /```[\s\S]*?```/g;
  let match;
  // exec 在全局模式下会维护 lastIndex，实现遍历所有匹配
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

/**
 * 流式场景下的增量解析器
 * 用于在 LLM 流式输出时实时解析 XML 标签
 */
export class StreamingReactParser {
  private readonly logger = new Logger(StreamingReactParser.name);
  private buffer = '';
  private bufferStart = 0;
  private currentTag: string | null = null;
  private tagContent = '';
  private foundTags = new Set<string>();
  private openTagClosed = false;
  private contentStart = 0;

  /**
   * 处理流式增量文本块
   * 状态机逻辑：等待开标签 -> 收集内容 -> 等待闭标签 -> 返回结果
   *
   * @param chunk - LLM 流式输出的新增文本片段
   * @returns 如果遇到完整闭合标签，返回该标签的内容；否则返回空对象
   */
  feed(chunk: string): Partial<ParsedReactOutput> {
    // 将新文本追加到缓冲区
    this.buffer += chunk;

    // 清理已处理过的部分，避免缓冲区无限增长
    if (this.bufferStart > 0) {
      this.buffer = this.buffer.substring(this.bufferStart);
      this.bufferStart = 0;
    }

    // 状态机主循环：逐字符处理缓冲区
    while (this.buffer.length > 0) {
      if (!this.currentTag) {
        // 状态1：等待开标签（如 <thought>）
        // ^<(\w+)> 匹配行首的标签名（字母数字下划线）
        const openTagMatch = this.buffer.match(/^<(\w+)>/);
        if (openTagMatch) {
          this.currentTag = openTagMatch[1]; // 捕获标签名
          this.tagContent = '';
          this.openTagClosed = true;
          // 跳过已匹配的 开标签 部分
          this.buffer = this.buffer.substring(openTagMatch[0].length);
          this.logger.debug(`Started tracking tag: ${this.currentTag}`);
        } else {
          // 行首不是开标签，退出等待更多数据
          break;
        }
      } else {
        // 状态2：等待闭标签（如 </thought>）
        const closePattern = `</${this.currentTag}>`;
        const closeIndex = this.buffer.indexOf(closePattern);
        if (closeIndex !== -1) {
          // 找到闭标签，提取内容并返回
          const content = this.buffer.substring(0, closeIndex);
          this.foundTags.add(this.currentTag);
          this.logger.debug(`Completed tag: ${this.currentTag} = ${content.substring(0, 50)}...`);

          const result: Partial<ParsedReactOutput> = {};
          result[this.currentTag] = content;

          // 重置状态，准备解析下一个标签
          this.buffer = this.buffer.substring(closeIndex + closePattern.length);
          this.currentTag = null;

          return result;
        } else {
          // 未找到闭标签，退出等待更多数据
          break;
        }
      }
    }

    return {};
  }

  /**
   * 检查是否已到达终止状态
   */
  isComplete(): boolean {
    return this.foundTags.has('done') || this.foundTags.has('handoff_agent');
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.buffer = '';
    this.bufferStart = 0;
    this.currentTag = null;
    this.tagContent = '';
    this.foundTags.clear();
    this.openTagClosed = false;
  }
}
