import {
  addCentrifugoConnectionListener,
  addCentrifugoRecoveryFailedListener,
  isChannelSubscribed,
  onMessage,
  unsubscribe,
} from './centrifugo';
import type { MobileChannelStatusEvent } from '../../../packages/common/functions/mobileChannelStatusProjection';

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

export type ChannelStatusPayload = MobileChannelStatusEvent & {
  account_id: string;
  [key: string]: unknown;
};

type ChannelStatusListener = (data: ChannelStatusPayload) => void;

let activeAccountId: string | null = null;
let desiredAccountId: string | null = null;
let lifecycleGeneration = 0;
let initialization: {
  accountId: string;
  generation: number;
  promise: Promise<void>;
} | null = null;
const listeners = new Set<ChannelStatusListener>();

class ChannelStatusInitializationCancelledError extends Error {
  constructor() {
    super('Channel status socket initialization was superseded');
    this.name = 'ChannelStatusInitializationCancelledError';
  }
}

function handleChannelStatusMessage(data: unknown): void {
  if (!data || typeof data !== 'object') return;

  const payload = data as ChannelStatusPayload;
  if (!payload.worker_id) return;
  const expectedAccountId = desiredAccountId ?? activeAccountId;
  if (!expectedAccountId || payload.account_id !== expectedAccountId) return;

  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }
}

export async function cleanupChannelStatusSocket(): Promise<void> {
  const cleanupGeneration = ++lifecycleGeneration;
  const accountId = activeAccountId ?? desiredAccountId;
  desiredAccountId = null;
  activeAccountId = null;
  initialization = null;
  if (!accountId) return;

  await unsubscribe(
    workerAccountCentrifugo(accountId),
    handleChannelStatusMessage
  );
  // A newer initialize may have completed while unsubscribe was settling.
  if (cleanupGeneration !== lifecycleGeneration) return;
}

export function initializeChannelStatusSocket(
  accountId: string
): Promise<void> {
  const normalizedAccountId = accountId.trim();
  validateChannelId(normalizedAccountId, 'initializeChannelStatusSocket');
  const channel = workerAccountCentrifugo(normalizedAccountId);

  if (
    activeAccountId === normalizedAccountId &&
    isChannelSubscribed(channel)
  ) {
    return Promise.resolve();
  }
  if (
    initialization?.accountId === normalizedAccountId &&
    desiredAccountId === normalizedAccountId
  ) {
    return initialization.promise;
  }

  const generation = ++lifecycleGeneration;
  desiredAccountId = normalizedAccountId;
  const previousAccountId = activeAccountId;
  const promise = (async () => {
    if (previousAccountId && previousAccountId !== normalizedAccountId) {
      await unsubscribe(
        workerAccountCentrifugo(previousAccountId),
        handleChannelStatusMessage
      );
      if (
        activeAccountId === previousAccountId &&
        generation === lifecycleGeneration
      ) {
        activeAccountId = null;
      }
    }

    if (
      generation !== lifecycleGeneration ||
      desiredAccountId !== normalizedAccountId
    ) {
      throw new ChannelStatusInitializationCancelledError();
    }

    try {
      // `onMessage` now resolves only after the server confirms Subscribed.
      await onMessage(channel, handleChannelStatusMessage);
    } catch (error) {
      if (
        generation === lifecycleGeneration &&
        desiredAccountId === normalizedAccountId
      ) {
        desiredAccountId = null;
      }
      throw error;
    }

    if (
      generation !== lifecycleGeneration ||
      desiredAccountId !== normalizedAccountId
    ) {
      // Do not tear down a newer generation that intentionally reacquired the
      // same account while this promise was pending.
      if (
        desiredAccountId !== normalizedAccountId &&
        activeAccountId !== normalizedAccountId
      ) {
        await unsubscribe(channel, handleChannelStatusMessage);
      }
      throw new ChannelStatusInitializationCancelledError();
    }

    activeAccountId = normalizedAccountId;
  })();
  const pending = { accountId: normalizedAccountId, generation, promise };
  initialization = pending;
  void promise.then(
    () => {
      if (initialization === pending) initialization = null;
    },
    () => {
      if (initialization === pending) initialization = null;
    }
  );
  return promise;
}

export function isChannelStatusSocketInitialized(accountId?: string): boolean {
  const normalizedAccountId = accountId?.trim();
  if (normalizedAccountId && activeAccountId !== normalizedAccountId) {
    return false;
  }
  return Boolean(
    activeAccountId &&
      isChannelSubscribed(workerAccountCentrifugo(activeAccountId))
  );
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

export function addChannelStatusRecoveryListener(
  listener: () => void
): () => void {
  return addCentrifugoRecoveryFailedListener((channel) => {
    const accountId = desiredAccountId ?? activeAccountId;
    if (
      accountId &&
      channel === workerAccountCentrifugo(accountId)
    ) {
      listener();
    }
  });
}

export function addChannelStatusConnectionListener(
  listener: (connected: boolean) => void
): () => void {
  return addCentrifugoConnectionListener(listener, { emitCurrent: true });
}
