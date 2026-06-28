import type { Ref } from 'vue';
import axiosAuth from '@/@webcore/axios';

const SERVICE_WORKER_PATH = '/service-worker.js';
const SERVICE_WORKER_SCOPE = '/';
const VAPID_PUBLIC_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

type ServiceWorkerRegistrationRef = Ref<ServiceWorkerRegistration | null>;

type SyncWebPushSubscriptionOptions = {
  serviceWorkerRegistration?: ServiceWorkerRegistrationRef;
  isPushEnabled: () => boolean;
  shouldKeepSubscription?: () => boolean;
};

type UnsubscribeWebPushOptions = {
  serviceWorkerRegistration?: ServiceWorkerRegistrationRef;
};

let cachedVapidPublicKey: string | null = null;
let cachedVapidPublicKeyExpiresAt = 0;
let pendingVapidPublicKeyRequest: Promise<string> | null = null;

function canUseServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

function canUsePushManager(): boolean {
  return canUseServiceWorker() && 'PushManager' in globalThis;
}

function clearCachedVapidPublicKey(): void {
  cachedVapidPublicKey = null;
  cachedVapidPublicKeyExpiresAt = 0;
}

async function getCachedVapidPublicKey(): Promise<string> {
  const now = Date.now();

  if (cachedVapidPublicKey && now < cachedVapidPublicKeyExpiresAt) {
    return cachedVapidPublicKey;
  }

  if (pendingVapidPublicKeyRequest) {
    return pendingVapidPublicKeyRequest;
  }

  pendingVapidPublicKeyRequest = (async () => {
    const response = await axiosAuth.get('/push/public-key', {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    const publicKey = response?.data?.data?.public_key;

    if (typeof publicKey !== 'string' || publicKey.length === 0) {
      throw new Error('Invalid push public key response');
    }

    cachedVapidPublicKey = publicKey;
    cachedVapidPublicKeyExpiresAt = Date.now() + VAPID_PUBLIC_KEY_CACHE_TTL_MS;

    return publicKey;
  })();

  try {
    return await pendingVapidPublicKeyRequest;
  } catch (error) {
    clearCachedVapidPublicKey();
    throw error;
  } finally {
    pendingVapidPublicKeyRequest = null;
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = globalThis.atob(base64);
  const bytes = Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return globalThis.btoa(binary);
}

function bufferSourceToArrayBuffer(
  value?: BufferSource | null
): ArrayBuffer | null {
  if (!value) {
    return null;
  }

  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (!ArrayBuffer.isView(value)) {
    return null;
  }

  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  return arrayBufferToBase64(buffer)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizeBase64Url(value: string): string {
  return value
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function isSubscriptionUsingPublicKey(
  subscription: PushSubscription,
  publicKey: string
): boolean {
  const subscriptionKey = bufferSourceToArrayBuffer(
    subscription.options?.applicationServerKey
  );

  if (!subscriptionKey) {
    return false;
  }

  return (
    arrayBufferToBase64Url(subscriptionKey) === normalizeBase64Url(publicKey)
  );
}

function getSubscriptionPayload(subscription: PushSubscription) {
  const p256dh = arrayBufferToBase64(subscription.getKey('p256dh'));
  const auth = arrayBufferToBase64(subscription.getKey('auth'));

  if (!p256dh || !auth) {
    return null;
  }

  return {
    provider: 'webpush' as const,
    platform: 'web' as const,
    endpoint: subscription.endpoint,
    keys: {
      p256dh,
      auth,
    },
    user_agent: navigator.userAgent,
  };
}

async function getKnownRegistration(
  registrationRef?: ServiceWorkerRegistrationRef
): Promise<ServiceWorkerRegistration | null> {
  if (registrationRef?.value) {
    return registrationRef.value;
  }

  if (!canUseServiceWorker()) {
    return null;
  }

  const registration = await navigator.serviceWorker.getRegistration();

  if (registrationRef && registration) {
    registrationRef.value = registration;
  }

  return registration ?? null;
}

export async function registerWebServiceWorker(
  registrationRef?: ServiceWorkerRegistrationRef
): Promise<ServiceWorkerRegistration | null> {
  if (!canUseServiceWorker()) {
    return null;
  }

  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
      scope: SERVICE_WORKER_SCOPE,
      updateViaCache: 'none',
    });

    const registration = await navigator.serviceWorker.ready;

    if (registrationRef) {
      registrationRef.value = registration;
    }

    return registration;
  } catch {
    return null;
  }
}

export async function requestWebNotificationPermission(): Promise<boolean> {
  if (!('Notification' in globalThis)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'default') {
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  return false;
}

export function postWebNotificationClientState(
  payload: Record<string, unknown>
): void {
  if (!canUseServiceWorker()) {
    return;
  }

  navigator.serviceWorker.controller?.postMessage({
    type: 'notificationClientState',
    ...payload,
  });
}

export async function unsubscribeFromWebPushNotifications(
  options: UnsubscribeWebPushOptions = {}
): Promise<void> {
  if (!canUsePushManager()) {
    return;
  }

  try {
    const registration = await getKnownRegistration(
      options.serviceWorkerRegistration
    );

    if (!registration) {
      return;
    }

    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      return;
    }

    try {
      await axiosAuth.delete('/push/unsubscribe', {
        data: {
          endpoint: subscription.endpoint,
          provider: 'webpush',
        },
      });
    } catch {}

    await subscription.unsubscribe().catch(() => {});
  } catch {
    return;
  }
}

export async function syncWebPushSubscription(
  options: SyncWebPushSubscriptionOptions
): Promise<void> {
  if (!options.isPushEnabled()) {
    if (options.shouldKeepSubscription?.() === false) {
      await unsubscribeFromWebPushNotifications({
        serviceWorkerRegistration: options.serviceWorkerRegistration,
      });
    }
    return;
  }

  if (!canUsePushManager() || !('Notification' in globalThis)) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  const registration = await registerWebServiceWorker(
    options.serviceWorkerRegistration
  );

  if (!registration || !options.isPushEnabled()) {
    return;
  }

  let publicKey: string;

  try {
    publicKey = await getCachedVapidPublicKey();
  } catch {
    return;
  }

  if (!options.isPushEnabled()) {
    return;
  }

  let subscription = await registration.pushManager.getSubscription();
  const hasValidExistingSubscription =
    !!subscription &&
    isSubscriptionUsingPublicKey(subscription, publicKey) &&
    !!getSubscriptionPayload(subscription);

  if (subscription && !hasValidExistingSubscription) {
    await axiosAuth
      .delete('/push/unsubscribe', {
        data: {
          endpoint: subscription.endpoint,
          provider: 'webpush',
        },
      })
      .catch(() => {});
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }

  if (!subscription) {
    let convertedVapidKey: ArrayBuffer;

    try {
      convertedVapidKey = urlBase64ToUint8Array(publicKey);
    } catch {
      clearCachedVapidPublicKey();
      publicKey = await getCachedVapidPublicKey();
      convertedVapidKey = urlBase64ToUint8Array(publicKey);
    }

    if (!options.isPushEnabled()) {
      return;
    }

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey,
    });
  }

  if (!options.isPushEnabled()) {
    if (options.shouldKeepSubscription?.() === false) {
      await subscription.unsubscribe().catch(() => {});
    }
    return;
  }

  const subscriptionData = getSubscriptionPayload(subscription);

  if (!subscriptionData) {
    await subscription.unsubscribe().catch(() => {});
    return;
  }

  await axiosAuth.post('/push/subscribe', subscriptionData);
}
