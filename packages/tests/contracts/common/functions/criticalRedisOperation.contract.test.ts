import {
  CriticalRedisOperationError,
  runCriticalRedisOperation,
} from '@core/common/functions/criticalRedisOperation';

describe('critical Redis operation deadline', () => {
  it('rejects a frozen command within the configured bound', async () => {
    const startedAt = Date.now();
    const frozen = new Promise<never>(() => undefined);

    await expect(
      runCriticalRedisOperation('frozen_test', () => frozen, 250)
    ).rejects.toMatchObject({
      name: 'CriticalRedisOperationError',
      operation: 'frozen_test',
      timeout: true,
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('wraps an immediate Redis rejection with operation context', async () => {
    const cause = new Error('connection lost');

    const operation = runCriticalRedisOperation(
      'rejected_test',
      async () => {
        throw cause;
      },
      250
    );
    await expect(operation).rejects.toBeInstanceOf(CriticalRedisOperationError);
    await expect(operation).rejects.toMatchObject({
      name: 'CriticalRedisOperationError',
      operation: 'rejected_test',
      timeout: false,
      cause,
    });
  });
});
