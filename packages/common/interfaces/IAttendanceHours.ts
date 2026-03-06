export type AttendanceWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type OutsideHoursAction = 'continue_flow' | 'message_only';

export type MessageOnlyDestinationStatus = 'queue' | 'closed';

export interface IAttendanceHoursRule {
  weekday: AttendanceWeekday;
  start_time: string;
  end_time: string;
}

export interface IAttendanceHoursConfig {
  timezone: string;
  outside_hours_action: OutsideHoursAction;
  message_only_destination_status: MessageOnlyDestinationStatus;
  message_only_queue_sector_id: string | null;
  rules: IAttendanceHoursRule[];
}
