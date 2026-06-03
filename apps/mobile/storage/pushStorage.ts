import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_ENDPOINT_KEY = '@underchat_push_endpoint';
const PUSH_PROVIDER_KEY = '@underchat_push_provider';
const PUSH_SUBSCRIPTIONS_KEY = '@underchat_push_subscriptions';

export type StoredPushSubscription = {
  endpoint: string;
  provider: 'expo' | 'fcm' | 'apns';
};

function parseStoredSubscriptions(
  value: string | null
): StoredPushSubscription[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is StoredPushSubscription =>
        !!item &&
        typeof item === 'object' &&
        'endpoint' in item &&
        'provider' in item &&
        typeof item.endpoint === 'string' &&
        (item.provider === 'expo' ||
          item.provider === 'fcm' ||
          item.provider === 'apns')
    );
  } catch {
    return [];
  }
}

export async function getStoredPushSubscriptions(): Promise<
  StoredPushSubscription[]
> {
  const subscriptions = parseStoredSubscriptions(
    await AsyncStorage.getItem(PUSH_SUBSCRIPTIONS_KEY)
  );
  if (subscriptions.length > 0) {
    return subscriptions;
  }

  const [endpoint, provider] = await Promise.all([
    AsyncStorage.getItem(PUSH_ENDPOINT_KEY),
    AsyncStorage.getItem(PUSH_PROVIDER_KEY),
  ]);

  if (!endpoint || provider !== 'expo') {
    return [];
  }

  return [{ endpoint, provider: 'expo' }];
}

export async function getStoredPushSubscription(): Promise<StoredPushSubscription | null> {
  const subscriptions = await getStoredPushSubscriptions();
  return subscriptions[0] ?? null;
}

export async function setStoredPushSubscriptions(
  subscriptions: StoredPushSubscription[]
): Promise<void> {
  const deduped = Array.from(
    new Map(
      subscriptions.map((subscription) => [
        `${subscription.provider}:${subscription.endpoint}`,
        subscription,
      ])
    ).values()
  );

  await Promise.all([
    AsyncStorage.setItem(PUSH_SUBSCRIPTIONS_KEY, JSON.stringify(deduped)),
    deduped[0]
      ? AsyncStorage.setItem(PUSH_ENDPOINT_KEY, deduped[0].endpoint)
      : AsyncStorage.removeItem(PUSH_ENDPOINT_KEY),
    deduped[0]
      ? AsyncStorage.setItem(PUSH_PROVIDER_KEY, deduped[0].provider)
      : AsyncStorage.removeItem(PUSH_PROVIDER_KEY),
  ]);
}

export async function setStoredPushSubscription(
  subscription: StoredPushSubscription
): Promise<void> {
  await setStoredPushSubscriptions([subscription]);
}

export async function clearStoredPushSubscription(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(PUSH_SUBSCRIPTIONS_KEY),
    AsyncStorage.removeItem(PUSH_ENDPOINT_KEY),
    AsyncStorage.removeItem(PUSH_PROVIDER_KEY),
  ]);
}
