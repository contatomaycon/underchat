import { IOperatorReplyPendingAlertConfig } from '../interfaces/IOperatorReplyPendingAlertConfig';

export const OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES = 15;
export const OPERATOR_REPLY_PENDING_ALERT_MIN_TIME_MINUTES = 1;

const normalizeTimeMinutes = (value: unknown): number => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed)) {
    return OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES;
  }

  return Math.max(OPERATOR_REPLY_PENDING_ALERT_MIN_TIME_MINUTES, parsed);
};

export const defaultOperatorReplyPendingAlertConfig =
  (): IOperatorReplyPendingAlertConfig => ({
    enabled: false,
    time_minutes: OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES,
  });

export const parseOperatorReplyPendingAlertConfig = (
  rawValue: string | null | undefined,
  enabled: boolean
): IOperatorReplyPendingAlertConfig => {
  const defaults = defaultOperatorReplyPendingAlertConfig();

  if (!rawValue || typeof rawValue !== 'string') {
    return {
      enabled,
      time_minutes: defaults.time_minutes,
    };
  }

  try {
    const parsed = JSON.parse(
      rawValue
    ) as Partial<IOperatorReplyPendingAlertConfig>;

    if (!parsed || typeof parsed !== 'object') {
      return {
        enabled,
        time_minutes: defaults.time_minutes,
      };
    }

    return {
      enabled,
      time_minutes: normalizeTimeMinutes(parsed.time_minutes),
    };
  } catch {
    return {
      enabled,
      time_minutes: defaults.time_minutes,
    };
  }
};
