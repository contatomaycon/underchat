const CHANNEL_PATTERN =
  /^[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+(#[a-zA-Z0-9_.-]+)?)?$/;

export function isValidCentrifugoChannel(channel: string): boolean {
  if (!channel || channel.length === 0 || channel.length > 255) {
    return false;
  }
  return CHANNEL_PATTERN.test(channel);
}

function validateChannelId(id: string, functionName: string): void {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`${functionName}: ID cannot be empty`);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error(`${functionName}: ID contains invalid characters`);
  }
}

export function chatAccountCentrifugo(accountId: string): string {
  validateChannelId(accountId, 'chatAccountCentrifugo');
  return `chat:account#${accountId}`;
}

export function chatQueueAccountCentrifugo(accountId: string): string {
  validateChannelId(accountId, 'chatQueueAccountCentrifugo');
  return `chat.queue:account#${accountId}`;
}

export function workerCentrifugoQueue(accountId: string): string {
  validateChannelId(accountId, 'workerCentrifugoQueue');
  return `worker:account#${accountId}`;
}

export function statusServerCentrifugoQueue(): string {
  return 'status_server';
}

export function serverSshCentrifugoQueue(): string {
  return 'server_ssh';
}

export function presenceUserCentrifugo(userId: string): string {
  validateChannelId(userId, 'presenceUserCentrifugo');
  return `presence:user#${userId}`;
}

export function paymentAccountCentrifugo(accountId: string): string {
  validateChannelId(accountId, 'paymentAccountCentrifugo');
  return `payment:account#${accountId}`;
}

export function channelsConfigCentrifugo(): string {
  return 'channels:config';
}

export function reportConversationHistoryPdfAccountCentrifugo(
  accountId: string
): string {
  validateChannelId(accountId, 'reportConversationHistoryPdfAccountCentrifugo');
  return `reports:account#${accountId}`;
}
