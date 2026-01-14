export function buildMessageDocumentId(
  accountId: string,
  workerId: string,
  messageId: string
): string {
  return `${accountId}:${workerId}:${messageId}`;
}
