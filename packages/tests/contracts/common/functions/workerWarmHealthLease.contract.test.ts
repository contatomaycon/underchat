import {
  getWorkerWarmHealthFreshAfter,
  getWorkerWarmHealthLeaseDurationMs,
} from '@core/common/functions/workerWarmHealthLease';

describe('worker warm health lease', () => {
  it('keeps at least a one-minute fail-closed lease for fast scans', () => {
    expect(
      getWorkerWarmHealthLeaseDurationMs({ scan_interval_seconds: 5 })
    ).toBe(60_000);
  });

  it('allows three scheduled scans before a health lease expires', () => {
    expect(
      getWorkerWarmHealthLeaseDurationMs({ scan_interval_seconds: 30 })
    ).toBe(90_000);
    expect(
      getWorkerWarmHealthFreshAfter(
        { scan_interval_seconds: 30 },
        Date.parse('2026-07-30T12:00:00.000Z')
      )
    ).toBe('2026-07-30T11:58:30.000Z');
  });
});
