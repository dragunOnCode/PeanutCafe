export function parseMention(content: string): string | null {
  const matches = content.match(/@(\w+)/g);
  if (!matches) return null;
  const lastMatch = matches[matches.length - 1];
  return lastMatch.slice(1);
}

export function removeMentions(content: string): string {
  return content.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
}
