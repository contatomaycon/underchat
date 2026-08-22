import { ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  acknowledgeRecoveryFallback,
  addCentrifugoLifecycleListener,
  onMessage,
  unsubscribe,
  isChannelSubscribed,
  fetchHistoryAndProcess,
  type CentrifugoLifecycleEvent,
} from '@/@webcore/centrifugo';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { useChatStore } from '@/@webcore/stores/chat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatTyping } from '@core/common/interfaces/IChatTyping';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import { useChatNotifications } from '@/composables/useChatNotifications';
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import { selectNewestChatSnapshotRevision } from '@core/common/functions/chatSnapshotRevision';

let isInitialized = false;
let initializedAccountId: string | null = null;
let initializingPromise: Promise<void> | null = null;
let initializingAccountId: string | null = null;
let subscriptions: Array<{
  channel: string;
  unsubscribe: () => Promise<void>;
}> = [];
const pendingMessages = ref<Map<string, IChatMessage[]>>(new Map());
const pendingChatUpdates = ref<Map<string, IChat[]>>(new Map());
let lastSyncTime = 0;
let isSyncInProgress = false;
const SYNC_DEBOUNCE_MS = 5_000;

const MESSAGE_BATCH_DELAY_MS = 50;
const CHAT_UPDATE_BATCH_DELAY_MS = 100;
const MAX_MESSAGE_BATCH_SIZE = 500;
const MAX_CHAT_UPDATE_BATCH_SIZE = 200;
const MAX_PENDING_CHATS = 100;
const MAX_PENDING_MESSAGES_PER_CHAT = 200;
const KANBAN_FILTERED_REFRESH_DEBOUNCE_MS = 700;

interface SocketLifecycleScope {
  accountId: string;
  generation: number;
}

interface ScopedBatchItem<T> extends SocketLifecycleScope {
  payload: T;
}

let messageBatchBuffer: Array<ScopedBatchItem<IChatMessage>> = [];
let messageBatchTimer: ReturnType<typeof setTimeout> | null = null;
let chatUpdateBatchBuffer: Array<ScopedBatchItem<IChat>> = [];
let chatUpdateBatchTimer: ReturnType<typeof setTimeout> | null = null;
let kanbanFilteredRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHandler: (() => void) | null = null;
let removeLifecycleListener: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let lifecycleGeneration = 0;
let isStopped = true;
let forceSyncRequested = false;
let activeChatUpdateFlushes = 0;
const chatUpdateFlushWaiters = new Set<() => void>();
const syncCompletionWaiters = new Set<() => void>();

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;

