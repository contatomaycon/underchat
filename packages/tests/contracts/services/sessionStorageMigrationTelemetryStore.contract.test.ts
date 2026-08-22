import { createSessionStorageMigrationTelemetryStore } from '@core/services/sessionStorageMigrationTelemetryStore';

describe('session storage migration telemetry', () => {
  it('keeps provider, phase and attempt dimensions bounded', () => {
    const store = createSessionStorageMigrationTelemetryStore();
    store.recordTransition('baileys', 'capturing');
    store.recordAttempt('baileys', 1);
    store.recordFailure('baileys', 'capturing');
    store.recordAttemptDuration('baileys', 5_500);
    store.recordRestoration('baileys');
    store.recordCleanup('baileys', 'failed');

    const snapshot = store.snapshot();
    expect(snapshot.transitions.baileys.capturing).toBe(1);
    expect(snapshot.attempts.baileys['1']).toBe(1);
    expect(snapshot.failures.baileys.capturing).toBe(1);
    expect(snapshot.attempt_duration_ms.baileys.count).toBe(1);
    expect(snapshot.attempt_duration_ms.baileys.buckets['30000']).toBe(1);
    expect(snapshot.restorations.baileys).toBe(1);
    expect(snapshot.cleanup.baileys.failed).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /migration_id|worker_id|account_id|volume_name|phone/u
    );
  });

  it('ignores attempts outside the fixed one-to-three dimension', () => {
    const store = createSessionStorageMigrationTelemetryStore();
    store.recordAttempt('wwebjs', 0);
    store.recordAttempt('wwebjs', 4);
    expect(store.snapshot().attempts.wwebjs).toEqual({
      '1': 0,
      '2': 0,
      '3': 0,
    });
  });
});
