import {
  addCentrifugoRecoveryFailedListener,
  isChannelSubscribed,
  onMessage,
  unsubscribe,
} from './centrifugo';
import type {
  InternalChatActivityState,
  InternalChatMessage,
} from '../types/internalChat';

const CHANNEL_PATTERN =
  /^[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+(#[a-zA-Z0-9_.-]+)?)?$/;

function validateChannelId(id: string, functionName: string): void {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`${functionName}: ID cannot be empty`);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error(`${functionName}: ID contains invalid characters`);
  }
}

function internalChatAccountCentrifugo(accountId: string): string {
  validateChannelId(accountId, 'internalChatAccountCentrifugo');
  return `internal.chat:account#${accountId}`;
}

function isValidChannel(channel: string): boolean {
  if (!channel || channel.length === 0 || channel.length > 255) {
    return false;
  }
  return CHANNEL_PATTERN.test(channel);
}

export type InternalChatConversationSyncPayload = {
  type: 'internal_chat_conversation_sync';
  reason?: string;
  conversation_id?: string;
  [key: string]: unknown;
};

export type InternalChatActivityPayload = {
  type: 'typing';
  conversation_id: string;
  user_id: string;
  user_name?: string | null;
  user_photo?: string | null;
  state: InternalChatActivityState;
  [key: string]: unknown;
};

export type InternalChatMessagePayload = InternalChatMessage;

export type InternalChatRecoveryFailedPayload = {
  channel: string;
};

export type InternalChatForceLogoutPayload = {
  event: 'force_logout';
  user_id: string;
  session_platform: 'web' | 'mobile' | null;
};

type InternalChatEventMap = {
  conversationSync: InternalChatConversationSyncPayload;
  activity: InternalChatActivityPayload;
  message: InternalChatMessagePayload;
  recoveryFailed: InternalChatRecoveryFailedPayload;
  forceLogout: InternalChatForceLogoutPayload;
};

type InternalChatEventName = keyof InternalChatEventMap;
type InternalChatListener<K extends InternalChatEventName> = (
  data: InternalChatEventMap[K]
) => void;

let isInitialized = false;
let initializingPromise: Promise<void> | null = null;
let currentAccountId: string | null = null;
let subscribedChannel: string | null = null;
let removeRecoveryFailedListener: (() => void) | null = null;

const conversationSyncListeners = new Set<
  InternalChatListener<'conversationSync'>
>();
const activityListeners = new Set<InternalChatListener<'activity'>>();
const messageListeners = new Set<InternalChatListener<'message'>>();
const recoveryFailedListeners = new Set<
  InternalChatListener<'recoveryFailed'>
>();
const forceLogoutListeners = new Set<InternalChatListener<'forceLogout'>>();

const pendingMessages = new Map<string, InternalChatMessagePayload[]>();
let messageBatchTimer: ReturnType<typeof setTimeout> | null = null;
let messageBatchBuffer: InternalChatMessagePayload[] = [];

const MESSAGE_BATCH_DELAY_MS = 50;

const getStringField = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

function emit<K extends InternalChatEventName>(
  listeners: Set<InternalChatListener<K>>,
  payload: InternalChatEventMap[K]
): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }
}

function parseForceLogoutPayload(
  rawData: unknown
): InternalChatForceLogoutPayload | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;
  if (data.event !== 'force_logout') return null;

  const userId =
    getStringField(data.user_id) ??
    (typeof data.user_id === 'number' && Number.isFinite(data.user_id)
      ? String(data.user_id)
      : null);
  if (!userId) return null;

  const platform = getStringField(data.session_platform);
  return {
    event: 'force_logout',
    user_id: userId,
    session_platform:
      platform === 'web' || platform === 'mobile' ? platform : null,
  };
}

function parseConversationSyncPayload(
  rawData: unknown
): InternalChatConversationSyncPayload | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;
  if (data.type !== 'internal_chat_conversation_sync') return null;
  return data as InternalChatConversationSyncPayload;
}

function parseActivityPayload(
  rawData: unknown
): InternalChatActivityPayload | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;
  if (data.type !== 'typing') return null;
  const conversationId = getStringField(data.conversation_id);
  const userId = getStringField(data.user_id);
  const state = getStringField(data.state);
  if (!conversationId || !userId || !state) return null;
  if (state !== 'typing' && state !== 'recording' && state !== 'available') {
    return null;
  }

  return {
    ...(data as InternalChatActivityPayload),
    conversation_id: conversationId,
    user_id: userId,
    user_name: getStringField(data.user_name),
    user_photo: getStringField(data.user_photo),
    state,
  };
}

function parseMessagePayload(rawData: unknown): InternalChatMessagePayload | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const data = rawData as Record<string, unknown>;
  if (
    typeof data.message_id !== 'string' ||
    typeof data.conversation_id !== 'string' ||
    typeof data.account_id !== 'string'
  ) {
    return null;
  }
  return data as unknown as InternalChatMessagePayload;
}

