import {
  HISTORY_RECONCILIATION_DEFAULTS,
  resolveHistoryReconciliationConfig,
} from '@core/common/functions/historyReconciliationConfig';

describe('historyReconciliationConfig', () => {
  it('uses recovery-safe defaults when production variables are absent', () => {
    expect(resolveHistoryReconciliationConfig({})).toEqual({
      enabled: true,
      windowMs: 6 * 60 * 60 * 1000,
      messageLimit: 1000,
      chatScanLimit: 100,
      perChatLimit: 250,
    });
  });

  it('honors explicit valid overrides', () => {
    expect(
      resolveHistoryReconciliationConfig({
        HISTORY_RECONCILIATION_ENABLED: 'off',
        HISTORY_RECONCILIATION_WINDOW_MS: '3600000',
        HISTORY_RECONCILIATION_MESSAGE_LIMIT: '500',
        HISTORY_RECONCILIATION_CHAT_SCAN_LIMIT: '50',
        HISTORY_RECONCILIATION_PER_CHAT_LIMIT: '125',
      })
    ).toEqual({
      enabled: false,
      windowMs: 3_600_000,
      messageLimit: 500,
      chatScanLimit: 50,
      perChatLimit: 125,
    });
  });

  it('falls back for malformed and non-positive values', () => {
    expect(
      resolveHistoryReconciliationConfig({
        HISTORY_RECONCILIATION_ENABLED: 'invalid',
        HISTORY_RECONCILIATION_WINDOW_MS: 'not-a-number',
        HISTORY_RECONCILIATION_MESSAGE_LIMIT: '0',
        HISTORY_RECONCILIATION_CHAT_SCAN_LIMIT: '-1',
        HISTORY_RECONCILIATION_PER_CHAT_LIMIT: '',
      })
    ).toEqual(HISTORY_RECONCILIATION_DEFAULTS);
  });
});
