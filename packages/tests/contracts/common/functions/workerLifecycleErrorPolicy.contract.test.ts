import { isWorkerLifecycleAuthoritativeConflictError } from '@core/common/functions/workerLifecycleErrorPolicy';

describe('worker lifecycle error policy', () => {
  it.each([
    'worker_runtime_removal_database_fence_changed',
    'worker_runtime_removal_container_conflict:server_id',
    'worker_create_retry_quarantine_fence_changed',
    'worker_create_retry_container_conflict:runtime_generation',
  ])('recognizes authoritative lifecycle conflict %s', (message) => {
    expect(
      isWorkerLifecycleAuthoritativeConflictError(new Error(message))
    ).toBe(true);
  });

  it('recognizes a conflict returned by an older INTERNAL gRPC server', () => {
    expect(
      isWorkerLifecycleAuthoritativeConflictError({
        code: 13,
        message: '13 INTERNAL: worker_runtime_removal_database_fence_changed',
        details: 'worker_runtime_removal_database_fence_changed',
      })
    ).toBe(true);
  });

  it.each([
    new Error('docker temporarily unavailable'),
    new Error('database_connection_failed'),
    { code: 14, details: 'worker unavailable' },
  ])('keeps transient error retryable: %p', (error) => {
    expect(isWorkerLifecycleAuthoritativeConflictError(error)).toBe(false);
  });
});
