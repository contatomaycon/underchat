export function workerCentrifugoQueue(accountId: string | null): string {
  return `worker:account#${accountId}`;
}
