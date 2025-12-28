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
    return accountId.trim();
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

  async ensurePublicBucket(accountId: string): Promise<void> {
    if (this.verifiedBuckets.has(accountId)) {
      return;
    }

    const bucketId = this.validateAccountId(accountId);

    await this.createBucket(bucketId);
    await this.removePublicAccessBlock(bucketId);
    await this.setPublicPolicy(bucketId);

    this.verifiedBuckets.add(bucketId);
  }

  isBucketVerified(accountId: string): boolean {
    return this.verifiedBuckets.has(accountId);
  }
}
