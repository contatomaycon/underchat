import { canActivateWorkerWarmRuntime } from '@core/common/functions/workerWarmActivationPolicy';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

describe('worker warm activation policy', () => {
  it('allows a warm runtime for a brand-new worker', () => {
    expect(
      canActivateWorkerWarmRuntime({
        source: 'worker_create',
        session_storage: EWorkerSessionStorage.postgres,
      })
    ).toBe(true);
  });

  it('allows a postgres worker update when the database session reset is explicit', () => {
    expect(
      canActivateWorkerWarmRuntime({
        source: 'worker_update',
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: true,
        remove_volume: false,
      })
    ).toBe(true);
  });

  it.each([
    {},
    { remove_session: false, remove_volume: false },
    { remove_session: true, remove_volume: true },
    { remove_session: false, remove_volume: true },
  ])('blocks a preserving worker update (%o)', (resetFlags) => {
    expect(
      canActivateWorkerWarmRuntime({
        source: 'worker_update',
        session_storage: EWorkerSessionStorage.postgres,
        ...resetFlags,
      })
    ).toBe(false);
  });

  it('blocks non-update recreate sources even with destructive flags', () => {
    expect(
      canActivateWorkerWarmRuntime({
        source: 'self_heal',
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: true,
        remove_volume: false,
      })
    ).toBe(false);
  });

  it.each([
    { source: 'worker_create' as const },
    {
      source: 'worker_update' as const,
      remove_session: true,
      remove_volume: true,
    },
  ])('blocks legacy-volume warm activation (%o)', (input) => {
    expect(
      canActivateWorkerWarmRuntime({
        ...input,
        session_storage: EWorkerSessionStorage.legacy_volume,
      })
    ).toBe(false);
  });
});
