import { IPushNotificationPayload } from './IPushNotificationPayload';
import { PushSubscriptionProvider } from './IPushSubscription';

export type MobilePushSubscriptionProvider = Extract<
  PushSubscriptionProvider,
  'expo' | 'fcm' | 'apns'
>;

export type PushDeliveryStatus =
  | 'success'
  | 'temporary_failure'
  | 'permanent_failure';

export interface IPushDeliveryResult {
  status: PushDeliveryStatus;
  reason?: string;
}

export interface IPushDeliveryJob {
  id: string;
  userId: string;
  provider: MobilePushSubscriptionProvider;
  endpoint: string;
  payload: IPushNotificationPayload;
  attempt: number;
  createdAt: number;
  fallbackExpoEndpoint?: string;
}

export interface IPushDeliveryInput {
  userId: string;
  provider: MobilePushSubscriptionProvider;
  endpoint: string;
  payload: IPushNotificationPayload;
  fallbackExpoEndpoint?: string;
}