function queuePendingMessage(payload: InternalChatMessagePayload): void {
  const conversationId = payload.conversation_id;
  if (!pendingMessages.has(conversationId)) {
    pendingMessages.set(conversationId, []);
  }
  pendingMessages.get(conversationId)?.push(payload);
}

function flushMessageBatch(): void {
  if (messageBatchBuffer.length === 0) return;

  const buffer = [...messageBatchBuffer];
  messageBatchBuffer = [];
  messageBatchTimer = null;

  const latestByMessageId = new Map<string, InternalChatMessagePayload>();
  for (const item of buffer) {
    latestByMessageId.set(item.message_id, item);
  }

  for (const payload of latestByMessageId.values()) {
    queuePendingMessage(payload);
    emit(messageListeners, payload);
  }
}

function queueMessageBatch(payload: InternalChatMessagePayload): void {
  messageBatchBuffer.push(payload);
  if (messageBatchTimer) clearTimeout(messageBatchTimer);
  messageBatchTimer = setTimeout(flushMessageBatch, MESSAGE_BATCH_DELAY_MS);
}

async function cleanupUnsubscribe(): Promise<void> {
  if (messageBatchTimer) {
    clearTimeout(messageBatchTimer);
    messageBatchTimer = null;
  }
  flushMessageBatch();

  if (removeRecoveryFailedListener) {
    removeRecoveryFailedListener();
    removeRecoveryFailedListener = null;
  }

  if (subscribedChannel) {
    await unsubscribe(subscribedChannel).catch(() => {});
  }

  subscribedChannel = null;
  isInitialized = false;
  initializingPromise = null;
  currentAccountId = null;
  pendingMessages.clear();
}

export async function initializeInternalChatSocket(
  accountId: string
): Promise<void> {
  if (!accountId.trim()) return;
  const normalizedAccountId = accountId.trim();

  if (currentAccountId && currentAccountId !== normalizedAccountId) {
    await cleanupUnsubscribe();
  }

  const channel = internalChatAccountCentrifugo(normalizedAccountId);
  if (!isValidChannel(channel)) {
    throw new Error('Invalid internal chat socket channel');
  }

  if (isInitialized && subscribedChannel && isChannelSubscribed(subscribedChannel)) {
    currentAccountId = normalizedAccountId;
    return;
  }

  if (initializingPromise) {
    return initializingPromise;
  }

  initializingPromise = (async () => {
    try {
      if (removeRecoveryFailedListener) {
        removeRecoveryFailedListener();
      }
      removeRecoveryFailedListener = addCentrifugoRecoveryFailedListener(
        (failedChannel) => {
          if (failedChannel === channel) {
            emit(recoveryFailedListeners, { channel: failedChannel });
          }
        }
      );

      await onMessage(channel, (incoming) => {
        const forceLogout = parseForceLogoutPayload(incoming);
        if (forceLogout) {
          emit(forceLogoutListeners, forceLogout);
          return;
        }

        const sync = parseConversationSyncPayload(incoming);
        if (sync) {
          emit(conversationSyncListeners, sync);
          return;
        }

        const activity = parseActivityPayload(incoming);
        if (activity) {
          emit(activityListeners, activity);
          return;
        }

        const message = parseMessagePayload(incoming);
        if (message) {
          queueMessageBatch(message);
        }
      });

      subscribedChannel = channel;
      currentAccountId = normalizedAccountId;
      isInitialized = true;
    } finally {
      initializingPromise = null;
    }
  })();

  return initializingPromise;
}

export async function cleanupInternalChatSocket(): Promise<void> {
  await cleanupUnsubscribe();
}

export function isInternalChatSocketInitialized(): boolean {
  return isInitialized;
}

export function addInternalChatSocketListener<K extends InternalChatEventName>(
  eventName: K,
  listener: InternalChatListener<K>
): () => void {
  if (eventName === 'conversationSync') {
    conversationSyncListeners.add(
      listener as InternalChatListener<'conversationSync'>
    );
    return () => {
      conversationSyncListeners.delete(
        listener as InternalChatListener<'conversationSync'>
      );
    };
  }

  if (eventName === 'activity') {
    activityListeners.add(listener as InternalChatListener<'activity'>);
    return () => {
      activityListeners.delete(listener as InternalChatListener<'activity'>);
    };
  }

  if (eventName === 'message') {
    messageListeners.add(listener as InternalChatListener<'message'>);
    return () => {
      messageListeners.delete(listener as InternalChatListener<'message'>);
    };
  }

  if (eventName === 'recoveryFailed') {
    recoveryFailedListeners.add(
      listener as InternalChatListener<'recoveryFailed'>
    );
    return () => {
      recoveryFailedListeners.delete(
        listener as InternalChatListener<'recoveryFailed'>
      );
    };
  }

  forceLogoutListeners.add(listener as InternalChatListener<'forceLogout'>);
  return () => {
    forceLogoutListeners.delete(listener as InternalChatListener<'forceLogout'>);
  };
}

export function consumePendingInternalChatMessages(
  conversationId: string
): InternalChatMessagePayload[] {
  const items = pendingMessages.get(conversationId) ?? [];
  pendingMessages.delete(conversationId);
  return items;
}
