import { onMessage, unsubscribe } from './centrifugo';

const CHANNEL_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function validateChannelId(id: string, functionName: string): void {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`${functionName}: ID cannot be empty`);
  }
  if (!CHANNEL_PATTERN.test(id)) {
    throw new Error(`${functionName}: ID contains invalid characters`);
  }
}

function workerAccountCentrifugo(accountId: string): string {
  validateChannelId(accountId, 'workerAccountCentrifugo');
  return `worker:account#${accountId}`;
}

export type ChannelStatusPayload = {
  worker_id: string;
  account_id: string;
  worker_status_id?: string;
  [key: string]: unknown;
};

type ChannelStatusListener = (data: ChannelStatusPayload) => void;

let isInitialized = false;
let currentAccountId: string | null = null;
const listeners = new Set<ChannelStatusListener>();

function handleChannelStatusMessage(data: unknown): void {
  if (!data || typeof data !== 'object') return;

  const payload = data as ChannelStatusPayload;
  if (!payload.worker_id) return;

  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }
}

export async function cleanupChannelStatusSocket(): Promise<void> {
  if (!isInitialized || !currentAccountId) return;

  const channel = workerAccountCentrifugo(currentAccountId);
  await unsubscribe(channel, handleChannelStatusMessage);

  currentAccountId = null;
  isInitialized = false;
}

export async function initializeChannelStatusSocket(
  accountId: string
): Promise<void> {
  if (isInitialized && currentAccountId === accountId) return;

  if (isInitialized && currentAccountId && currentAccountId !== accountId) {
    await cleanupChannelStatusSocket();
  }

  validateChannelId(accountId, 'initializeChannelStatusSocket');
  const channel = workerAccountCentrifugo(accountId);

  await onMessage(channel, handleChannelStatusMessage);
  currentAccountId = accountId;
  isInitialized = true;
}

export function addChannelStatusListener(
  listener: ChannelStatusListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function removeChannelStatusListener(
  listener: ChannelStatusListener
): void {
  listeners.delete(listener);
}
