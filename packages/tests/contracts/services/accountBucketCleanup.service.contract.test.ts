import 'reflect-metadata';

const mockWithLock = jest.fn(
  async (
    _: unknown,
    __: string,
    callback: () => Promise<void>,
    ___: { ttlMs: number; retryMs: number }
  ) => callback()
);

class MockDeleteBucketCommand {
  public readonly input: any;

  constructor(input: any) {
    this.input = input;
  }
}

class MockDeleteObjectsCommand {
  public readonly input: any;

  constructor(input: any) {
    this.input = input;
  }
}

class MockListObjectsV2Command {
  public readonly input: any;

  constructor(input: any) {
    this.input = input;
  }
}

jest.mock('@core/common/functions/withLock', () => ({
  withLock: mockWithLock,
}));

jest.mock('@aws-sdk/client-s3', () => ({
  DeleteBucketCommand: MockDeleteBucketCommand,
  DeleteObjectsCommand: MockDeleteObjectsCommand,
  ListObjectsV2Command: MockListObjectsV2Command,
  S3Client: class {},
}));

jest.mock(
  '@core/repositories/account/AccountExpiredBucketCleanup.repository',
  () => ({
    AccountExpiredBucketCleanupRepository: class {},
  })
);

import { AccountBucketCleanupService } from '@core/services/accountBucketCleanup.service';

