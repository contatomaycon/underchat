import { createHash } from 'node:crypto';
import { IScheduleStatusUpdate } from '../interfaces/IScheduleStatusUpdate';

const SCHEDULE_STATUS_EVENT_ID_VERSION = 'v1';

function normalize(value: string): string {
  return value.trim();
}

export function buildScheduleStatusKafkaKey(
  data: Pick<IScheduleStatusUpdate, 'schedule_id' | 'contact_id' | 'message_id'>
): string {
  return [data.schedule_id, data.contact_id, data.message_id]
    .map(normalize)
    .join(':');
}

export function buildScheduleStatusEventId(
  data: Pick<
    IScheduleStatusUpdate,
    'schedule_id' | 'contact_id' | 'message_id' | 'status'
  >
): string {
  const canonical = [
    SCHEDULE_STATUS_EVENT_ID_VERSION,
    normalize(data.schedule_id),
    normalize(data.contact_id),
    normalize(data.message_id),
    data.status,
  ].join('\0');

  return `schedule_status_${SCHEDULE_STATUS_EVENT_ID_VERSION}_${createHash(
    'sha256'
  )
    .update(canonical)
    .digest('hex')}`;
}

export function ensureScheduleStatusEventId(
  data: IScheduleStatusUpdate
): string {
  const existing = data.event_id?.trim();
  if (existing) {
    data.event_id = existing;
    return existing;
  }

  const generated = buildScheduleStatusEventId(data);
  data.event_id = generated;
  return generated;
}
