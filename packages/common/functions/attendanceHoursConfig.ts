import moment from 'moment-timezone';
import {
  AttendanceWeekday,
  IAttendanceHoursConfig,
  IAttendanceHoursRule,
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

const WEEKDAY_ORDER_INDEX: Record<AttendanceWeekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

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

export const isAttendanceHoursWeekday = (
  value: unknown
): value is AttendanceWeekday =>
  typeof value === 'string' &&
  WEEKDAY_ORDER.includes(value as AttendanceWeekday);

const normalizeRule = (value: unknown): IAttendanceHoursRule | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rule = value as Partial<IAttendanceHoursRule>;
  const weekdayCandidate =
    typeof rule.weekday === 'string' ? rule.weekday.trim().toLowerCase() : '';

  if (!isAttendanceHoursWeekday(weekdayCandidate)) {
    return null;
  }

  const start_time = normalizeTime(rule.start_time);
  const end_time = normalizeTime(rule.end_time);

  if (!start_time || !end_time) {
    return null;
  }

  return {
    weekday: weekdayCandidate,
    start_time,
    end_time,
  };
};

export const sortAttendanceHoursRules = (
  rules: IAttendanceHoursRule[]
): IAttendanceHoursRule[] => {
  return [...rules].sort((first, second) => {
    const weekdayDiff =
      WEEKDAY_ORDER_INDEX[first.weekday] - WEEKDAY_ORDER_INDEX[second.weekday];

    if (weekdayDiff !== 0) {
      return weekdayDiff;
    }

    if (first.start_time !== second.start_time) {
      return first.start_time.localeCompare(second.start_time);
    }

    return first.end_time.localeCompare(second.end_time);
  });
};

export const normalizeAttendanceHoursRules = (
  rules: unknown
): IAttendanceHoursRule[] => {
  if (!Array.isArray(rules)) {
    return [];
  }

  const normalizedRules = rules
    .map(normalizeRule)
    .filter((rule): rule is IAttendanceHoursRule => rule !== null);

  return sortAttendanceHoursRules(normalizedRules);
};

export const buildDefaultAttendanceHoursConfig = (): IAttendanceHoursConfig => {
  return {
    timezone: ATTENDANCE_HOURS_DEFAULT_TIMEZONE,
    outside_hours_action: ATTENDANCE_HOURS_DEFAULT_OUTSIDE_ACTION,
    message_only_destination_status:
      ATTENDANCE_HOURS_DEFAULT_MESSAGE_ONLY_DESTINATION,
    message_only_queue_sector_id: null,
    rules: [],
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

    const rules = normalizeAttendanceHoursRules(parsed.rules);

    return {
      timezone,
      outside_hours_action: outsideHoursAction,
      message_only_destination_status: destinationStatus,
      message_only_queue_sector_id: messageOnlyQueueSectorId,
      rules,
    };
  } catch {
    return defaults;
  }
};

const toMinutes = (time: string): number | null => {
  if (!TIME_REGEX.test(time)) {
    return null;
  }

  const [hours, minutes] = time.split(':').map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

export const isAttendanceHoursRuleWindowValid = (
  rule: Pick<IAttendanceHoursRule, 'start_time' | 'end_time'>
): boolean => {
  const startMinutes = toMinutes(rule.start_time);
  const endMinutes = toMinutes(rule.end_time);

  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  return startMinutes < endMinutes;
};

export const findConflictingAttendanceHoursRules = (
  rules: IAttendanceHoursRule[]
): {
  first: IAttendanceHoursRule;
  second: IAttendanceHoursRule;
} | null => {
  const sortedRules = sortAttendanceHoursRules(rules);

  for (let i = 0; i < sortedRules.length; i++) {
    const first = sortedRules[i];
    const firstStart = toMinutes(first.start_time);
    const firstEnd = toMinutes(first.end_time);

    if (firstStart === null || firstEnd === null) {
      continue;
    }

    for (let j = i + 1; j < sortedRules.length; j++) {
      const second = sortedRules[j];
      if (first.weekday !== second.weekday) {
        continue;
      }

      const secondStart = toMinutes(second.start_time);
      const secondEnd = toMinutes(second.end_time);

      if (secondStart === null || secondEnd === null) {
        continue;
      }

      const hasConflict = firstStart <= secondEnd && secondStart <= firstEnd;
      if (hasConflict) {
        return { first, second };
      }
    }
  }

  return null;
};

export const hasAtLeastOneAttendanceHoursRule = (
  config: IAttendanceHoursConfig
): boolean => config.rules.length > 0;

export const isAttendanceHoursConfigEnabledValid = (
  config: IAttendanceHoursConfig
): boolean => {
  if (!hasAtLeastOneAttendanceHoursRule(config)) {
    return false;
  }

  for (const rule of config.rules) {
    if (
      !isAttendanceHoursWeekday(rule.weekday) ||
      !isAttendanceHoursRuleWindowValid(rule)
    ) {
      return false;
    }
  }

  if (findConflictingAttendanceHoursRules(config.rules)) {
    return false;
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
  const currentMinutes = now.hour() * 60 + now.minute();

  const todayRules = config.rules.filter((rule) => rule.weekday === weekday);
  if (todayRules.length === 0) {
    return false;
  }

  return todayRules.some((rule) => {
    const startMinutes = toMinutes(rule.start_time);
    const endMinutes = toMinutes(rule.end_time);

    if (
      startMinutes === null ||
      endMinutes === null ||
      startMinutes >= endMinutes
    ) {
      return false;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  });
};
