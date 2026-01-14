export function buildMessageDocumentId(
  accountId: string,
  messageId: string
): string {
  return `${accountId}:${messageId}`;
}
