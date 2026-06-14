self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.__underchatClientStates = self.__underchatClientStates || new Map();

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'notificationClientState' || !event.source?.id) {
    return;
  }

  const previousState = self.__underchatClientStates.get(event.source.id) || {};
  self.__underchatClientStates.set(event.source.id, {
    chatId: Object.prototype.hasOwnProperty.call(event.data, 'chatId')
      ? event.data.chatId || null
      : previousState.chatId || null,
    internalChatConversationId: Object.prototype.hasOwnProperty.call(
      event.data,
      'internalChatConversationId'
    )
      ? event.data.internalChatConversationId || null
      : previousState.internalChatConversationId || null,
    isVisible: event.data.isVisible === true,
    updatedAt: Date.now(),
  });
});

async function shouldSuppressNotification(options) {
  const data = options.data || {};
  const chatId = data.chatId || null;
  const internalChatConversationId = data.internalChatConversationId || null;

  if (!chatId && !internalChatConversationId) {
    return false;
  }

  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  for (const client of clientList) {
    const state = self.__underchatClientStates.get(client.id);
    const isVisible =
      state?.isVisible === true || client.visibilityState === 'visible';

    if (!isVisible) {
      continue;
    }

    if (chatId && state?.chatId === chatId) {
      return true;
    }

    if (
      internalChatConversationId &&
      state?.internalChatConversationId === internalChatConversationId
    ) {
      return true;
    }
  }

  return false;
}

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  const data = event.data.json();
  const { title, options = {} } = data;

  event.waitUntil(
    (async () => {
      const notificationOptions = {
        ...options,
        badge: options.badge || '/favicon.ico',
        icon: options.icon || '/favicon.ico',
      };

      if (await shouldSuppressNotification(notificationOptions)) {
        return;
      }

      await self.registration.showNotification(title, notificationOptions);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const chatId = data.chatId;
  const internalChatConversationId = data.internalChatConversationId;
  const notificationType = data.notificationType;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        if (clientList.length > 0) {
          const client = clientList[0];
          if (internalChatConversationId) {
            client.postMessage({
              type: 'navigateToInternalChat',
              conversationId: internalChatConversationId,
            });
          } else if (chatId) {
            client.postMessage({
              type: 'navigateToChat',
              chatId,
              notificationType,
            });
          }
          return client.focus().catch(() => {});
        }

        if (self.clients.openWindow) {
          const url = internalChatConversationId
            ? `/internal-chat?conversation_id=${internalChatConversationId}`
            : chatId
              ? `/chat?chat_id=${chatId}`
              : '/';
          return self.clients.openWindow(url);
        }
      })
      .catch(() => {})
  );
});
