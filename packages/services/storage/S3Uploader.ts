import { injectable, inject } from 'tsyringe';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export interface UploadParams {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
  accountId?: string;
  expiresAt?: Date;
  tagging?: string;
}

export interface UploadWithRetryResult {
  usedBackup: boolean;
  primaryAttempts: number;
  backupAttempts: number;
  primaryError: string | null;
  backupError: string | null;
}

@injectable()
export class S3Uploader {
  constructor(
    @inject('S3Client')
    private readonly client: S3Client,
    @inject('S3ClientBackup')
    private readonly backupClient: S3Client,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService
  ) {}

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async attemptUpload(
    client: S3Client,
    params: UploadParams
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      Expires: params.expiresAt,
      Tagging: params.tagging,
    });

    await client.send(command);
  }

  private async uploadWithRetryToClient(
    client: S3Client,
    params: UploadParams
  ): Promise<{ attempts: number }> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.attemptUpload(client, params);
        return { attempts: attempt + 1 };
      } catch (error: unknown) {
        lastError = error;
        console.error('[S3Uploader] Upload attempt failed', {
          bucket: params.bucket,
          key: params.key,
          contentType: params.contentType,
          size: params.body.byteLength,
          attempt: attempt + 1,
          maxAttempts: MAX_RETRIES,
          ...workerErrorDiagnostics(error),
        });

        if (attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          await this.sleep(delay);
          continue;
        }
      }
    }

    throw this.buildAttemptsExceededError(lastError, MAX_RETRIES);
  }

  async uploadWithRetry(params: UploadParams): Promise<UploadWithRetryResult> {
    try {
      const primaryResult = await this.uploadWithRetryToClient(
        this.client,
        params
      );

      return {
        usedBackup: false,
        primaryAttempts: primaryResult.attempts,
        backupAttempts: 0,
        primaryError: null,
        backupError: null,
      };
    } catch (primaryError) {
      const primaryAttempts = this.getAttemptsFromError(primaryError);
      const primaryErrorMessage = this.toErrorMessage(primaryError);

      try {
        const backupResult = await this.uploadWithRetryToClient(
          this.backupClient,
          params
        );

        await this.registerBackupFallbackUpload(params, {
          primaryAttempts,
          backupAttempts: backupResult.attempts,
          primaryError: primaryErrorMessage,
          backupError: null,
        });

        return {
          usedBackup: true,
          primaryAttempts,
          backupAttempts: backupResult.attempts,
          primaryError: primaryErrorMessage,
          backupError: null,
        };
      } catch (backupError) {
        const backupErrorMessage = this.toErrorMessage(backupError);

        throw new Error(
          `S3 upload failed on primary and backup: primary=${primaryErrorMessage}; backup=${backupErrorMessage}`
        );
      }
    }
  }

  private getAttemptsFromError(error: unknown): number {
    if (
      typeof error === 'object' &&
      error !== null &&
      'attempts' in error &&
      typeof (error as any).attempts === 'number'
    ) {
      return (error as any).attempts;
    }

    return MAX_RETRIES;
  }

  private buildAttemptsExceededError(error: unknown, attempts: number): Error {
    const wrappedError = new Error(this.toErrorMessage(error));
    (wrappedError as any).attempts = attempts;
    (wrappedError as any).originalError = error;
    return wrappedError;
  }

  private toErrorMessage(error: unknown): string {
    if (!error) {
      return 'Unknown upload error';
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown upload error';
    }
  }

  private extractFileName(key: string): string | null {
    const parts = key.split('/').filter(Boolean);
    if (!parts.length) {
      return null;
    }

    return parts[parts.length - 1] ?? null;
  }

  private resolveAccountId(bucket: string, key: string): string | null {
    const bucketValue = bucket.trim();
    if (bucketValue) {
      return bucketValue;
    }

    const nfseAccountMatch = /^nfse\/certificates\/([^/]+)\//.exec(key);
    if (nfseAccountMatch?.[1]) {
      return nfseAccountMatch[1];
    }

    return null;
  }

  private async registerBackupFallbackUpload(
    params: UploadParams,
    metadata: {
      primaryAttempts: number;
      backupAttempts: number;
      primaryError: string | null;
      backupError: string | null;
    }
  ): Promise<void> {
    const accountId =
      params.accountId ?? this.resolveAccountId(params.bucket, params.key);
    if (!accountId) {
      return;
    }

    const payload = {
      account_id: accountId,
      bucket: params.bucket,
      object_key: params.key,
      file_name: this.extractFileName(params.key),
      content_type: params.contentType,
      size_bytes: params.body.byteLength,
      primary_attempts: metadata.primaryAttempts,
      backup_attempts: metadata.backupAttempts,
      primary_error: metadata.primaryError,
      backup_error: metadata.backupError,
    };

    try {
      await this.balanceWorkerStatusGrpcClientService.registerS3BackupFallbackUpload(
        payload
      );
    } catch (error) {
      console.error('Erro ao registrar fallback no S3 backup', {
        ...workerErrorDiagnostics(error),
      });
    }
  }
}
