export function stripTextForTts(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cleaned = text;

  cleaned = cleaned.replace(/\s*【[^】]*?】/g, '');
  cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/gs, '$1');
  cleaned = cleaned.replace(/__(.+?)__/gs, '$1');
  cleaned = cleaned.replace(/~~(.+?)~~/gs, '$1');
  cleaned = cleaned.replace(/\*(.+?)\*/gs, '$1');
  cleaned = cleaned.replace(/_(.+?)_/gs, '$1');
  cleaned = cleaned.replace(/`(.+?)`/gs, '$1');
  cleaned = cleaned.replace(/^#{1,6}\s+(.*)$/gm, '$1');
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}
