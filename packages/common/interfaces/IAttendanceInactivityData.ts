export type TAttendanceInactivityStage =
  'waiting_alert' | 'waiting_close' | 'finishing' | 'bootstrapping_output';

export interface IAttendanceInactivityData {
  lastInteraction: number;
  alertCount: number;
  lastAlertTime: number | null;
  lastHumanInteractor?: 'operator' | 'client' | null;
  accountId: string;
  workerId: string;
  chatId: string;
  /**
   * Fields below are optional so payloads written before the reliable
   * scheduler rollout remain readable. They are populated on the next write.
   */
  tracking_id?: string;
  retry_count?: number;
  stage?: TAttendanceInactivityStage;
  status_event_id?: string;
  target_status_event_id?: string;
  expected_status_event_id?: string | null;
  expected_status_epoch?: number | null;
  expected_started_at?: string | null;
  last_human_message_id?: string | null;
  finish_message_sent?: boolean;
  audit_message_sent?: boolean;
}
