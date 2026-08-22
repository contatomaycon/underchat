import {
  publishPreparedWorkerLifecycle,
  retryWorkerLifecycleBoundary,
} from '@core/common/functions/workerLifecycleBoundary';

describe('workerLifecycleBoundary', () => {
  it('retries a transient operation and returns its confirmed result', async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('confirmed');

    await expect(
      retryWorkerLifecycleBoundary(operation, {
        attempts: 3,
        retryDelayMs: 1,
      })
    ).resolves.toBe('confirmed');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('keeps the prepared claim untouched after persistent publish failure', async () => {
    const publishError = new Error('kafka unavailable');
    const publish = jest.fn(async () => {
      throw publishError;
    });

    await expect(
      publishPreparedWorkerLifecycle({
        publish,
        retryDelayMs: 1,
      })
    ).rejects.toBe(publishError);

    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('retries the same idempotent prepared operation until confirmed', async () => {
    const publish = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('publish attempt 1'))
      .mockRejectedValueOnce(new Error('publish attempt 2'))
      .mockResolvedValueOnce(undefined);

    await expect(
      publishPreparedWorkerLifecycle({
        publish,
        retryDelayMs: 1,
      })
    ).resolves.toBeUndefined();

    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('preserves the original final publish error after bounded attempts', async () => {
    const publishError = new Error('kafka unavailable');
    await expect(
      publishPreparedWorkerLifecycle({
        publish: async () => {
          throw publishError;
        },
        publishAttempts: 2,
        retryDelayMs: 1,
      })
    ).rejects.toBe(publishError);
  });
});
