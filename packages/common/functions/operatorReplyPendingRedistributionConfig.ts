import { IOperatorReplyPendingRedistributionConfig } from '../interfaces/IOperatorReplyPendingRedistributionConfig';

export const OPERATOR_REPLY_PENDING_REDISTRIBUTION_DEFAULT_TIME_MINUTES = 15;
export const OPERATOR_REPLY_PENDING_REDISTRIBUTION_MIN_TIME_MINUTES = 1;

const normalizeTimeMinutes = (value: unknown): number => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed)) {
    return OPERATOR_REPLY_PENDING_REDISTRIBUTION_DEFAULT_TIME_MINUTES;
  }

  return Math.max(
    OPERATOR_REPLY_PENDING_REDISTRIBUTION_MIN_TIME_MINUTES,
    parsed
  );
};

export const normalizeOperatorReplyPendingRedistributionSectorIds = (
  value: unknown
): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((sectorId): sectorId is string => typeof sectorId === 'string')
        .map((sectorId) => sectorId.trim())
        .filter((sectorId) => sectorId.length > 0)
    ),
  ];
};

export const isOperatorReplyPendingRedistributionSectorInScope = (
  config: Pick<IOperatorReplyPendingRedistributionConfig, 'sector_ids'>,
  sectorId: string | null | undefined
): boolean =>
  config.sector_ids.length === 0 ||
  (typeof sectorId === 'string' && config.sector_ids.includes(sectorId));

export const defaultOperatorReplyPendingRedistributionConfig =
  (): IOperatorReplyPendingRedistributionConfig => ({
    enabled: false,
    time_minutes: OPERATOR_REPLY_PENDING_REDISTRIBUTION_DEFAULT_TIME_MINUTES,
    sector_ids: [],
  });

export const parseOperatorReplyPendingRedistributionConfig = (
  rawValue: string | null | undefined,
  enabled = false
): IOperatorReplyPendingRedistributionConfig => {
  const defaults = defaultOperatorReplyPendingRedistributionConfig();

  if (!rawValue || typeof rawValue !== 'string') {
    return { ...defaults, enabled };
  }

  try {
    const parsed = JSON.parse(
      rawValue
    ) as Partial<IOperatorReplyPendingRedistributionConfig>;

    if (!parsed || typeof parsed !== 'object') {
      return { ...defaults, enabled };
    }

    return {
      enabled,
      time_minutes: normalizeTimeMinutes(parsed.time_minutes),
      sector_ids: normalizeOperatorReplyPendingRedistributionSectorIds(
        parsed.sector_ids
      ),
    };
  } catch {
    return { ...defaults, enabled };
  }
};
