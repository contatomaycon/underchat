import { injectable, inject } from 'tsyringe';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  DeletePublicAccessBlockCommand,
  PutBucketLifecycleConfigurationCommand,
  ExpirationStatus,
} from '@aws-sdk/client-s3';

const EXPIRATION_DAYS = 180; // 6 months

@injectable()
export class BucketManager {
  private readonly verifiedBuckets = new Set<string>();

  constructor(
    @inject('S3Client')
    private readonly client: S3Client
  ) {}

  private isBucketExistsError(error: any): boolean {
    return (
      error.name === 'BucketAlreadyOwnedByYou' ||
      error.name === 'BucketAlreadyExists' ||
      error.Code === 'BucketAlreadyOwnedByYou' ||
      error.Code === 'BucketAlreadyExists' ||
      error.name === 'BucketNotEmpty' ||
      error.Code === 'BucketNotEmpty'
    );
  }

  private isNoSuchBucketError(error: any): boolean {
    return (
      error.name === 'NoSuchBucket' ||
      error.Code === 'NoSuchBucket' ||
      error.$metadata?.httpStatusCode === 404
    );
  }

  private isRetryableError(error: any): boolean {
    if (!error) {
      return false;
    }

    if (error.name === 'InternalError') {
      return true;
    }

    if (error.name === 'ServiceUnavailable') {
      return true;
    }

    if (error.name === 'RequestTimeout') {
      return true;
    }

    if (error.$metadata?.httpStatusCode) {
      const statusCode = error.$metadata.httpStatusCode;
      if (statusCode >= 500 && statusCode < 600) {
        return true;
      }
      if (statusCode === 429) {
        return true;
      }
    }

    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }

