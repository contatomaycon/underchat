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

  async uploadWithRetry(params: UploadParams): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.attemptUpload(params);
        return;
      } catch (error: any) {
        lastError = error;

        if (attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Upload failed after all retries');
  }
}
