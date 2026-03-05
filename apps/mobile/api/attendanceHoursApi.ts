import { apiGet } from './client';
import type { AttendanceGuardStatus } from '../types/attendanceHours';

export async function getAttendanceHoursStatus(): Promise<AttendanceGuardStatus | null> {
  const response = await apiGet<AttendanceGuardStatus>(
    '/user/me/attendance-hours/status'
  );

  if (!response?.status || !response.data) {
    return null;
  }

  return response.data;
}
