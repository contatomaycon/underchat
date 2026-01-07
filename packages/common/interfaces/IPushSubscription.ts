export interface IPushSubscription {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}
