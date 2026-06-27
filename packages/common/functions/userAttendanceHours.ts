import moment from 'moment-timezone';
import {
  IUserAttendanceGuardStatus,
  IUserAttendanceHoursRule,
  UserAttendanceHoursWeekday,
} from '@core/common/interfaces/IUserAttendanceHours';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

export const USER_ATTENDANCE_HOURS_TIMEZONE = APP_TIMEZONE;
export const USER_ATTENDANCE_HOURS_BLOCK_REASON =
  'user_attendance_hours_blocked';

const USER_ATTENDANCE_HOURS_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAY_ORDER: UserAttendanceHoursWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DAY_INDEX_MAP: Record<number, UserAttendanceHoursWeekday> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

export const isUserAttendanceHoursWeekday = (
  value: unknown
): value is UserAttendanceHoursWeekday => {
  return (
    typeof value === 'string' &&
    WEEKDAY_ORDER.includes(value as UserAttendanceHoursWeekday)
  );
};

export const isUserAttendanceHoursTimeValid = (value: unknown): boolean => {
  return (
    typeof value === 'string' && USER_ATTENDANCE_HOURS_TIME_REGEX.test(value)
  );
};

export const toUserAttendanceHoursMinutes = (
  time: string | null | undefined
): number | null => {
  if (!time || !isUserAttendanceHoursTimeValid(time)) {
    return null;
  }

  const [hours, minutes] = time
    .split(':')
    .map((entry) => Number.parseInt(entry, 10));

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

export const isUserAttendanceHoursRuleWindowValid = (
  rule: Pick<IUserAttendanceHoursRule, 'start_time' | 'end_time'>
): boolean => {
  const startMinutes = toUserAttendanceHoursMinutes(rule.start_time);
  const endMinutes = toUserAttendanceHoursMinutes(rule.end_time);

  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  return startMinutes < endMinutes;
};

const sortRules = (
  rules: IUserAttendanceHoursRule[]
): IUserAttendanceHoursRule[] => {
  return [...rules].sort((first, second) => {
    const firstWeekdayIndex = WEEKDAY_ORDER.indexOf(first.weekday);
    const secondWeekdayIndex = WEEKDAY_ORDER.indexOf(second.weekday);

    if (firstWeekdayIndex !== secondWeekdayIndex) {
      return firstWeekdayIndex - secondWeekdayIndex;
    }

    if (first.start_time !== second.start_time) {
      return first.start_time.localeCompare(second.start_time);
    }

    return first.end_time.localeCompare(second.end_time);
  });
};

export const normalizeUserAttendanceHoursRules = (
  rules: Array<Partial<IUserAttendanceHoursRule>>
): IUserAttendanceHoursRule[] => {
  return sortRules(
    rules.map((rule) => ({
      weekday: String(rule.weekday ?? '')
        .trim()
        .toLowerCase() as UserAttendanceHoursWeekday,
      start_time: String(rule.start_time ?? '').trim(),
      end_time: String(rule.end_time ?? '').trim(),
    }))
  );
};

export const findConflictingUserAttendanceHoursRules = (
  rules: IUserAttendanceHoursRule[]
): {
  first: IUserAttendanceHoursRule;
  second: IUserAttendanceHoursRule;
} | null => {
  const sortedRules = sortRules(rules);

  for (let i = 0; i < sortedRules.length; i++) {
    const first = sortedRules[i];
    const firstStart = toUserAttendanceHoursMinutes(first.start_time);
    const firstEnd = toUserAttendanceHoursMinutes(first.end_time);

    if (firstStart === null || firstEnd === null) {
      continue;
    }

    for (let j = i + 1; j < sortedRules.length; j++) {
      const second = sortedRules[j];

      if (first.weekday !== second.weekday) {
        continue;
      }

      const secondStart = toUserAttendanceHoursMinutes(second.start_time);
      const secondEnd = toUserAttendanceHoursMinutes(second.end_time);

      if (secondStart === null || secondEnd === null) {
        continue;
      }

      // Touching windows are allowed; strict overlap is not.
      const hasConflict = firstStart < secondEnd && secondStart < firstEnd;
      if (hasConflict) {
        return { first, second };
      }
    }
  }

  return null;
};

const isBlockedAtMoment = (
  rules: IUserAttendanceHoursRule[],
  dateTime: moment.Moment
): boolean => {
  const weekday = DAY_INDEX_MAP[dateTime.day()];
  const currentMinutes = dateTime.hour() * 60 + dateTime.minute();

  const todayRules = rules
    .filter((rule) => rule.weekday === weekday)
    .sort((first, second) => first.start_time.localeCompare(second.start_time));

  if (todayRules.length === 0) {
    return false;
  }

  return !todayRules.some((rule) => {
    const startMinutes = toUserAttendanceHoursMinutes(rule.start_time);
    const endMinutes = toUserAttendanceHoursMinutes(rule.end_time);

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

const buildFutureCandidates = (
  now: moment.Moment,
  rules: IUserAttendanceHoursRule[]
): moment.Moment[] => {
  const candidates = new Map<string, moment.Moment>();

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const dayMoment = now.clone().startOf('day').add(dayOffset, 'day');
    const weekday = DAY_INDEX_MAP[dayMoment.day()];

    if (dayOffset > 0) {
      candidates.set(dayMoment.toISOString(), dayMoment);
    }

    const dayRules = rules.filter((rule) => rule.weekday === weekday);

    for (const rule of dayRules) {
      const start = toUserAttendanceHoursMinutes(rule.start_time);
      const end = toUserAttendanceHoursMinutes(rule.end_time);

      if (start === null || end === null || start >= end) {
        continue;
      }

      const startCandidate = dayMoment
        .clone()
        .hour(Math.floor(start / 60))
        .minute(start % 60)
        .second(0)
        .millisecond(0);

      const endCandidate = dayMoment
        .clone()
        .hour(Math.floor(end / 60))
        .minute(end % 60)
        .second(0)
        .millisecond(0);

      candidates.set(startCandidate.toISOString(), startCandidate);
      candidates.set(endCandidate.toISOString(), endCandidate);
    }
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.isAfter(now))
    .sort((first, second) => first.valueOf() - second.valueOf());
};

export const calculateUserAttendanceGuardStatus = (
  rulesInput: IUserAttendanceHoursRule[],
  nowDate = new Date()
): IUserAttendanceGuardStatus => {
  const rules = sortRules(rulesInput);
  const now = moment.tz(nowDate, USER_ATTENDANCE_HOURS_TIMEZONE);
  const weekday = DAY_INDEX_MAP[now.day()];

  const todayRules = rules
    .filter((rule) => rule.weekday === weekday)
    .sort((first, second) => first.start_time.localeCompare(second.start_time));

  const isRestrictedToday = todayRules.length > 0;
  const isBlockedNow = isBlockedAtMoment(rules, now);

  const candidates = buildFutureCandidates(now, rules);
  let previousState = isBlockedNow;
  let nextTransitionAt: string | null = null;
  let nextUnlockAt: string | null = null;
  let nextLockAt: string | null = null;

  for (const candidate of candidates) {
    const nextState = isBlockedAtMoment(rules, candidate);

    if (nextState === previousState) {
      continue;
    }

    if (!nextTransitionAt) {
      nextTransitionAt = candidate.toISOString();
    }

    if (!nextState && !nextUnlockAt) {
      nextUnlockAt = candidate.toISOString();
    }

    if (nextState && !nextLockAt) {
      nextLockAt = candidate.toISOString();
    }

    previousState = nextState;

    if (nextTransitionAt && nextUnlockAt && nextLockAt) {
      break;
    }
  }

  return {
    timezone: USER_ATTENDANCE_HOURS_TIMEZONE,
    is_restricted_today: isRestrictedToday,
    is_blocked_now: isBlockedNow,
    today_rules: todayRules,
    today_windows_label:
      todayRules.length > 0
        ? todayRules
            .map((rule) => `${rule.start_time}-${rule.end_time}`)
            .join(', ')
        : null,
    next_transition_at: nextTransitionAt,
    next_unlock_at: nextUnlockAt,
    next_lock_at: nextLockAt,
    server_now: now.toISOString(),
  };
};