const createChatSocket = () => {
  const chatStore = useChatStore();
  const route = useRoute();
  const { handleNewMessage, handleChatStatusChange, handleChatTransfer } =
    useChatNotifications();

  const isScopeCurrent = (scope: SocketLifecycleScope): boolean =>
    !isStopped &&
    lifecycleGeneration === scope.generation &&
    chatStore.user?.account_id === scope.accountId;

  const capturePublicationScope = (): SocketLifecycleScope | null => {
    const accountId = initializedAccountId ?? initializingAccountId;
    if (!accountId) {
      return null;
    }

    const scope = { accountId, generation: lifecycleGeneration };
    return isScopeCurrent(scope) ? scope : null;
  };

  const waitForSyncCompletion = async (): Promise<void> => {
    if (!isSyncInProgress) {
      return;
    }

    await new Promise<void>((resolve) => {
      syncCompletionWaiters.add(resolve);
    });
  };

  const waitForChatUpdateFlushes = async (): Promise<void> => {
    if (activeChatUpdateFlushes === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      chatUpdateFlushWaiters.add(resolve);
    });
  };

  const isChatOrKanbanRoute = () => {
    const name = route.name as string | undefined;
    return name === 'chat' || name === 'kanban';
  };

  const processPendingMessages = async (chatId: string) => {
    const messages = pendingMessages.value.get(chatId);
    if (!messages || messages.length === 0) return;

    for (const message of messages) {
      chatStore.addMessageActiveChat(message);
    }

    pendingMessages.value.delete(chatId);
  };

  const processPendingChatUpdates = async (chatId: string) => {
    const updates = pendingChatUpdates.value.get(chatId);
    if (!updates || updates.length === 0) return;

    const newestUpdate = updates.reduce<IChat | null>(
      (selected, update) => selectNewestChatSnapshotRevision(selected, update),
      null
    );
    if (newestUpdate) {
      chatStore.addChat(newestUpdate);
    }

    pendingChatUpdates.value.delete(chatId);
  };

  const refreshActiveChat = async (
    expectedScope?: SocketLifecycleScope
  ): Promise<boolean> => {
    if (expectedScope && !isScopeCurrent(expectedScope)) {
      return false;
    }

    if (!isChatOrKanbanRoute() || !chatStore.activeChat?.chat_id) {
      return true;
    }

    const chatId = chatStore.activeChat.chat_id;

    await Promise.all([
      processPendingMessages(chatId),
      processPendingChatUpdates(chatId),
    ]);

    if (expectedScope && !isScopeCurrent(expectedScope)) {
      return false;
    }

    const requestQueue: ListMessageChatsQuery = {
      current_page: 1,
      per_page: 100,
    };
    const loaded = await chatStore.getChatById(requestQueue, chatId, {
      preserveMessages: true,
      skipLoading: true,
    });

    return expectedScope && !isScopeCurrent(expectedScope) ? false : loaded;
  };

  const syncFromApiFallback = async (
    expectedScope: SocketLifecycleScope
  ): Promise<boolean> => {
    if (!isScopeCurrent(expectedScope)) {
      return false;
    }

    try {
      const refreshPrimaryView =
        route.name === 'kanban'
          ? chatStore.loadKanbanInitial()
          : chatStore.reloadAllChatLists();

      const [primaryViewLoaded, , , activeChatLoaded] = await Promise.all([
        refreshPrimaryView,
        chatStore.loadPinnedChats(),
        chatStore.viewUnreadSummary(),
        refreshActiveChat(expectedScope),
      ]);
      return (
        isScopeCurrent(expectedScope) && primaryViewLoaded && activeChatLoaded
      );
    } catch {
      return false;
    }
  };

  const syncFromCentrifugoHistory = async (
    options: { force?: boolean } = {}
  ) => {
    const accountId = chatStore.user?.account_id;
    if (!accountId) {
      return;
    }

    if (isSyncInProgress) {
      if (options.force) {
        forceSyncRequested = true;
      }
      return;
    }

    const now = Date.now();
    if (!options.force && now - lastSyncTime < SYNC_DEBOUNCE_MS) {
      return;
    }

    const syncScope: SocketLifecycleScope = {
      accountId,
      generation: lifecycleGeneration,
    };
    if (!isScopeCurrent(syncScope)) {
      return;
    }

    lastSyncTime = now;
    isSyncInProgress = true;

    try {
      const channels = [
        chatAccountCentrifugo(accountId),
        chatQueueAccountCentrifugo(accountId),
      ];
      const historyResults = await Promise.all(
        channels.map((channel) => fetchHistoryAndProcess(channel))
      );
      if (!isScopeCurrent(syncScope)) {
        return;
      }

      const fallbackChannels = channels.filter(
        (_, index) => historyResults[index]?.requiresFallback
      );

      if (fallbackChannels.length === 0) {
        return;
      }

      const fallbackSucceeded = await syncFromApiFallback(syncScope);
      if (!fallbackSucceeded || !isScopeCurrent(syncScope)) {
        return;
      }

      const acknowledgedChannels = fallbackChannels.filter((channel) =>
        acknowledgeRecoveryFallback(channel)
      );

      if (acknowledgedChannels.length === 0) {
        isInitialized = false;
        scheduleRetry();
        return;
      }

      // Cover the API race window: publications after the captured fallback
      // baseline are replayed only after the authoritative state is loaded.
      const catchUpResults = await Promise.all(
        acknowledgedChannels.map((channel) => fetchHistoryAndProcess(channel))
      );
      if (!isScopeCurrent(syncScope)) {
        return;
      }

      const failedCatchUp = catchUpResults.filter(
        (result) => result.requiresFallback
      );
      if (failedCatchUp.some((result) => result.reason === 'not_subscribed')) {
        isInitialized = false;
        scheduleRetry();
      }
    } catch {
      // A later realtime lifecycle or visibility event retries reconciliation.
    } finally {
      isSyncInProgress = false;
      for (const resolve of syncCompletionWaiters) {
        resolve();
      }
      syncCompletionWaiters.clear();

      if (forceSyncRequested && isScopeCurrent(syncScope)) {
        forceSyncRequested = false;
        void syncFromCentrifugoHistory({ force: true });
      } else if (!isScopeCurrent(syncScope)) {
        forceSyncRequested = false;
      }
    }
  };

  const handleRecoveryFailed = (channel: string) => {
    if (import.meta.env.DEV) {
      console.warn('[ChatSocket] Recovery failed for channel:', channel);
    }
    void syncFromCentrifugoHistory({ force: true });
  };

  const scheduleKanbanFilteredRefresh = () => {
    const scheduledScope = capturePublicationScope();
    if (route.name !== 'kanban' || !chatStore.hasActiveKanbanFilters()) {
      return;
    }
    if (!scheduledScope) {
      return;
    }

    if (kanbanFilteredRefreshTimer) {
      clearTimeout(kanbanFilteredRefreshTimer);
      kanbanFilteredRefreshTimer = null;
    }

    kanbanFilteredRefreshTimer = setTimeout(() => {
      kanbanFilteredRefreshTimer = null;

      if (
        !isScopeCurrent(scheduledScope) ||
        route.name !== 'kanban' ||
        !chatStore.hasActiveKanbanFilters()
      ) {
        return;
      }

      void chatStore.loadKanbanInitial().catch(() => {});
    }, KANBAN_FILTERED_REFRESH_DEBOUNCE_MS);
  };

  const evictPendingMessages = (chatId: string, messages: IChatMessage[]) => {
    if (messages.length > MAX_PENDING_MESSAGES_PER_CHAT) {
      messages.splice(0, messages.length - MAX_PENDING_MESSAGES_PER_CHAT);
    }
    pendingMessages.value.set(chatId, messages);

    if (pendingMessages.value.size > MAX_PENDING_CHATS) {
      const keys = Array.from(pendingMessages.value.keys());
      const activeChatId = chatStore.activeChat?.chat_id;
      const toRemove = keys
        .filter((k) => k !== activeChatId)
        .slice(0, keys.length - MAX_PENDING_CHATS);
      for (const key of toRemove) {
        pendingMessages.value.delete(key);
      }
    }
  };

  const evictPendingChatUpdates = (chatId: string, updates: IChat[]) => {
    if (updates.length > MAX_PENDING_MESSAGES_PER_CHAT) {
      updates.splice(0, updates.length - MAX_PENDING_MESSAGES_PER_CHAT);
    }
    pendingChatUpdates.value.set(chatId, updates);

    if (pendingChatUpdates.value.size > MAX_PENDING_CHATS) {
      const keys = Array.from(pendingChatUpdates.value.keys());
      const activeChatId = chatStore.activeChat?.chat_id;
      const toRemove = keys
        .filter((k) => k !== activeChatId)
        .slice(0, keys.length - MAX_PENDING_CHATS);
      for (const key of toRemove) {
        pendingChatUpdates.value.delete(key);
      }
    }
  };

  const flushMessageBatch = () => {
    if (messageBatchBuffer.length === 0) return;

    const batchItems = [...messageBatchBuffer];
    messageBatchBuffer = [];
    messageBatchTimer = null;
    const currentItems = batchItems.filter(isScopeCurrent);
    if (currentItems.length === 0) {
      return;
    }

    const messages = currentItems.map(({ payload }) => payload);

    const messagesByChat = new Map<string, IChatMessage[]>();
    for (const msg of messages) {
      const chatId = msg.chat_id;
      const chatMessages = messagesByChat.get(chatId) ?? [];
      chatMessages.push(msg);
      messagesByChat.set(chatId, chatMessages);
    }

    for (const [chatId, chatMessages] of messagesByChat) {
      const isActiveChat =
        isChatOrKanbanRoute() && chatStore.activeChat?.chat_id === chatId;

      if (isActiveChat) {
        const touchedMessageIds = new Set<string>();
        for (const msg of chatMessages) {
          const changeType = chatStore.addMessageActiveChat(msg);
          if (changeType !== 'unchanged') {
            touchedMessageIds.add(msg.message_id);
          }
        }

        const updatedMessages = chatStore.listMessages.filter((msg) =>
          touchedMessageIds.has(msg.message_id)
        );

        if (updatedMessages.length > 0) {
          globalThis.dispatchEvent(
            new CustomEvent('chat-messages-batch', {
              detail: { messages: updatedMessages },
            })
          );
        }
      } else {
        for (const msg of chatMessages) {
          handleNewMessage(msg);
        }
      }

      const pending = pendingMessages.value.get(chatId) ?? [];
      pending.push(...chatMessages);
      evictPendingMessages(chatId, pending);
    }
  };

  const flushChatUpdateBatch = async (shouldScheduleKanbanRefresh = true) => {
    if (chatUpdateBatchBuffer.length === 0) return;

    const batchItems = [...chatUpdateBatchBuffer];
    chatUpdateBatchBuffer = [];
    chatUpdateBatchTimer = null;
    const currentItems = batchItems.filter(isScopeCurrent);
    if (currentItems.length === 0) {
      return;
    }

    const batchScope: SocketLifecycleScope = {
      accountId: currentItems[0].accountId,
      generation: currentItems[0].generation,
    };
    const updates = currentItems.map(({ payload }) => payload);

    activeChatUpdateFlushes += 1;

    try {
      const latestByChatId = new Map<string, IChat>();
      for (const chat of updates) {
        latestByChatId.set(
          chat.chat_id,
          selectNewestChatSnapshotRevision(
            latestByChatId.get(chat.chat_id),
            chat
          )
        );
      }

      for (const chatData of latestByChatId.values()) {
        if (!isScopeCurrent(batchScope)) {
          return;
        }

        if (chatStore.isActiveChatSummaryOnlyUpdate(chatData)) {
          chatStore.reconcileUnreadSummaryFromChat(chatData);
          chatStore.clearActiveChatUnreadCountLocally();
          continue;
        }

        const previousChat =
          chatStore.findChatInLists(chatData.chat_id) ??
          (chatStore.activeChat?.chat_id === chatData.chat_id
            ? chatStore.activeChat
            : null);
        const previousChatSnapshot = previousChat
          ? ({
              ...previousChat,
              secondary_users: Array.isArray(previousChat.secondary_users)
                ? [...previousChat.secondary_users]
                : [],
            } as IChat)
          : null;
        const previousStatus = previousChatSnapshot?.status ?? null;

        const isActiveChat =
          isChatOrKanbanRoute() &&
          chatStore.activeChat?.chat_id === chatData.chat_id;

        chatStore.reconcileUnreadSummaryFromChat(chatData);
        chatStore.addChat(chatData);

        if (!isActiveChat) {
          const handledTransfer = await handleChatTransfer(
            chatData,
            previousChatSnapshot
          );

          if (!isScopeCurrent(batchScope)) {
            return;
          }

          if (!handledTransfer) {
            handleChatStatusChange(chatData, previousStatus);
          }
        }

        if (
          isActiveChat &&
          chatData.status === EChatStatus.in_chat &&
          isChatParticipant(chatData, chatStore.user?.user_id)
        ) {
          chatStore.clearActiveChatUnreadCountLocally();
        }

        if (
          isChatOrKanbanRoute() &&
          (chatData as any)._active &&
          isChatParticipant(chatData, chatStore.user?.user_id)
        ) {
          if (chatStore.activeChat?.chat_id !== chatData.chat_id) {
            chatStore.setActiveChat(chatData.chat_id);
            await refreshActiveChat(batchScope);
          } else {
            await Promise.all([
              processPendingMessages(chatData.chat_id),
              processPendingChatUpdates(chatData.chat_id),
            ]);
          }

          if (!isScopeCurrent(batchScope)) {
            return;
          }
        }

        const chatId = chatData.chat_id;
        const pendingUpdates = pendingChatUpdates.value.get(chatId) ?? [];
        pendingUpdates.push(chatData);
        evictPendingChatUpdates(chatId, pendingUpdates);
      }

      if (!isScopeCurrent(batchScope)) {
        return;
      }

      if (shouldScheduleKanbanRefresh) {
        scheduleKanbanFilteredRefresh();
      }
    } finally {
      activeChatUpdateFlushes -= 1;
      if (activeChatUpdateFlushes === 0) {
        for (const resolve of chatUpdateFlushWaiters) {
          resolve();
        }
        chatUpdateFlushWaiters.clear();
      }
    }
  };

  /**
   * BUG 1 FIX: Changed from debounce to throttle pattern.
   * The timer is only started if none is running. New messages accumulate in the buffer
   * and get flushed when the timer fires. Under high load, messages are never starved.
   * Additionally, a max buffer size forces immediate flush to prevent unbounded growth.
   */
  const handleMessageEvent = (
    messageData: IChatMessage,
    scope: SocketLifecycleScope
  ): void => {
    messageBatchBuffer.push({ ...scope, payload: messageData });

    if (messageBatchBuffer.length >= MAX_MESSAGE_BATCH_SIZE) {
      if (messageBatchTimer) {
        clearTimeout(messageBatchTimer);
        messageBatchTimer = null;
      }
      flushMessageBatch();
      return;
    }

    if (!messageBatchTimer) {
      messageBatchTimer = setTimeout(flushMessageBatch, MESSAGE_BATCH_DELAY_MS);
    }
  };

  /**
   * BUG 1 FIX: Same throttle pattern for chat updates.
   */
  const handleChatUpdateEvent = (
    chatData: IChat,
    scope: SocketLifecycleScope
  ): void => {
    chatUpdateBatchBuffer.push({ ...scope, payload: chatData });

    if (chatUpdateBatchBuffer.length >= MAX_CHAT_UPDATE_BATCH_SIZE) {
      if (chatUpdateBatchTimer) {
        clearTimeout(chatUpdateBatchTimer);
        chatUpdateBatchTimer = null;
      }
      void flushChatUpdateBatch();
      return;
    }

    if (!chatUpdateBatchTimer) {
      chatUpdateBatchTimer = setTimeout(() => {
        void flushChatUpdateBatch();
      }, CHAT_UPDATE_BATCH_DELAY_MS);
    }
  };

  const clearBatchTimers = () => {
    if (messageBatchTimer) {
      clearTimeout(messageBatchTimer);
      messageBatchTimer = null;
    }
    if (chatUpdateBatchTimer) {
      clearTimeout(chatUpdateBatchTimer);
      chatUpdateBatchTimer = null;
    }
    if (kanbanFilteredRefreshTimer) {
      clearTimeout(kanbanFilteredRefreshTimer);
      kanbanFilteredRefreshTimer = null;
    }
    messageBatchBuffer = [];
    chatUpdateBatchBuffer = [];
  };

  const removeVisibilityHandler = () => {
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  };

  const handleAccountPublication = (
    data: IChatMessage | IChatTyping | IChat | any
  ): void => {
    const scope = capturePublicationScope();
    if (!scope) {
      return;
    }

    if ('type' in data && data.type === 'typing') {
      globalThis.dispatchEvent(
        new CustomEvent('chat-typing', { detail: data })
      );
      return;
    }

    if ('message_id' in data) {
      handleMessageEvent(data as IChatMessage, scope);
      return;
    }

    if ('chat_id' in data && !('message_id' in data)) {
      handleChatUpdateEvent(data as IChat, scope);
    }
  };

  const handleQueuePublication = (data: IChat): void => {
    if (!capturePublicationScope()) {
      return;
    }

    if (chatStore.isActiveChatSummaryOnlyUpdate(data)) {
      chatStore.reconcileUnreadSummaryFromChat(data);
      chatStore.clearActiveChatUnreadCountLocally();
      return;
    }

    const isActiveChat =
      isChatOrKanbanRoute() && chatStore.activeChat?.chat_id === data.chat_id;

    chatStore.reconcileUnreadSummaryFromChat(data);
    chatStore.addChat(data);
    scheduleKanbanFilteredRefresh();

    if (
      isActiveChat &&
      data.status === EChatStatus.in_chat &&
      isChatParticipant(data, chatStore.user?.user_id)
    ) {
      chatStore.clearActiveChatUnreadCountLocally();
    }
  };

  const clearRetryTimer = (resetAttempt = false): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    if (resetAttempt) {
      retryAttempt = 0;
    }
  };

  const scheduleRetry = (): void => {
    if (isStopped || retryTimer || !chatStore.user?.account_id) {
      return;
    }

    const delay = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** retryAttempt,
      RETRY_MAX_DELAY_MS
    );
    retryAttempt = Math.min(retryAttempt + 1, 10);

    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!isStopped) {
        void initializeSocket();
      }
    }, delay);
  };

  const handleLifecycleEvent = (event: CentrifugoLifecycleEvent): void => {
    const accountId = chatStore.user?.account_id;
    if (!accountId || isStopped || event.type === 'connected') {
      return;
    }

    if (
      'channel' in event &&
      event.channel !== chatAccountCentrifugo(accountId) &&
      event.channel !== chatQueueAccountCentrifugo(accountId)
    ) {
      return;
    }

    if (event.type === 'recovery_failed') {
      handleRecoveryFailed(event.channel);
      return;
    }

    isInitialized = false;
    scheduleRetry();
  };

  const installLifecycleListener = (): void => {
    if (!removeLifecycleListener) {
      removeLifecycleListener =
        addCentrifugoLifecycleListener(handleLifecycleEvent);
    }
  };

  const teardownSubscriptions = async (
    options: { resetPending?: boolean } = {}
  ): Promise<void> => {
    clearBatchTimers();
    removeVisibilityHandler();
    const activeSubscriptions = subscriptions;
    subscriptions = [];
    const accountIds = new Set(
      [initializedAccountId, initializingAccountId].filter(
        (accountId): accountId is string => Boolean(accountId)
      )
    );
    const currentAccountId = chatStore.user?.account_id ?? null;
    const isAccountTransition = Array.from(accountIds).some(
      (accountId) => accountId !== currentAccountId
    );

    const unsubscribePromises = [
      ...activeSubscriptions.map((sub) => sub.unsubscribe()),
      ...Array.from(accountIds).flatMap((accountId) => [
        unsubscribe(chatAccountCentrifugo(accountId), handleAccountPublication),
        unsubscribe(
          chatQueueAccountCentrifugo(accountId),
          handleQueuePublication
        ),
      ]),
    ].map((unsubscribePromise) =>
      unsubscribePromise.catch((error) => {
        if (import.meta.env.DEV) {
          console.error('Erro ao fazer unsubscribe:', error);
        }
      })
    );

    await Promise.all(unsubscribePromises);
    await Promise.all([waitForChatUpdateFlushes(), waitForSyncCompletion()]);

    isInitialized = false;
    initializedAccountId = null;
    forceSyncRequested = false;
    lastSyncTime = 0;

    if (options.resetPending || isAccountTransition) {
      pendingMessages.value.clear();
      pendingChatUpdates.value.clear();
    }
  };

  const initializeSocket = async () => {
    if (!chatStore.user?.account_id) {
      return;
    }

    isStopped = false;
    installLifecycleListener();

    const accountId = chatStore.user.account_id;
    const previousAccountId = initializedAccountId ?? initializingAccountId;
    const isAccountTransition = Boolean(
      previousAccountId && previousAccountId !== accountId
    );

    if (initializingPromise) {
      if (initializingAccountId === accountId) {
        return initializingPromise;
      }

      lifecycleGeneration++;
      await initializingPromise;

      if (isStopped) {
        return;
      }
    }

    const allSubscriptionsActive =
      initializedAccountId === accountId &&
      subscriptions.length === 2 &&
      subscriptions.every((sub) => isChannelSubscribed(sub.channel));

    if (allSubscriptionsActive) {
      isInitialized = true;
      clearRetryTimer(true);
      lastSyncTime = 0;
      void syncFromCentrifugoHistory({ force: true });
      return;
    }

    if (subscriptions.length > 0 || initializedAccountId !== accountId) {
      lifecycleGeneration++;
      await teardownSubscriptions();
    }

    const attemptGeneration = lifecycleGeneration;
    initializingAccountId = accountId;

    const attempt = (async () => {
      try {
        const accountChannel = chatAccountCentrifugo(accountId);
        const queueChannel = chatQueueAccountCentrifugo(accountId);

        await onMessage(accountChannel, handleAccountPublication);
        if (isStopped || lifecycleGeneration !== attemptGeneration) {
          await unsubscribe(accountChannel, handleAccountPublication);
          return;
        }
        subscriptions.push({
          channel: accountChannel,
          unsubscribe: () =>
            unsubscribe(accountChannel, handleAccountPublication),
        });

        await onMessage(queueChannel, handleQueuePublication);
        if (isStopped || lifecycleGeneration !== attemptGeneration) {
          await unsubscribe(queueChannel, handleQueuePublication);
          return;
        }
        subscriptions.push({
          channel: queueChannel,
          unsubscribe: () => unsubscribe(queueChannel, handleQueuePublication),
        });

        isInitialized = true;
        initializedAccountId = accountId;
        clearRetryTimer(true);

        if (isAccountTransition) {
          await syncFromApiFallback({
            accountId,
            generation: attemptGeneration,
          });
          if (isStopped || lifecycleGeneration !== attemptGeneration) {
            return;
          }
        }

        removeVisibilityHandler();
        visibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            lastSyncTime = 0;
            void syncFromCentrifugoHistory({ force: true });
          }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        void syncFromCentrifugoHistory({ force: true });
      } catch (error) {
        isInitialized = false;
        initializedAccountId = null;
        await teardownSubscriptions();

        if (!isStopped && lifecycleGeneration === attemptGeneration) {
          scheduleRetry();
        }

        if (import.meta.env.DEV) {
          console.error('Erro ao inicializar socket de chat:', error);
        }
      }
    })();

    initializingPromise = attempt;

    try {
      await attempt;
    } finally {
      if (initializingPromise === attempt) {
        initializingPromise = null;
        initializingAccountId = null;
      }
    }
  };

  const cleanup = async () => {
    isStopped = true;
    lifecycleGeneration++;
    clearRetryTimer(true);

    const inFlightInitialization = initializingPromise;
    await teardownSubscriptions({ resetPending: true });

    if (inFlightInitialization) {
      await inFlightInitialization.catch(() => {});
      await teardownSubscriptions({ resetPending: true });
    }

    if (removeLifecycleListener) {
      removeLifecycleListener();
      removeLifecycleListener = null;
    }

    initializingPromise = null;
    initializingAccountId = null;
  };

  return {
    initializeSocket,
    cleanup,
    refreshActiveChat,
    processPendingMessages,
    processPendingChatUpdates,
    isInitialized: () =>
      isInitialized &&
      initializedAccountId === chatStore.user?.account_id &&
      subscriptions.length === 2 &&
      subscriptions.every((sub) => isChannelSubscribed(sub.channel)),
    syncFromCentrifugoHistory,
  };
};

let socketInstance: ReturnType<typeof createChatSocket> | null = null;

export const useChatSocket = () => {
  if (!socketInstance) {
    socketInstance = createChatSocket();
  }
  return socketInstance;
};
