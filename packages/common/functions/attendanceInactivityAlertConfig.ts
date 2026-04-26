import { IAttendanceInactivityAlertConfig } from '../interfaces/IAttendanceInactivityAlert';

export const ATTENDANCE_INACTIVITY_ALERT_DEFAULT_QUANTITY = 1;
export const ATTENDANCE_INACTIVITY_ALERT_DEFAULT_TIME = 180;
export const ATTENDANCE_INACTIVITY_ALERT_DEFAULT_ACTION: IAttendanceInactivityAlertConfig['action'] =
  'finish';
export const ATTENDANCE_INACTIVITY_ALERT_DEFAULT_MESSAGE_ENABLED = true;

const toPositiveInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};

const parseAction = (
  value: unknown
): IAttendanceInactivityAlertConfig['action'] => {
  if (value === 'finish') {
    return value;
  }

  return ATTENDANCE_INACTIVITY_ALERT_DEFAULT_ACTION;
};

const parseMessage = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

export const buildDefaultAttendanceInactivityAlertConfig = (): IAttendanceInactivityAlertConfig => ({
  quantity: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_QUANTITY,
  time: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_TIME,
  action: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_ACTION,
  inactivity_message_enabled: ATTENDANCE_INACTIVITY_ALERT_DEFAULT_MESSAGE_ENABLED,
  inactivity_message: null,
});

export const parseAttendanceInactivityAlertConfig = (
  rawValue: string | null | undefined
): IAttendanceInactivityAlertConfig => {
  const defaults = buildDefaultAttendanceInactivityAlertConfig();

  if (!rawValue || typeof rawValue !== 'string') {
    return defaults;
  }

  try {
    const parsed = JSON.parse(rawValue) as
      | Partial<IAttendanceInactivityAlertConfig>
      | null;

    if (!parsed || typeof parsed !== 'object') {
      return defaults;
    }

    const quantity =
      toPositiveInteger(parsed.quantity) ??
      ATTENDANCE_INACTIVITY_ALERT_DEFAULT_QUANTITY;
    const time =
      toPositiveInteger(parsed.time) ?? ATTENDANCE_INACTIVITY_ALERT_DEFAULT_TIME;

    return {
      quantity,
      time,
      action: parseAction(parsed.action),
      inactivity_message_enabled:
        parsed.inactivity_message_enabled !== undefined
          ? parsed.inactivity_message_enabled !== false
          : ATTENDANCE_INACTIVITY_ALERT_DEFAULT_MESSAGE_ENABLED,
      inactivity_message: parseMessage(parsed.inactivity_message),
    };
  } catch {
    return defaults;
  }
};
