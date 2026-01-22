import {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  DeletePublicAccessBlockCommand,
} from '@aws-sdk/client-s3';

export class BucketManager {
  private readonly verifiedBuckets = new Set<string>();

  constructor(private readonly client: S3Client) {}

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
    try {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: bucketId,
        })
      );
    } catch (createError: any) {
      if (this.isBucketExistsError(createError)) {
        this.verifiedBuckets.add(bucketId);
        return;
      }
      throw createError;
    }
  }

  private async removePublicAccessBlock(bucketId: string): Promise<void> {
    try {
      await this.client.send(
        new DeletePublicAccessBlockCommand({
          Bucket: bucketId,
        })
      );
    } catch (error: any) {
      if (
        error.name !== 'NoSuchPublicAccessBlockConfiguration' &&
        !this.isBucketExistsError(error) &&
        !this.isNoSuchBucketError(error)
      ) {
        throw error;
      }
    }
  }

  private async setPublicPolicy(bucketId: string): Promise<void> {
    const publicReadPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucketId}/*`,
        },
      ],
    };

    try {
      await this.client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketId,
          Policy: JSON.stringify(publicReadPolicy),
        })
      );
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
      throw error;
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

    this.verifiedBuckets.add(bucketId);

    return bucketId;
  }

  isBucketVerified(accountId: string): boolean {
    const bucketId = this.validateAccountId(accountId);
    return this.verifiedBuckets.has(bucketId);
  }

  validateAndGetBucketId(accountId: string): string {
    return this.validateAccountId(accountId);
  }
}
