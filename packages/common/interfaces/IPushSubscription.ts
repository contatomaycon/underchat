export type PushSubscriptionProvider = 'webpush' | 'expo';
export type PushSubscriptionPlatform = 'web' | 'ios' | 'android';

export interface IPushSubscription {
  user_id: string;
  provider: PushSubscriptionProvider;
  platform?: PushSubscriptionPlatform;
  endpoint: string;
  p256dh?: string | null;
  auth?: string | null;
  user_agent?: string;
}
