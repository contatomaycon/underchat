export const HISTORY_RECONCILIATION_DEFAULTS = Object.freeze({
  enabled: true,
  windowMs: 6 * 60 * 60 * 1000,
  messageLimit: 1000,
  chatScanLimit: 100,
  perChatLimit: 250,
});

export interface HistoryReconciliationConfig {
  enabled: boolean;
  windowMs: number;
  messageLimit: number;
  chatScanLimit: number;
  perChatLimit: number;
}

type HistoryReconciliationEnvironment = Readonly<
  Record<string, string | undefined>
>;

function readBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  const normalized = rawValue?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readPositiveInteger(
  rawValue: string | undefined,
  fallback: number
): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function resolveHistoryReconciliationConfig(
  environment: HistoryReconciliationEnvironment = process.env
): HistoryReconciliationConfig {
  return {
    enabled: readBoolean(
      environment.HISTORY_RECONCILIATION_ENABLED,
      HISTORY_RECONCILIATION_DEFAULTS.enabled
    ),
    windowMs: readPositiveInteger(
      environment.HISTORY_RECONCILIATION_WINDOW_MS,
      HISTORY_RECONCILIATION_DEFAULTS.windowMs
    ),
    messageLimit: readPositiveInteger(
      environment.HISTORY_RECONCILIATION_MESSAGE_LIMIT,
      HISTORY_RECONCILIATION_DEFAULTS.messageLimit
    ),
    chatScanLimit: readPositiveInteger(
      environment.HISTORY_RECONCILIATION_CHAT_SCAN_LIMIT,
      HISTORY_RECONCILIATION_DEFAULTS.chatScanLimit
    ),
    perChatLimit: readPositiveInteger(
      environment.HISTORY_RECONCILIATION_PER_CHAT_LIMIT,
      HISTORY_RECONCILIATION_DEFAULTS.perChatLimit
    ),
  };
}
