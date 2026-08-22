import { resolveWorkerRuntimeHealthWarmPoolIdentity } from '@core/common/functions/workerRuntimeHealthIdentity';

describe('worker runtime health warm pool identity', () => {
  it('reports the local runtime identity instead of echoing caller data', () => {
    expect(
      resolveWorkerRuntimeHealthWarmPoolIdentity('warm-pool-1', 'warm-pool-1')
    ).toBe('warm-pool-1');
    expect(
      resolveWorkerRuntimeHealthWarmPoolIdentity(undefined, 'warm-pool-1')
    ).toBe('warm-pool-1');
  });

  it('rejects a caller identity that does not match the local runtime', () => {
    expect(() =>
      resolveWorkerRuntimeHealthWarmPoolIdentity(
        'warm-pool-other',
        'warm-pool-1'
      )
    ).toThrow('runtime_health_warm_pool_identity_mismatch');
    expect(() =>
      resolveWorkerRuntimeHealthWarmPoolIdentity('warm-pool-1', undefined)
    ).toThrow('runtime_health_warm_pool_identity_mismatch');
  });
});
