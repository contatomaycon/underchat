export interface IInactivityData {
  lastInteraction: number;
  alertCount: number;
  lastAlertTime: number | null;
  chatbotId: string;
  accountId: string;
  workerId: string;
  chatId: string;
}
