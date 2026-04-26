export interface IAttendanceInactivityData {
  lastInteraction: number;
  alertCount: number;
  lastAlertTime: number | null;
  accountId: string;
  workerId: string;
  chatId: string;
}
