self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  const data = event.data.json();
  const { title, options = {} } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      ...options,
      badge: options.badge || '/favicon.ico',
      icon: options.icon || '/favicon.ico',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const chatId = data.chatId;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        if (clientList.length > 0) {
          const client = clientList[0];
          if (chatId) {
            client.postMessage({ type: 'navigateToChat', chatId });
          }
          return client.focus().catch(() => {});
        }

        if (self.clients.openWindow) {
          const url = chatId ? `/chat?chat_id=${chatId}` : '/';
          return self.clients.openWindow(url);
        }
      })
      .catch(() => {})
  );
});
