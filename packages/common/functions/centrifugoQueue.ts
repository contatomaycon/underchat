export function chatAccountCentrifugo(accountId: string): string {
  return `chat:account#${accountId}`;
}

export function chatQueueAccountCentrifugo(accountId: string): string {
  return `chat.queue:account#${accountId}`;
}

export function workerCentrifugoQueue(accountId: string): string {
  return `worker:account#${accountId}`;
}

export function statusServerCentrifugoQueue(): string {
  return 'status_server';
}

export function serverSshCentrifugoQueue(): string {
  return 'server_ssh';
}

export function presenceUserCentrifugo(userId: string): string {
  return `presence:user#${userId}`;
}

export function paymentAccountCentrifugo(accountId: string): string {
  return `payment:account#${accountId}`;
}