describe('AccountBucketCleanupService', () => {
  const makeService = () => {
    const accountExpiredBucketCleanupRepository = {
      listAccountsWithExpiredPlanAndBucketPendingDeletion: jest.fn<
        Promise<Array<{ account_id: string }>>,
        any[]
      >(async () => []),
      markBucketAsDeleted: jest.fn(async () => true),
    };

    const s3Client = {
      send: jest.fn(),
    };

    const s3BackupClient = {
      send: jest.fn(),
    };

    const redis = {
      set: jest.fn(),
      del: jest.fn(),
    };

    const service = new AccountBucketCleanupService(
      accountExpiredBucketCleanupRepository as never,
      s3Client as never,
      s3BackupClient as never,
      redis as never
    );

    return {
      service,
      accountExpiredBucketCleanupRepository,
      s3Client,
      s3BackupClient,
      redis,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns early when there are no expired accounts', async () => {
    const { service, accountExpiredBucketCleanupRepository } = makeService();

    accountExpiredBucketCleanupRepository.listAccountsWithExpiredPlanAndBucketPendingDeletion.mockResolvedValueOnce(
      []
    );

    await expect(service.processExpiredAccounts()).resolves.toBeUndefined();

    expect(
      accountExpiredBucketCleanupRepository.listAccountsWithExpiredPlanAndBucketPendingDeletion
    ).toHaveBeenCalledTimes(1);
  });

  it('processes accounts in batches and logs process failures', async () => {
    const { service, accountExpiredBucketCleanupRepository } = makeService();

    const accounts = [
      { account_id: 'a1' },
      { account_id: 'a2' },
      { account_id: 'a3' },
      { account_id: 'a4' },
      { account_id: 'a5' },
      { account_id: 'a6' },
    ];

    accountExpiredBucketCleanupRepository.listAccountsWithExpiredPlanAndBucketPendingDeletion.mockResolvedValueOnce(
      accounts
    );

    const processSpy = jest
      .spyOn(service as any, 'processAccount')
      .mockImplementation(async (item: any) => {
        if (item.account_id === 'a6') {
          throw new Error('cannot delete');
        }
      });

    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(service.processExpiredAccounts()).resolves.toBeUndefined();

    expect(processSpy).toHaveBeenCalledTimes(6);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Erro ao limpar bucket da account a6:',
      expect.any(Error)
    );
  });

  it('processAccount uses distributed lock and marks account as deleted when providers succeed', async () => {
    const { service, accountExpiredBucketCleanupRepository, redis } =
      makeService();

    jest
      .spyOn(service as any, 'deleteBucketOnAllProviders')
      .mockResolvedValueOnce(true);

    await expect(
      (service as any).processAccount({ account_id: 'acc-1' })
    ).resolves.toBeUndefined();

    expect(mockWithLock).toHaveBeenCalledWith(
      redis,
      'account-bucket-cleanup:acc-1',
      expect.any(Function),
      {
        ttlMs: 60000,
        retryMs: 100,
      }
    );
    expect(
      accountExpiredBucketCleanupRepository.markBucketAsDeleted
    ).toHaveBeenCalledWith('acc-1');
  });

  it('processAccount does not mark account when providers deletion fails', async () => {
    const { service, accountExpiredBucketCleanupRepository } = makeService();

    jest
      .spyOn(service as any, 'deleteBucketOnAllProviders')
      .mockResolvedValueOnce(false);

    await expect(
      (service as any).processAccount({ account_id: 'acc-1' })
    ).resolves.toBeUndefined();

    expect(
      accountExpiredBucketCleanupRepository.markBucketAsDeleted
    ).not.toHaveBeenCalled();
  });

  it('deleteBucketOnAllProviders returns true when both providers succeed', async () => {
    const { service } = makeService();

    const deleteWithRetrySpy = jest
      .spyOn(service as any, 'deleteBucketWithRetry')
      .mockResolvedValue(undefined);

    await expect(
      (service as any).deleteBucketOnAllProviders('acc-1')
    ).resolves.toBe(true);

    expect(deleteWithRetrySpy).toHaveBeenCalledTimes(2);
  });

  it('deleteBucketOnAllProviders returns false and logs error when one provider fails', async () => {
    const { service } = makeService();

    const deleteWithRetrySpy = jest
      .spyOn(service as any, 'deleteBucketWithRetry')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('backup failed'));

    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      (service as any).deleteBucketOnAllProviders('acc-1')
    ).resolves.toBe(false);

    expect(deleteWithRetrySpy).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Erro ao remover bucket "acc-1" no provedor backup:',
      expect.any(Error)
    );
  });

  it('deleteBucketWithRetry handles success, retries, no-such-bucket and throws on fatal errors', async () => {
    const { service } = makeService();
    const client = {
      send: jest.fn(async () => ({})),
    };

    const emptyBucketSpy = jest
      .spyOn(service as any, 'emptyBucket')
      .mockResolvedValue(undefined);

    await expect(
      (service as any).deleteBucketWithRetry(client, 'bucket-1')
    ).resolves.toBeUndefined();

    expect(emptyBucketSpy).toHaveBeenCalledWith(client, 'bucket-1');
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: 'bucket-1' },
      })
    );

    const sleepSpy = jest
      .spyOn(service as any, 'sleep')
      .mockResolvedValue(undefined);

    let attempt = 0;
    client.send.mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw {
          name: 'ServiceUnavailable',
          $metadata: { httpStatusCode: 503 },
        };
      }
      return {};
    });

    await expect(
      (service as any).deleteBucketWithRetry(client, 'bucket-2')
    ).resolves.toBeUndefined();
    expect(sleepSpy).toHaveBeenCalledWith(1000);

    client.send.mockRejectedValueOnce({ name: 'NoSuchBucket' });
    await expect(
      (service as any).deleteBucketWithRetry(client, 'bucket-3')
    ).resolves.toBeUndefined();

    client.send.mockRejectedValueOnce(new Error('fatal delete'));
    await expect(
      (service as any).deleteBucketWithRetry(client, 'bucket-4')
    ).rejects.toThrow('fatal delete');
  });

  it('emptyBucket paginates listings, deletes found keys and throws when provider reports delete errors', async () => {
    const { service } = makeService();
    const client = {
      send: jest
        .fn()
        .mockImplementationOnce(async (command: any) => {
          expect(command.input).toEqual({
            Bucket: 'bucket-1',
            ContinuationToken: undefined,
          });

          return {
            Contents: [{ Key: 'a.txt' }, { Key: undefined }, { Key: 'b.txt' }],
            IsTruncated: true,
            NextContinuationToken: 'token-2',
          };
        })
        .mockImplementationOnce(async (command: any) => {
          expect(command.input).toEqual({
            Bucket: 'bucket-1',
            Delete: {
              Objects: [{ Key: 'a.txt' }, { Key: 'b.txt' }],
              Quiet: true,
            },
          });
          return {};
        })
        .mockImplementationOnce(async (command: any) => {
          expect(command.input).toEqual({
            Bucket: 'bucket-1',
            ContinuationToken: 'token-2',
          });

          return {
            Contents: [],
            IsTruncated: false,
          };
        }),
    };

    await expect(
      (service as any).emptyBucket(client, 'bucket-1')
    ).resolves.toBeUndefined();

    client.send
      .mockReset()
      .mockResolvedValueOnce({
        Contents: [{ Key: 'x.txt' }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Errors: [{ Code: 'AccessDenied', Message: 'blocked' }],
      });

    await expect(
      (service as any).emptyBucket(client, 'bucket-1')
    ).rejects.toThrow('AccessDenied: blocked');
  });

  it('evaluates helper methods for error classification', () => {
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

    expect(
      (service as any).isBucketNotEmptyError({ name: 'BucketNotEmpty' })
    ).toBe(true);
    expect(
      (service as any).isBucketNotEmptyError({ Code: 'BucketNotEmpty' })
    ).toBe(true);

    expect((service as any).isRetryableError(null)).toBe(false);
    expect((service as any).isRetryableError({ name: 'InternalError' })).toBe(
      true
    );
    expect(
      (service as any).isRetryableError({ $metadata: { httpStatusCode: 503 } })
    ).toBe(true);
    expect((service as any).isRetryableError({ code: 'ECONNRESET' })).toBe(
      true
    );
    expect((service as any).isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
    expect((service as any).isRetryableError({ name: 'ValidationError' })).toBe(
      false
    );
  });

  it('sleep resolves after timeout callback', async () => {
    const { service } = makeService();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    await expect((service as any).sleep(1)).resolves.toBeUndefined();

    expect(setTimeoutSpy).toHaveBeenCalled();
  });
});
