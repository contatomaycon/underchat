export function buildWppConnectionDocumentId(
  accountId: string,
  workerId: string
): string {
  return `${accountId}:${workerId}`;
}
