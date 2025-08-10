export function isJid(value: string): boolean {
  return /^[0-9]{10,15}@s\.whatsapp\.net$/.test(value);
}
