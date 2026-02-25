import moment from 'moment-timezone';
import {
  AttendanceWeekday,
  IAttendanceDayConfig,
  IAttendanceDaysConfig,
  IAttendanceHoursConfig,
  MessageOnlyDestinationStatus,
  OutsideHoursAction,
} from '../interfaces/IAttendanceHours';

export const ATTENDANCE_HOURS_DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const ATTENDANCE_HOURS_DEFAULT_OUTSIDE_ACTION: OutsideHoursAction =
  'message_only';
export const ATTENDANCE_HOURS_DEFAULT_MESSAGE_ONLY_DESTINATION: MessageOnlyDestinationStatus =
  'queue';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAY_ORDER: AttendanceWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DAY_INDEX_MAP: Record<number, AttendanceWeekday> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

const normalizeTime = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!TIME_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
};

const normalizeDay = (value: unknown): IAttendanceDayConfig => {
  if (!value || typeof value !== 'object') {
    return {
      enabled: false,
      start_time: null,
      end_time: null,
    };
  }

  const day = value as Partial<IAttendanceDayConfig>;

  return {
    enabled: day.enabled === true,
    start_time: normalizeTime(day.start_time),
    end_time: normalizeTime(day.end_time),
  };
};

export const buildDefaultAttendanceDays = (): IAttendanceDaysConfig => {
  return {
    monday: { enabled: false, start_time: '09:00', end_time: '18:00' },
    tuesday: { enabled: false, start_time: '09:00', end_time: '18:00' },
    wednesday: { enabled: false, start_time: '09:00', end_time: '18:00' },
    thursday: { enabled: false, start_time: '09:00', end_time: '18:00' },
    friday: { enabled: false, start_time: '09:00', end_time: '18:00' },
    saturday: { enabled: false, start_time: '09:00', end_time: '18:00' },
    sunday: { enabled: false, start_time: '09:00', end_time: '18:00' },
  };
};

export const buildDefaultAttendanceHoursConfig = (): IAttendanceHoursConfig => {
  return {
    timezone: ATTENDANCE_HOURS_DEFAULT_TIMEZONE,
    outside_hours_action: ATTENDANCE_HOURS_DEFAULT_OUTSIDE_ACTION,
    message_only_destination_status:
      ATTENDANCE_HOURS_DEFAULT_MESSAGE_ONLY_DESTINATION,
    message_only_queue_sector_id: null,
    days: buildDefaultAttendanceDays(),
  };
};

export const parseAttendanceHoursConfig = (
  rawValue: string | null | undefined
): IAttendanceHoursConfig => {
  const defaults = buildDefaultAttendanceHoursConfig();

  if (!rawValue || typeof rawValue !== 'string') {
    return defaults;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<IAttendanceHoursConfig>;

    const timezone =
      typeof parsed.timezone === 'string' && parsed.timezone.trim()
        ? parsed.timezone.trim()
        : defaults.timezone;

    const outsideHoursAction: OutsideHoursAction =
      parsed.outside_hours_action === 'continue_flow' ||
      parsed.outside_hours_action === 'message_only'
        ? parsed.outside_hours_action
        : defaults.outside_hours_action;

    const destinationStatus: MessageOnlyDestinationStatus =
      parsed.message_only_destination_status === 'closed' ||
      parsed.message_only_destination_status === 'queue'
        ? parsed.message_only_destination_status
        : defaults.message_only_destination_status;

    const messageOnlyQueueSectorId =
      typeof parsed.message_only_queue_sector_id === 'string' &&
      parsed.message_only_queue_sector_id.trim().length > 0
        ? parsed.message_only_queue_sector_id.trim()
        : null;

    const daysRaw =
      parsed.days && typeof parsed.days === 'object' ? parsed.days : {};

    const days = WEEKDAY_ORDER.reduce<IAttendanceDaysConfig>((acc, weekday) => {
      acc[weekday] = normalizeDay(
        (daysRaw as Record<string, unknown>)[weekday]
      );
      return acc;
    }, buildDefaultAttendanceDays());

    return {
      timezone,
      outside_hours_action: outsideHoursAction,
      message_only_destination_status: destinationStatus,
      message_only_queue_sector_id: messageOnlyQueueSectorId,
      days,
    };
  } catch {
    return defaults;
  }
};

const toMinutes = (time: string | null): number | null => {
  if (!time || !TIME_REGEX.test(time)) {
    return null;
  }

  const [hours, minutes] = time.split(':').map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

export const isAttendanceDayWindowValid = (
  day: IAttendanceDayConfig
): boolean => {
  if (!day.enabled) {
    return true;
  }

  const startMinutes = toMinutes(day.start_time);
  const endMinutes = toMinutes(day.end_time);

  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  return startMinutes < endMinutes;
};

export const hasAtLeastOneEnabledAttendanceDay = (
  config: IAttendanceHoursConfig
): boolean => {
  return WEEKDAY_ORDER.some((weekday) => config.days[weekday].enabled === true);
};

export const isAttendanceHoursConfigEnabledValid = (
  config: IAttendanceHoursConfig
): boolean => {
  if (!hasAtLeastOneEnabledAttendanceDay(config)) {
    return false;
  }

  for (const weekday of WEEKDAY_ORDER) {
    if (!isAttendanceDayWindowValid(config.days[weekday])) {
      return false;
    }
  }

  if (
    config.outside_hours_action === 'message_only' &&
    config.message_only_destination_status === 'queue' &&
    !config.message_only_queue_sector_id
  ) {
    return false;
  }

  return true;
};

export const isNowWithinAttendanceHours = (
  config: IAttendanceHoursConfig,
  nowDate = new Date()
): boolean => {
  const timezone = config.timezone?.trim() || ATTENDANCE_HOURS_DEFAULT_TIMEZONE;
  const now = moment.tz(nowDate, timezone);
  const weekday = DAY_INDEX_MAP[now.day()];

  const dayConfig = config.days[weekday];
  if (!dayConfig || !dayConfig.enabled) {
    return false;
  }

  const startMinutes = toMinutes(dayConfig.start_time);
  const endMinutes = toMinutes(dayConfig.end_time);

  if (
    startMinutes === null ||
    endMinutes === null ||
    startMinutes >= endMinutes
  ) {
    return false;
  }

  const currentMinutes = now.hour() * 60 + now.minute();

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
};
