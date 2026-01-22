import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const VERIFICATION_DELAY_MS = 2000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class S3Deleter {
  constructor(private readonly client: S3Client) {}

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

  private async objectExists(bucket: string, key: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        return true;
      } catch (error: any) {
        if (
          error.name === 'NotFound' ||
          error.name === 'NoSuchKey' ||
          this.isNoSuchBucketError(error)
        ) {
          return false;
        }

        const shouldRetry =
          attempt < MAX_RETRIES - 1 && this.isRetryableError(error);

        if (shouldRetry) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    return false;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async deleteObject(bucket: string, key: string): Promise<boolean> {
    const existsBefore = await this.objectExists(bucket, key);
    if (!existsBefore) {
      return true;
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        break;
      } catch (error: any) {
        if (this.isNoSuchBucketError(error)) {
          return false;
        }

        const shouldRetry =
          attempt < MAX_RETRIES - 1 && this.isRetryableError(error);

        if (shouldRetry) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt++) {
      const delay = VERIFICATION_DELAY_MS * (attempt + 1);
      await this.sleep(delay);

      const stillExists = await this.objectExists(bucket, key);
      if (!stillExists) {
        return true;
      }
    }

    await this.sleep(VERIFICATION_DELAY_MS * 2);

    const finalCheck = await this.objectExists(bucket, key);
    if (finalCheck) {
      return false;
    }

    return true;
  }
}
