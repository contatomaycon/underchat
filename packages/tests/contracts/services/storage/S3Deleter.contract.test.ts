import 'reflect-metadata';
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Deleter } from '@core/services/storage/S3Deleter';

describe('S3Deleter', () => {
  const makeService = (mockSleep: boolean = true) => {
    const send = jest.fn<Promise<unknown>, [unknown]>();
    const service = new S3Deleter({ send } as never);
    let sleep: jest.Mock<Promise<void>, [number]> | null = null;

    if (mockSleep) {
      sleep = jest.fn<Promise<void>, [number]>(async () => undefined);
      (service as any).sleep = sleep;
    }

    return {
      service,
      send,
      sleep,
    };
  };

  it('classifies no-such-bucket and retryable errors', () => {
    const { service } = makeService();

    expect((service as any).isNoSuchBucketError({ name: 'NoSuchBucket' })).toBe(
      true
    );
    expect((service as any).isNoSuchBucketError({ Code: 'NoSuchBucket' })).toBe(
      true
    );
    expect(
      (service as any).isNoSuchBucketError({
        $metadata: { httpStatusCode: 404 },
      })
    ).toBe(true);
    expect((service as any).isNoSuchBucketError({ name: 'Other' })).toBe(false);

    const retryableCases = [
      { name: 'InternalError' },
      { name: 'ServiceUnavailable' },
      { name: 'RequestTimeout' },
      { $metadata: { httpStatusCode: 500 } },
      { $metadata: { httpStatusCode: 429 } },
      { code: 'ECONNRESET' },
      { code: 'ETIMEDOUT' },
    ];

    for (const retryable of retryableCases) {
      expect((service as any).isRetryableError(retryable)).toBe(true);
    }

    expect((service as any).isRetryableError(null)).toBe(false);
    expect((service as any).isRetryableError({ name: 'AccessDenied' })).toBe(
      false
    );
  });

  it('executes native sleep helper', async () => {
    jest.useFakeTimers();
    const { service } = makeService(false);

    try {
      const sleepPromise = (service as any).sleep(10);
      await jest.advanceTimersByTimeAsync(10);
      await expect(sleepPromise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('objectExists retries retryable head errors and returns true on success', async () => {
    const { service, send, sleep } = makeService();

    send
      .mockRejectedValueOnce({ name: 'InternalError' })
      .mockResolvedValueOnce({});

    await expect(
      (service as any).objectExists('bucket-1', 'file-1')
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).not.toBeNull();
    expect(sleep as jest.Mock).toHaveBeenCalledWith(1000);
  });

  it('objectExists returns false for not-found and throws non-retryable errors', async () => {
    const { service, send } = makeService();

    send.mockRejectedValueOnce({ name: 'NotFound' });
    await expect(
      (service as any).objectExists('bucket-1', 'missing')
    ).resolves.toBe(false);

    const nonRetryable = new Error('forbidden');
    send.mockRejectedValueOnce(nonRetryable);
    await expect((service as any).objectExists('bucket-1', 'x')).rejects.toBe(
      nonRetryable
    );
  });

  it('returns true when object does not exist before deletion', async () => {
    const { service, send } = makeService();

    send.mockRejectedValueOnce({ name: 'NoSuchKey' });

    await expect(
      service.deleteObject('bucket-1', 'already-missing')
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
  });

  it('retries delete, verifies eventual removal and returns true', async () => {
    const { service, send, sleep } = makeService();
    let headCount = 0;
    let deleteCount = 0;

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        headCount += 1;
        if (headCount === 1) {
          return {};
        }
        if (headCount <= 3) {
          return {};
        }
        throw { name: 'NotFound' };
      }

      if (command instanceof DeleteObjectCommand) {
        deleteCount += 1;
        if (deleteCount === 1) {
          throw { name: 'ServiceUnavailable' };
        }
        return {};
      }

      return {};
    });

    await expect(service.deleteObject('bucket-1', 'file-2')).resolves.toBe(
      true
    );

    expect(deleteCount).toBe(2);
    expect(sleep).not.toBeNull();
    expect(sleep as jest.Mock).toHaveBeenCalled();
  });

  it('returns false when delete receives no-such-bucket or object remains after checks', async () => {
    const noSuchBucketService = makeService();
    noSuchBucketService.send
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ name: 'NoSuchBucket' });

    await expect(
      noSuchBucketService.service.deleteObject('bucket-2', 'file-3')
    ).resolves.toBe(false);

    const stillExistsService = makeService();
    stillExistsService.send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        return {};
      }
      return {};
    });

    await expect(
      stillExistsService.service.deleteObject('bucket-3', 'file-4')
    ).resolves.toBe(false);
  });

  it('throws when delete fails with non-retryable error', async () => {
    const { service, send } = makeService();
    const deleteError = new Error('access-denied');

    send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        throw deleteError;
      }
      return {};
    });

    await expect(service.deleteObject('bucket-4', 'file-5')).rejects.toBe(
      deleteError
    );
  });
});
