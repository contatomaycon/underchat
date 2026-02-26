import moment from 'moment-timezone';
import {
  ChatbotWorkingHoursWeekday,
  IChatbotWorkingHoursRule,
} from '@core/common/interfaces/IChatbotWorkingHours';

export const CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const CHATBOT_WORKING_HOURS_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAY_ORDER: ChatbotWorkingHoursWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DAY_INDEX_MAP: Record<number, ChatbotWorkingHoursWeekday> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

export const isChatbotWorkingHoursWeekday = (
  value: unknown
): value is ChatbotWorkingHoursWeekday => {
  return (
    typeof value === 'string' &&
    WEEKDAY_ORDER.includes(value as ChatbotWorkingHoursWeekday)
  );
};

export const normalizeChatbotWorkingHoursTimezone = (
  timezone: string | null | undefined
): string => {
  const normalized = timezone?.trim() || CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE;

  return moment.tz.zone(normalized)
    ? normalized
    : CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE;
};

export const toChatbotWorkingHoursMinutes = (
  time: string | null | undefined
): number | null => {
  if (!time || !CHATBOT_WORKING_HOURS_TIME_REGEX.test(time)) {
    return null;
  }

  const [hours, minutes] = time.split(':').map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

export const isChatbotWorkingHoursRuleWindowValid = (
  rule: Pick<IChatbotWorkingHoursRule, 'start_time' | 'end_time'>
): boolean => {
  const start = toChatbotWorkingHoursMinutes(rule.start_time);
  const end = toChatbotWorkingHoursMinutes(rule.end_time);

  if (start === null || end === null) {
    return false;
  }

  return start < end;
};

export const findConflictingChatbotWorkingHoursRules = (
  rules: IChatbotWorkingHoursRule[]
): {
  first: IChatbotWorkingHoursRule;
  second: IChatbotWorkingHoursRule;
} | null => {
  for (let i = 0; i < rules.length; i++) {
    const first = rules[i];
    const firstStart = toChatbotWorkingHoursMinutes(first.start_time);
    const firstEnd = toChatbotWorkingHoursMinutes(first.end_time);
    if (firstStart === null || firstEnd === null) {
      continue;
    }

    for (let j = i + 1; j < rules.length; j++) {
      const second = rules[j];
      if (first.weekday !== second.weekday) {
        continue;
      }

      const secondStart = toChatbotWorkingHoursMinutes(second.start_time);
      const secondEnd = toChatbotWorkingHoursMinutes(second.end_time);
      if (secondStart === null || secondEnd === null) {
        continue;
      }

      // Intervals that touch are also considered conflicting.
      const hasConflict = firstStart <= secondEnd && secondStart <= firstEnd;
      if (hasConflict) {
        return { first, second };
      }
    }
  }

  return null;
};

export const getActiveChatbotWorkingHoursRule = (
  rules: IChatbotWorkingHoursRule[],
  timezone: string,
  nowDate = new Date()
): IChatbotWorkingHoursRule | null => {
  if (rules.length === 0) {
    return null;
  }

  const normalizedTimezone = normalizeChatbotWorkingHoursTimezone(timezone);
  const now = moment.tz(nowDate, normalizedTimezone);
  const weekday = DAY_INDEX_MAP[now.day()];
  const currentMinutes = now.hour() * 60 + now.minute();

  for (const rule of rules) {
    if (rule.weekday !== weekday) {
      continue;
    }

    const start = toChatbotWorkingHoursMinutes(rule.start_time);
    const end = toChatbotWorkingHoursMinutes(rule.end_time);
    if (start === null || end === null || start >= end) {
      continue;
    }

    if (currentMinutes >= start && currentMinutes < end) {
      return rule;
    }
  }

  return null;
};
