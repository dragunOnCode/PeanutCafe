import { Injectable } from '@nestjs/common';

export interface ParseResult {
  mentionedAgents: string[];
  processedContent: string;
}

@Injectable()
export class MessageRouter {
  parseMessage(content: string): ParseResult {
    const mentionPattern = /@(\w+)/g;
    const mentionedAgents: string[] = [];
    let match;

    while ((match = mentionPattern.exec(content)) !== null) {
      mentionedAgents.push(match[1]);
    }

    return {
      mentionedAgents,
      processedContent: content.replace(/@\w+/g, '').trim(),
    };
  }

  route(parsed: ParseResult): { shouldBroadcast: boolean; targetAgentIds: string[] } {
    return {
      shouldBroadcast: true,
      targetAgentIds: parsed.mentionedAgents,
    };
  }
}
