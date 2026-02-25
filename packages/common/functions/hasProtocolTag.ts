const PROTOCOL_TAG_PATTERN = /\{\{\s*(protocol|protocolo)\s*\}\}/i;

export function hasProtocolTag(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  return PROTOCOL_TAG_PATTERN.test(message);
}
