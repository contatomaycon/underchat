export function workerCentrifugoQueue(accountId: string | null): string {
  return `worker:account#${accountId}`;
}

export function statusServerCentrifugoQueue(): string {
  return 'status_server';
}

export function serverSshCentrifugoQueue(): string {
  return 'server_ssh';
}
