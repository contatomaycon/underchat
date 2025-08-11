import { injectable } from 'tsyringe';
import { s3Environment } from '@core/config/environments';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { extension as mimeToExt } from 'mime-types';
import { fileTypeFromBuffer } from 'file-type';

@injectable()
export class StorageService {
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: s3Environment.s3Region,
      credentials: {
        accessKeyId: s3Environment.s3AccessKeyId,
        secretAccessKey: s3Environment.s3SecretAccessKey,
      },
      endpoint: s3Environment.s3Endpoint,
      forcePathStyle: true,
    });
  }

  public async uploadImage(
    file: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    const extension = this.getFileExtension(file.filename);

    if (!extension) {
      return null;
    }

    const buffer = await file.toBuffer();
    const path = `${accountId}/${file.filename}`;

    const command = new PutObjectCommand({
      Bucket: s3Environment.s3BucketName,
      Key: path,
      Body: buffer,
      ContentType: file.mimetype,
    });

    try {
      await this.client.send(command);

      return {
        url: this.createUrl(path),
        name: file.filename,
        extension,
        size: buffer.byteLength,
      };
    } catch (err) {
      throw err;
    }
  }

  public async uploadFromUrl(
    url: string,
    accountId: string,
    filenameHint?: string
  ): Promise<UploadFileResponse | null> {
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);

    const contentTypeHeader =
      res.headers.get('content-type') ?? 'application/octet-stream';
    const contentType = contentTypeHeader.split(';')[0].trim();

    const dispoName = this.parseDispositionFilename(
      res.headers.get('content-disposition')
    );
    const urlName = (() => {
      const u = new URL(url);
      return decodeURIComponent(
        u.pathname.split('/').filter(Boolean).pop() ?? ''
      );
    })();

    const guessedName =
      filenameHint || dispoName || urlName || `file-${Date.now()}`;

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    let ext =
      this.getFileExtension(guessedName) || this.extFromMime(contentType);

    let sniffedMime: string | undefined;
    if (!ext) {
      const ft = await fileTypeFromBuffer(buffer).catch(() => null);
      if (ft?.ext) {
        ext = ft.ext;
        sniffedMime = ft.mime;
      }
    }

    const finalExt = ext || 'bin';
    const baseName = this.getFileExtension(guessedName)
      ? guessedName
      : `${guessedName}.${finalExt}`;
    const key = `${accountId}/${baseName}`;
    const mimeToStore = sniffedMime || contentTypeHeader;

    await this.client.send(
      new PutObjectCommand({
        Bucket: s3Environment.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeToStore,
      })
    );

    return {
      url: this.createUrl(key),
      name: baseName,
      extension: finalExt,
      size: buffer.byteLength,
    };
  }

  private parseDispositionFilename(disposition?: string | null) {
    if (!disposition) return '';

    const utf8 = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
    if (utf8) return decodeURIComponent(utf8);

    const simple =
      disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ||
      disposition.match(/filename\s*=\s*([^;]+)/i)?.[1];

    return simple?.trim() ?? '';
  }

  private getFileExtension(name: string) {
    const m = name.match(/\.([^.\/\\]+)$/);

    return m ? m[1].toLowerCase() : '';
  }

  private extFromMime(m: string): string | null {
    const clean = (m || '').toLowerCase().split(';')[0].trim();

    return (mimeToExt(clean) as string) || null;
  }

  public createUrl = (path: string) =>
    `${s3Environment.s3Endpoint}/${s3Environment.s3BucketName}/${path}`;
}
