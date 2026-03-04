import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_ENDPOINT_KEY = '@underchat_push_endpoint';
const PUSH_PROVIDER_KEY = '@underchat_push_provider';

export type StoredPushSubscription = {
  endpoint: string;
  provider: 'expo';
};

export async function getStoredPushSubscription(): Promise<StoredPushSubscription | null> {
  const [endpoint, provider] = await Promise.all([
    AsyncStorage.getItem(PUSH_ENDPOINT_KEY),
    AsyncStorage.getItem(PUSH_PROVIDER_KEY),
  ]);

  if (!endpoint || provider !== 'expo') {
    return null;
  }

  return {
    endpoint,
    provider: 'expo',
  };
}

export async function setStoredPushSubscription(
  subscription: StoredPushSubscription
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(PUSH_ENDPOINT_KEY, subscription.endpoint),
    AsyncStorage.setItem(PUSH_PROVIDER_KEY, subscription.provider),
  ]);
}

export async function clearStoredPushSubscription(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(PUSH_ENDPOINT_KEY),
    AsyncStorage.removeItem(PUSH_PROVIDER_KEY),
  ]);
}
