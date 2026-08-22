export interface IInactivityData {
  lastInteraction: number;
  alertCount: number;
  lastAlertTime: number | null;
  chatbotId: string;
  accountId: string;
  workerId: string;
  chatId: string;
  trackingId?: string;
  retryCount?: number;
  stage?: 'waiting' | 'finishing';
  expectedLastMessageId?: string | null;
}
