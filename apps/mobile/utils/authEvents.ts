import type { AttendanceBlockedPayload } from '../types/attendanceHours';

const listeners = new Set<() => void>();
const attendanceBlockedListeners = new Set<
  (payload: AttendanceBlockedPayload) => void
>();

export function addAuthUnauthorizedListener(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function emitAuthUnauthorized(): void {
  listeners.forEach((cb) => cb());
}

export function addAttendanceBlockedListener(
  callback: (payload: AttendanceBlockedPayload) => void
): () => void {
  attendanceBlockedListeners.add(callback);
  return () => attendanceBlockedListeners.delete(callback);
}

export function emitAttendanceBlocked(payload: AttendanceBlockedPayload): void {
  attendanceBlockedListeners.forEach((cb) => cb(payload));
}
