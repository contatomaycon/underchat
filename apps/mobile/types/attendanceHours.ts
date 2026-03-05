export type AttendanceHoursWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface AttendanceHoursRule {
  weekday: AttendanceHoursWeekday;
  start_time: string;
  end_time: string;
}

export interface AttendanceGuardStatus {
  timezone: string;
  is_restricted_today: boolean;
  is_blocked_now: boolean;
  today_rules: AttendanceHoursRule[];
  today_windows_label: string | null;
  next_transition_at: string | null;
  next_unlock_at: string | null;
  next_lock_at: string | null;
  server_now: string;
}

export interface AttendanceBlockedPayload {
  reason: 'user_attendance_hours_blocked';
  attendance_guard: AttendanceGuardStatus;
  message?: string | null;
}
