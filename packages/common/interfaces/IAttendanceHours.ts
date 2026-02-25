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

export interface IAttendanceDayConfig {
  enabled: boolean;
  start_time: string | null;
  end_time: string | null;
}

export type IAttendanceDaysConfig = Record<
  AttendanceWeekday,
  IAttendanceDayConfig
>;

export interface IAttendanceHoursConfig {
  timezone: string;
  outside_hours_action: OutsideHoursAction;
  message_only_destination_status: MessageOnlyDestinationStatus;
  message_only_queue_sector_id: string | null;
  days: IAttendanceDaysConfig;
}
