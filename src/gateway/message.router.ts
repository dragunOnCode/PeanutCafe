import { Injectable, Logger } from '@nestjs/common';

export interface ParsedMessage {
  content: string;
  mentionedAgents: string[];
  isCommand: boolean;
  command?: string;
  commandArgs?: string;
}

export interface RouteResult {
  targetAgentIds: string[];
  shouldBroadcast: boolean;
  processedContent: string;
}

@Injectable()
export class MessageRouter {
  private readonly logger = new Logger(MessageRouter.name);

  private readonly mentionPattern = /@(\w+)/g;
  private readonly commandPattern = /^\/(\w+)\s*(.*)/;

  private readonly knownAgents = new Set(['claude', 'codex', 'gemini']);

  parseMessage(content: string): ParsedMessage {
    const mentionedAgents = this.extractMentions(content);

    const commandMatch = content.match(this.commandPattern);
    if (commandMatch) {
      return {
        content,
        mentionedAgents,
        isCommand: true,
        command: commandMatch[1],
        commandArgs: commandMatch[2]?.trim(),
      };
    }

    return {
      content,
      mentionedAgents,
      isCommand: false,
    };
  }

  route(parsed: ParsedMessage): RouteResult {
    if (parsed.isCommand) {
      return this.handleCommand(parsed);
    }

    if (parsed.mentionedAgents.length > 0) {
      return {
        targetAgentIds: parsed.mentionedAgents.map((name) => `${name}-001`),
        shouldBroadcast: true,
        processedContent: parsed.content,
      };
    }

    // MVP: 默认路由到 Claude
    return {
      targetAgentIds: ['claude-001'],
      shouldBroadcast: true,
      processedContent: parsed.content,
    };
  }

  private extractMentions(content: string): string[] {
    const mentions: string[] = [];
    let match: RegExpExecArray | null;

    const pattern = new RegExp(this.mentionPattern.source, 'g');
    while ((match = pattern.exec(content)) !== null) {
      const agentName = match[1].toLowerCase();
      if (this.knownAgents.has(agentName)) {
        mentions.push(agentName);
      }
    }

    return [...new Set(mentions)];
  }

  private handleCommand(parsed: ParsedMessage): RouteResult {
    switch (parsed.command) {
      case 'status':
        return {
          targetAgentIds: [],
          shouldBroadcast: false,
          processedContent: parsed.content,
        };

      case 'ask':
        return {
          targetAgentIds: parsed.mentionedAgents.length
            ? parsed.mentionedAgents.map((name) => `${name}-001`)
            : ['claude-001'],
          shouldBroadcast: true,
          processedContent: parsed.commandArgs || parsed.content,
        };

      default:
        this.logger.warn(`未知命令: /${parsed.command}`);
        return {
          targetAgentIds: [],
          shouldBroadcast: true,
          processedContent: parsed.content,
        };
    }
  }
}
