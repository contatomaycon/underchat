import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const VERIFICATION_DELAY_MS = 2000;
const MAX_VERIFICATION_ATTEMPTS = 5;

export class S3Deleter {
  constructor(private readonly client: S3Client) {}

  private isNoSuchBucketError(error: any): boolean {
    return (
      error.name === 'NoSuchBucket' ||
      error.Code === 'NoSuchBucket' ||
      error.$metadata?.httpStatusCode === 404
    );
  }

  private async objectExists(bucket: string, key: string): Promise<boolean> {
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
      throw error;
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async deleteObject(bucket: string, key: string): Promise<boolean> {
    const existsBefore = await this.objectExists(bucket, key);
    if (!existsBefore) {
      return true;
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
    } catch (error: any) {
      if (this.isNoSuchBucketError(error)) {
        return false;
      }
      throw error;
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
