export type UserAttendanceHoursWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface IUserAttendanceHoursRule {
  weekday: UserAttendanceHoursWeekday;
  start_time: string;
  end_time: string;
}

export interface IUserAttendanceGuardStatus {
  timezone: string;
  is_restricted_today: boolean;
  is_blocked_now: boolean;
  today_rules: IUserAttendanceHoursRule[];
  today_windows_label: string | null;
  next_transition_at: string | null;
  next_unlock_at: string | null;
  next_lock_at: string | null;
  server_now: string;
}
