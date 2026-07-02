import { EChatStatus } from '../enums/EChatStatus';

export const CHATBOT_STATUSES = [
  EChatStatus.ura,
  EChatStatus.ura_output,
  EChatStatus.ura_schedule,
  EChatStatus.ura_webhook,
] as const;

export const HUMAN_ATTENDANCE_STATUSES = [
  EChatStatus.queue,
  EChatStatus.in_chat,
] as const;

export function isChatbotStatus(
  status: EChatStatus | null | undefined
): boolean {
  return (
    status !== null &&
    status !== undefined &&
    CHATBOT_STATUSES.includes(status as (typeof CHATBOT_STATUSES)[number])
  );
}

export function isHumanAttendanceStatus(
  status: EChatStatus | null | undefined
): boolean {
  return (
    status !== null &&
    status !== undefined &&
    HUMAN_ATTENDANCE_STATUSES.includes(
      status as (typeof HUMAN_ATTENDANCE_STATUSES)[number]
    )
  );
}
