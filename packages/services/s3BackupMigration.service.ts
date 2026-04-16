import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  LockAcquisitionTimeoutError,
  withLock,
} from '@core/common/functions/withLock';
import {
  S3BackupUploadMigrationItem,
  S3BackupUploadRepository,
} from '@core/repositories/s3BackupUpload/S3BackupUpload.repository';
import Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const DELETE_VERIFICATION_ATTEMPTS = 5;
const DEFAULT_BATCH_LIMIT = 200;
const DEFAULT_CONCURRENCY = 5;

interface DownloadedObject {
  buffer: Buffer;
  contentType: string | null;
  size: number;
}

@injectable()
export class S3BackupMigrationService {
  private readonly batchLimit = DEFAULT_BATCH_LIMIT;
  private readonly concurrency = DEFAULT_CONCURRENCY;

  constructor(
    @inject(S3BackupUploadRepository)
    private readonly s3BackupUploadRepository: S3BackupUploadRepository,
    @inject('S3Client')
    private readonly s3Client: S3Client,
    @inject('S3ClientBackup')
    private readonly s3BackupClient: S3Client,
    @inject('Redis') private readonly redis: Redis
  ) {}

  processPendingUploads = async (): Promise<void> => {
    const pendingUploads =
      await this.s3BackupUploadRepository.listPendingMigrations(
        this.batchLimit
      );

    if (!pendingUploads.length) {
      return;
    }

    for (let i = 0; i < pendingUploads.length; i += this.concurrency) {
      const chunk = pendingUploads.slice(i, i + this.concurrency);

      const results = await Promise.allSettled(
        chunk.map((item) => this.processUploadById(item.s3_backup_upload_id))
      );

      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          continue;
        }

        console.error(
          `Erro ao migrar upload ${chunk[index].s3_backup_upload_id}:`,
          result.reason
        );
      }
    }
  };

  reprocessById = async (s3BackupUploadId: string): Promise<boolean> => {
    const item = await this.s3BackupUploadRepository.viewById(s3BackupUploadId);
    if (!item || item.deleted_at) {
      return false;
    }

    await this.processUploadById(s3BackupUploadId);
    return true;
  };

  private readonly processUploadById = async (
    s3BackupUploadId: string
  ): Promise<void> => {
    const lockKey = `s3-backup-upload-migration:${s3BackupUploadId}`;

    try {
      await withLock(
        this.redis,
        lockKey,
        async () => {
          const item =
            await this.s3BackupUploadRepository.viewById(s3BackupUploadId);

          if (!item || item.deleted_at) {
            return;
          }

          const nextAttempts = (item.migration_attempts ?? 0) + 1;
          await this.s3BackupUploadRepository.updateAsProcessing(
            s3BackupUploadId,
            nextAttempts
          );

          try {
            await this.migrateUpload(item, nextAttempts);
          } catch (error) {
            await this.s3BackupUploadRepository.updateAsFailed(
              s3BackupUploadId,
              this.toErrorMessage(error),
              nextAttempts
            );
          }
        },
        {
          ttlMs: 120000,
          retryMs: 100,
          maxWaitMs: 500,
        }
      );
    } catch (error) {
      if (error instanceof LockAcquisitionTimeoutError) {
        return;
      }

      throw error;
    }
  };

  private readonly migrateUpload = async (
    item: S3BackupUploadMigrationItem,
    nextAttempts: number
  ): Promise<void> => {
    const backupObject = await this.downloadObjectWithRetry(
      this.s3BackupClient,
      item.bucket,
      item.object_key
    );

    const backupHash = this.hashBuffer(backupObject.buffer);

    const primaryObject = await this.downloadPrimaryIfExists(
      item.bucket,
      item.object_key
    );

    const shouldUploadToPrimary =
      !primaryObject ||
      primaryObject.size !== backupObject.size ||
      this.hashBuffer(primaryObject.buffer) !== backupHash;

    if (shouldUploadToPrimary) {
      await this.uploadObjectWithRetry(
        item.bucket,
        item.object_key,
        backupObject.buffer,
        backupObject.contentType ?? item.content_type ?? undefined
      );
    }

    const verifiedPrimary = await this.downloadObjectWithRetry(
      this.s3Client,
      item.bucket,
      item.object_key
    );

    const verifiedHash = this.hashBuffer(verifiedPrimary.buffer);
    const hashMatches = verifiedHash === backupHash;
    const sizeMatches = verifiedPrimary.size === backupObject.size;

    if (!hashMatches || !sizeMatches) {
      throw new Error('S3_BACKUP_MIGRATION_PRIMARY_VALIDATION_FAILED');
    }

    await this.deleteObjectWithRetry(item.bucket, item.object_key);

    const deleted = await this.waitUntilBackupDeleted(
      item.bucket,
      item.object_key
    );
    if (!deleted) {
      throw new Error('S3_BACKUP_MIGRATION_BACKUP_DELETE_VALIDATION_FAILED');
    }

    await this.s3BackupUploadRepository.softDeleteAsMigrated(
      item.s3_backup_upload_id,
      nextAttempts
    );
  };

  private readonly downloadPrimaryIfExists = async (
    bucket: string,
    key: string
  ): Promise<DownloadedObject | null> => {
    const exists = await this.objectExists(this.s3Client, bucket, key);
    if (!exists) {
      return null;
    }

    return this.downloadObjectWithRetry(this.s3Client, bucket, key);
  };

  private readonly objectExists = async (
    client: S3Client,
    bucket: string,
    key: string
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        return true;
      } catch (error: any) {
        if (this.isObjectNotFoundError(error)) {
          return false;
        }

        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    return false;
  };

  private readonly downloadObjectWithRetry = async (
    client: S3Client,
    bucket: string,
    key: string
  ): Promise<DownloadedObject> => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );

        if (!response.Body) {
          throw new Error('S3_BACKUP_MIGRATION_OBJECT_BODY_EMPTY');
        }

        const buffer = await this.objectBodyToBuffer(response.Body);

        return {
          buffer,
          contentType: response.ContentType ?? null,
          size: buffer.byteLength,
        };
      } catch (error: any) {
        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    throw new Error('S3_BACKUP_MIGRATION_DOWNLOAD_FAILED');
  };

  private readonly uploadObjectWithRetry = async (
    bucket: string,
    key: string,
    body: Buffer,
    contentType?: string
  ): Promise<void> => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
          })
        );
        return;
      } catch (error) {
        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }
  };

  private readonly deleteObjectWithRetry = async (
    bucket: string,
    key: string
  ): Promise<void> => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.s3BackupClient.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        return;
      } catch (error) {
        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }
  };

  private readonly waitUntilBackupDeleted = async (
    bucket: string,
    key: string
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < DELETE_VERIFICATION_ATTEMPTS; attempt++) {
      const exists = await this.objectExists(this.s3BackupClient, bucket, key);
      if (!exists) {
        return true;
      }

      await this.sleep(RETRY_DELAY_MS * (attempt + 1));
    }

    return false;
  };

  private readonly objectBodyToBuffer = async (body: any): Promise<Buffer> => {
    if (typeof body.transformToByteArray === 'function') {
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  };

  private readonly hashBuffer = (buffer: Buffer): string => {
    return createHash('sha256').update(buffer).digest('hex');
  };

  private readonly isObjectNotFoundError = (error: any): boolean => {
    return (
      error?.name === 'NoSuchKey' ||
      error?.Code === 'NoSuchKey' ||
      error?.name === 'NotFound' ||
      error?.$metadata?.httpStatusCode === 404
    );
  };

  private readonly toErrorMessage = (error: unknown): string => {
    if (!error) {
      return 'Unknown migration error';
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return JSON.stringify(error);
  };

  private readonly sleep = async (ms: number): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };
}
