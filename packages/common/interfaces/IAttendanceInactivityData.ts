export interface IAttendanceInactivityData {
  lastInteraction: number;
  alertCount: number;
  lastAlertTime: number | null;
  lastHumanInteractor?: 'operator' | 'client' | null;
  accountId: string;
  workerId: string;
  chatId: string;
}
