import { inject, injectable } from 'tsyringe';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { s3Environment } from '@core/config/environments';
import { UploadFileRequest } from '@core/schema/upload/request.schema';

const MAX_CERTIFICATE_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_CERTIFICATE_EXTENSIONS = ['pfx', 'p12'];
const ALLOWED_CERTIFICATE_MIMETYPES = [
  'application/x-pkcs12',
  'application/pkcs12',
  'application/x-pkcs#12',
  'application/octet-stream',
];

export interface NfseCertificateUploadResult {
  bucket: string;
  key: string;
  fileName: string;
  uploadedAt: string;
}

@injectable()
export class NfseCertificateStorageService {
  constructor(
    @inject('S3Client')
    private readonly client: S3Client,
    @inject('S3ClientBackup')
    private readonly backupClient: S3Client
  ) {}

  private getBucketName(): string {
    return s3Environment.s3NfseCertificateBucket;
  }

  private isBucketAlreadyExistsError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const err = error as { name?: string; Code?: string };
    const code = err.name ?? err.Code;

    return code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists';
  }

  private async ensureBucketExistsInClient(
    client: S3Client,
    bucket: string
  ): Promise<void> {
    try {
      await client.send(
        new CreateBucketCommand({
          Bucket: bucket,
        })
      );
    } catch (error) {
      if (this.isBucketAlreadyExistsError(error)) {
        return;
      }

      throw error;
    }
  }

  private async ensureBucketExists(bucket: string): Promise<void> {
    const results = await Promise.allSettled([
      this.ensureBucketExistsInClient(this.client, bucket),
      this.ensureBucketExistsInClient(this.backupClient, bucket),
    ]);

    const hasAtLeastOneSuccess = results.some(
      (result) => result.status === 'fulfilled'
    );

    if (!hasAtLeastOneSuccess) {
      throw new Error('NFSE_CERTIFICATE_BUCKET_CREATE_ERROR');
    }
  }

  private getFileExtension(fileName: string): string {
    const match = /\.([^./\\]+)$/.exec(fileName);
    return match ? match[1].toLowerCase() : '';
  }

  private validateCertificateFile(file: UploadFileRequest): string {
    const extension = this.getFileExtension(file.filename);

    if (!ALLOWED_CERTIFICATE_EXTENSIONS.includes(extension)) {
      throw new Error('NFSE_CERTIFICATE_INVALID_FORMAT');
    }

    const mimetype = file.mimetype?.toLowerCase();
    if (
      mimetype &&
      mimetype.trim().length > 0 &&
      !ALLOWED_CERTIFICATE_MIMETYPES.includes(mimetype)
    ) {
      throw new Error('NFSE_CERTIFICATE_INVALID_FORMAT');
    }

    return extension;
  }

  private async uploadWithFallback(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
      return;
    } catch {
      await this.backupClient.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
    }
  }

  async uploadCertificate(
    file: UploadFileRequest,
    accountId: string
  ): Promise<NfseCertificateUploadResult> {
    const extension = this.validateCertificateFile(file);
    const buffer = await file.toBuffer();

    if (buffer.byteLength > MAX_CERTIFICATE_UPLOAD_BYTES) {
      throw new Error('NFSE_CERTIFICATE_SIZE_LIMIT_EXCEEDED');
    }

    const bucket = this.getBucketName();
    const key = `nfse/certificates/${accountId}/${randomUUID()}.${extension}`;
    const contentType = file.mimetype ?? 'application/x-pkcs12';

    await this.ensureBucketExists(bucket);
    await this.uploadWithFallback(bucket, key, buffer, contentType);

    return {
      bucket,
      key,
      fileName: file.filename,
      uploadedAt: new Date().toISOString(),
    };
  }

  async deleteCertificate(bucket: string, key: string): Promise<void> {
    if (!bucket || !key) {
      return;
    }

    await Promise.allSettled([
      this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      ),
      this.backupClient.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      ),
    ]);
  }

  private async downloadCertificateWithClient(
    client: S3Client,
    bucket: string,
    key: string
  ): Promise<Buffer> {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error('NFSE_CERTIFICATE_NOT_FOUND');
    }

    if (typeof response.Body.transformToByteArray === 'function') {
      const array = await response.Body.transformToByteArray();
      return Buffer.from(array);
    }

    const body = response.Body as AsyncIterable<Uint8Array>;
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async downloadCertificate(bucket: string, key: string): Promise<Buffer> {
    try {
      return await this.downloadCertificateWithClient(this.client, bucket, key);
    } catch {
      return this.downloadCertificateWithClient(this.backupClient, bucket, key);
    }
  }
}
