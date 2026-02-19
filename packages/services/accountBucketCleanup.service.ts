import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { withLock } from '@core/common/functions/withLock';
import { IExpiredAccountBucket } from '@core/common/interfaces/IExpiredAccountBucket';
import { AccountExpiredBucketCleanupRepository } from '@core/repositories/account/AccountExpiredBucketCleanup.repository';
import Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AccountBucketCleanupService {
  private readonly concurrency = 5;
  private readonly maxProviderDeleteAttempts = 3;
  private readonly retryDelayMs = 1000;

  constructor(
    @inject(AccountExpiredBucketCleanupRepository)
    private readonly accountExpiredBucketCleanupRepository: AccountExpiredBucketCleanupRepository,
    @inject('S3Client')
    private readonly s3Client: S3Client,
    @inject('S3ClientBackup')
    private readonly s3BackupClient: S3Client,
    @inject('Redis') private readonly redis: Redis
  ) {}

  processExpiredAccounts = async (): Promise<void> => {
    const accounts =
      await this.accountExpiredBucketCleanupRepository.listAccountsWithExpiredPlanAndBucketPendingDeletion();

    if (accounts.length === 0) {
      return;
    }

    for (let i = 0; i < accounts.length; i += this.concurrency) {
      const batch = accounts.slice(i, i + this.concurrency);

      const batchResult = await Promise.allSettled(
        batch.map((item) => this.processAccount(item))
      );

      for (const [index, result] of batchResult.entries()) {
        if (result.status === 'fulfilled') {
          continue;
        }

        console.error(
          `Erro ao limpar bucket da account ${batch[index].account_id}:`,
          result.reason
        );
      }
    }
  };

  private readonly processAccount = async (
    item: IExpiredAccountBucket
  ): Promise<void> => {
    const lockKey = `account-bucket-cleanup:${item.account_id}`;

    await withLock(
      this.redis,
      lockKey,
      async () => {
        const deleted = await this.deleteBucketOnAllProviders(item.account_id);
        if (!deleted) {
          return;
        }

        await this.accountExpiredBucketCleanupRepository.markBucketAsDeleted(
          item.account_id
        );
      },
      {
        ttlMs: 60000,
        retryMs: 100,
      }
    );
  };

  private readonly deleteBucketOnAllProviders = async (
    accountId: string
  ): Promise<boolean> => {
    const providers: Array<{ name: string; client: S3Client }> = [
      { name: 'primary', client: this.s3Client },
      { name: 'backup', client: this.s3BackupClient },
    ];

    for (const provider of providers) {
      try {
        await this.deleteBucketWithRetry(provider.client, accountId);
      } catch (error) {
        console.error(
          `Erro ao remover bucket "${accountId}" no provedor ${provider.name}:`,
          error
        );
        return false;
      }
    }

    return true;
  };

  private readonly deleteBucketWithRetry = async (
    client: S3Client,
    bucketId: string
  ): Promise<void> => {
    for (let attempt = 0; attempt < this.maxProviderDeleteAttempts; attempt++) {
      try {
        await this.emptyBucket(client, bucketId);
        await client.send(
          new DeleteBucketCommand({
            Bucket: bucketId,
          })
        );
        return;
      } catch (error: any) {
        if (this.isNoSuchBucketError(error)) {
          return;
        }

        const shouldRetry =
          attempt < this.maxProviderDeleteAttempts - 1 &&
          (this.isRetryableError(error) || this.isBucketNotEmptyError(error));

        if (shouldRetry) {
          await this.sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw error;
      }
    }
  };

  private readonly emptyBucket = async (
    client: S3Client,
    bucketId: string
  ): Promise<void> => {
    let continuationToken: string | undefined;

    do {
      const listResult = await client.send(
        new ListObjectsV2Command({
          Bucket: bucketId,
          ContinuationToken: continuationToken,
        })
      );

      const objects = (listResult.Contents ?? [])
        .map((item) => item.Key)
        .filter((key): key is string => Boolean(key))
        .map((key) => ({ Key: key }));

      if (objects.length > 0) {
        const deleteResult = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucketId,
            Delete: {
              Objects: objects,
              Quiet: true,
            },
          })
        );

        if ((deleteResult.Errors?.length ?? 0) > 0) {
          const firstError = deleteResult.Errors?.[0];
          const errorMessage = firstError
            ? `${firstError.Code ?? 'DeleteError'}: ${firstError.Message ?? ''}`
            : 'DeleteError: unknown error while deleting objects';
          throw new Error(errorMessage.trim());
        }
      }

      continuationToken = listResult.IsTruncated
        ? listResult.NextContinuationToken
        : undefined;
    } while (continuationToken);
  };

  private readonly isNoSuchBucketError = (error: any): boolean => {
    return (
      error?.name === 'NoSuchBucket' ||
      error?.Code === 'NoSuchBucket' ||
      error?.$metadata?.httpStatusCode === 404
    );
  };

  private readonly isBucketNotEmptyError = (error: any): boolean => {
    return error?.name === 'BucketNotEmpty' || error?.Code === 'BucketNotEmpty';
  };

  private readonly isRetryableError = (error: any): boolean => {
    if (!error) {
      return false;
    }

    if (
      error.name === 'InternalError' ||
      error.name === 'ServiceUnavailable' ||
      error.name === 'RequestTimeout'
    ) {
      return true;
    }

    if (error.$metadata?.httpStatusCode) {
      const statusCode = error.$metadata.httpStatusCode;
      if ((statusCode >= 500 && statusCode < 600) || statusCode === 429) {
        return true;
      }
    }

    return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
  };

  private readonly sleep = async (ms: number): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };
}
