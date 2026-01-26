export function normalizeTextForConditionalComparison(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
