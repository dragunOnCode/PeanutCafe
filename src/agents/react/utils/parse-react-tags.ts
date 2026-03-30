import { Logger } from '@nestjs/common';

export interface ParsedReactOutput {
  thought: string | null;
  observation: string | null;
  done: string | null;
  handoffAgent: string | null;
  raw: string;
}

export function parseReactOutput(content: string): ParsedReactOutput {
  let normalized = content.replace(/\\</g, '<').replace(/\\>/g, '>');

  const codeBlocks = extractCodeBlocks(normalized);
  for (const block of codeBlocks) {
    const parsed = extractTagsFromText(block);
    if (parsed) return { ...parsed, raw: content };
  }

  return extractTagsFromText(normalized, { raw: content });
}

function extractTagsFromText(text: string, opts?: { raw?: string }): ParsedReactOutput {
  return {
    thought: extractSingleTag(text, 'thought'),
    observation: extractSingleTag(text, 'observation'),
    done: extractSingleTag(text, 'done'),
    handoffAgent: extractSingleTag(text, 'handoff_agent'),
    raw: opts?.raw ?? text,
  };
}

function extractSingleTag(text: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, 'i');
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```[\s\S]*?```/g;
  let match;
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
   * 处理增量文本块
   * @param chunk 新增的文本片段
   * @returns 解析出的标签内容（如果有完整标签闭合）
   */
  feed(chunk: string): Partial<ParsedReactOutput> {
    this.buffer += chunk;

    if (this.bufferStart > 0) {
      this.buffer = this.buffer.substring(this.bufferStart);
      this.bufferStart = 0;
    }

    const openMatch = this.buffer.match(/<(\w+)>/);
    if (openMatch && !this.currentTag) {
      this.currentTag = openMatch[1];
      this.tagContent = '';
      this.openTagClosed = false;
      this.logger.debug(`Started tracking tag: ${this.currentTag}`);
    }

    if (this.currentTag) {
      if (!this.openTagClosed) {
        const openTagEndIndex = this.buffer.indexOf('>');
        if (openTagEndIndex !== -1) {
          this.openTagClosed = true;
          this.contentStart = openTagEndIndex + 1;
          const afterOpenTag = this.buffer.substring(this.contentStart);
          if (afterOpenTag.length > 0) {
            this.tagContent += afterOpenTag;
          }
        }
      } else {
        this.tagContent += chunk;
      }

      const closePattern = `</${this.currentTag}>`;
      const closeIndex = this.tagContent.indexOf(closePattern);
      if (closeIndex !== -1) {
        const content = this.tagContent.substring(0, closeIndex);
        this.foundTags.add(this.currentTag);
        this.logger.debug(`Completed tag: ${this.currentTag} = ${content.substring(0, 50)}...`);

        const result: Partial<ParsedReactOutput> = {};
        result[this.currentTag] = content;

        const consumedLength = this.contentStart + closeIndex + closePattern.length;
        this.bufferStart = consumedLength;
        this.currentTag = null;
        this.tagContent = '';
        this.openTagClosed = false;

        return result;
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
