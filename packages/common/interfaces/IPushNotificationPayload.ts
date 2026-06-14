export interface IPushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  sound?: boolean;
  data?: Record<string, unknown>;
}
