import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface UploadParams {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}

export class S3Uploader {
  constructor(private readonly client: S3Client) {}

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async attemptUpload(params: UploadParams): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    });

    await this.client.send(command);
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

  async uploadWithRetry(params: UploadParams): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.attemptUpload(params);
        return;
      } catch (error: any) {
        lastError = error;

        const shouldRetry =
          attempt < MAX_RETRIES - 1 && this.isRetryableError(error);

        if (shouldRetry) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          await this.sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Upload failed after all retries');
  }
}