    return false;
  }

  private validateAccountId(accountId: string): string {
    if (
      !accountId ||
      typeof accountId !== 'string' ||
      accountId.trim() === ''
    ) {
      throw new Error('Invalid accountId provided');
    }

    const bucketId = accountId.trim();

    if (bucketId.length < 3 || bucketId.length > 63) {
      throw new Error('Bucket name must be between 3 and 63 characters');
    }

    if (!/^[a-z0-9.-]+$/.test(bucketId)) {
      throw new Error(
        'Bucket name can only contain lowercase letters, numbers, dots, and hyphens'
      );
    }

    if (bucketId.startsWith('.') || bucketId.endsWith('.')) {
      throw new Error('Bucket name cannot start or end with a dot');
    }

    if (bucketId.startsWith('-') || bucketId.endsWith('-')) {
      throw new Error('Bucket name cannot start or end with a hyphen');
    }

    if (bucketId.includes('..')) {
      throw new Error('Bucket name cannot contain consecutive dots');
    }

    if (/^\d+\.\d+\.\d+\.\d+$/.test(bucketId)) {
      throw new Error('Bucket name cannot be formatted as an IP address');
    }

    return bucketId;
  }

  private async createBucket(bucketId: string): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.info('[BucketManager] Creating S3 bucket', {
          bucket: bucketId,
          attempt: attempt + 1,
        });
        await this.client.send(
          new CreateBucketCommand({
            Bucket: bucketId,
          })
        );
        return;
      } catch (createError: any) {
        if (this.isBucketExistsError(createError)) {
          this.verifiedBuckets.add(bucketId);
          return;
        }

        const shouldRetry =
          attempt < MAX_RETRIES - 1 && this.isRetryableError(createError);

        if (shouldRetry) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1))
          );
          continue;
        }

        throw createError;
      }
    }
  }

  private async bucketExists(bucketId: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: bucketId,
        })
      );
      return true;
    } catch (error: any) {
      if (this.isNoSuchBucketError(error)) {
        return false;
      }

      throw error;
    }
  }

  private isPublicAccessBlockUnsupportedError(error: any): boolean {
    if (!error) return false;
    const code = error.name ?? error.Code;
    const msg = (error.message ?? error.Message ?? '').toLowerCase();
    return (
      code === 'InvalidRequest' ||
      code === 'AccessDenied' ||
      code === 'NotImplemented' ||
      msg.includes('publicaccessblock') ||
      msg.includes('not supported')
    );
  }

  private async removePublicAccessBlock(bucketId: string): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.client.send(
          new DeletePublicAccessBlockCommand({
            Bucket: bucketId,
          })
        );
        return;
      } catch (error: any) {
        if (
          error.name === 'NoSuchPublicAccessBlockConfiguration' ||
          this.isBucketExistsError(error) ||
          this.isNoSuchBucketError(error) ||
          this.isPublicAccessBlockUnsupportedError(error)
        ) {
          return;
        }

        const shouldRetry =
          attempt < MAX_RETRIES - 1 && this.isRetryableError(error);

        if (shouldRetry) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1))
          );
          continue;
        }

        throw error;
      }
    }
  }

  private isLifecycleNotSupportedError(error: any): boolean {
    if (!error) return false;
    const code = error.name ?? error.Code;
    return (
      code === 'NotImplemented' ||
      code === 'MethodNotAllowed' ||
      code === 'InvalidRequest'
    );
  }

  private async setLifecyclePolicy(bucketId: string): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

    const lifecycleConfig = {
      Rules: [
        {
          ID: 'ExpireAfter6Months',
          Status: ExpirationStatus.Enabled,
          Filter: {},
          Expiration: {
            Days: EXPIRATION_DAYS,
          },
        },
      ],
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: bucketId,
            LifecycleConfiguration: lifecycleConfig,
          })
        );
        return;
      } catch (error: any) {
        if (this.isLifecycleNotSupportedError(error)) {
          return;
        }

        if (this.isNoSuchBucketError(error)) {
          return;
        }

        const shouldRetry =
          attempt < MAX_RETRIES - 1 && this.isRetryableError(error);

        if (shouldRetry) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1))
          );
          continue;
        }

        throw error;
      }
    }
  }

  private async setPublicPolicy(bucketId: string): Promise<void> {
    const publicReadPolicy = {
      Id: 'PublicReadGetObject',
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucketId}/*`],
        },
      ],
    };

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.client.send(
          new PutBucketPolicyCommand({
            Bucket: bucketId,
            Policy: JSON.stringify(publicReadPolicy),
          })
        );
        return;
      } catch (error: any) {
        if (this.isNoSuchBucketError(error)) {
          await this.createBucket(bucketId);
          await this.client.send(
            new PutBucketPolicyCommand({
              Bucket: bucketId,
              Policy: JSON.stringify(publicReadPolicy),
            })
          );
          return;
        }

        if (this.isBucketExistsError(error)) {
          this.verifiedBuckets.add(bucketId);
          return;
        }

        const shouldRetry =
          attempt < MAX_RETRIES - 1 && this.isRetryableError(error);

        if (shouldRetry) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1))
          );
          continue;
        }

        throw error;
      }
    }
  }

  async ensurePublicBucket(accountId: string): Promise<string> {
    const bucketId = this.validateAccountId(accountId);

    if (this.verifiedBuckets.has(bucketId)) {
      return bucketId;
    }

    await this.createBucket(bucketId);
    await this.removePublicAccessBlock(bucketId);
    await this.setPublicPolicy(bucketId);
    await this.setLifecyclePolicy(bucketId);

    this.verifiedBuckets.add(bucketId);

    return bucketId;
  }

  async isBucketReady(accountId: string): Promise<boolean> {
    const bucketId = this.validateAccountId(accountId);

    if (!this.verifiedBuckets.has(bucketId)) {
      return false;
    }

    const exists = await this.bucketExists(bucketId);

    if (exists) {
      return true;
    }

    this.verifiedBuckets.delete(bucketId);
    console.warn('[BucketManager] Cached S3 bucket no longer exists', {
      bucket: bucketId,
    });

    return false;
  }

  isBucketVerified(accountId: string): boolean {
    const bucketId = this.validateAccountId(accountId);
    return this.verifiedBuckets.has(bucketId);
  }

  validateAndGetBucketId(accountId: string): string {
    return this.validateAccountId(accountId);
  }
}
