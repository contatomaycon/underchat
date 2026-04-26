export interface IAttendanceInactivityAlertConfig {
  quantity: number;
  time: number;
  action: 'finish';
  inactivity_message_enabled: boolean;
  inactivity_message: string | null;
}
