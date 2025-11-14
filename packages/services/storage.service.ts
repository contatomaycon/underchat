import { injectable } from 'tsyringe';
import { s3Environment } from '@core/config/environments';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { extension as mimeToExt } from 'mime-types';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

const MAX_IMAGE_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_BYTES = 16 * 1024 * 1024;

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

  private converterFilename(filename: string): string {
    return filename.replace(/ /g, '_');
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

    if (buffer.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
      throw new Error('IMAGE_SIZE_LIMIT_EXCEEDED');
    }

    const path = `${accountId}/${this.converterFilename(file.filename)}`;

    let width: number | null = null;
    let height: number | null = null;
    let mimetype: string | null = file.mimetype ?? null;

    try {
      const metadata = await sharp(buffer).metadata();

      width = metadata.width ?? null;
      height = metadata.height ?? null;

      if (!mimetype && metadata.format) {
        mimetype = `image/${metadata.format}`;
      }
    } catch {
      width = null;
      height = null;
    }

    const command = new PutObjectCommand({
      Bucket: s3Environment.s3BucketName,
      Key: path,
      Body: buffer,
      ContentType: mimetype ?? file.mimetype,
    });

    await this.client.send(command);

    return {
      url: this.createUrl(path),
      name: file.filename,
      extension,
      size: buffer.byteLength,
      width,
      height,
      mimetype,
    };
  }

  public async uploadDocument(
    file: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > MAX_DOCUMENT_UPLOAD_BYTES) {
      throw new Error('DOCUMENT_SIZE_LIMIT_EXCEEDED');
    }

    const initialExtension = this.getFileExtension(file.filename);
    const fallbackExtension = this.extFromMime(file.mimetype ?? '') ?? 'bin';
    const extension = initialExtension || fallbackExtension;

    const normalizedName = initialExtension
      ? file.filename
      : `${file.filename}.${extension}`;
    const key = `${accountId}/${this.converterFilename(normalizedName)}`;
    const mimetype = file.mimetype ?? 'application/octet-stream';

    await this.client.send(
      new PutObjectCommand({
        Bucket: s3Environment.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      })
    );

    return {
      url: this.createUrl(key),
      name: normalizedName,
      extension,
      size: buffer.byteLength,
      mimetype,
      width: null,
      height: null,
    };
  }

  public async uploadVideo(
    file: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > MAX_VIDEO_UPLOAD_BYTES) {
      throw new Error('VIDEO_SIZE_LIMIT_EXCEEDED');
    }

    const initialExtension = this.getFileExtension(file.filename);
    const fallbackExtension = this.extFromMime(file.mimetype ?? '') ?? 'mp4';
    const extension = initialExtension || fallbackExtension;

    const normalizedName = initialExtension
      ? file.filename
      : `${file.filename}.${extension}`;
    const key = `${accountId}/${this.converterFilename(normalizedName)}`;
    const mimetype = file.mimetype ?? 'video/mp4';

    await this.client.send(
      new PutObjectCommand({
        Bucket: s3Environment.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      })
    );

    return {
      url: this.createUrl(key),
      name: normalizedName,
      extension,
      size: buffer.byteLength,
      mimetype,
      width: null,
      height: null,
    };
  }

  public async uploadAudio(
    file: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > MAX_AUDIO_UPLOAD_BYTES) {
      throw new Error('AUDIO_SIZE_LIMIT_EXCEEDED');
    }

    const initialExtension = this.getFileExtension(file.filename);
    const fallbackExtension = this.extFromMime(file.mimetype ?? '') ?? 'ogg';
    const extension = initialExtension || fallbackExtension;

    const normalizedName = initialExtension
      ? file.filename
      : `${file.filename}.${extension}`;
    const key = `${accountId}/${this.converterFilename(normalizedName)}`;
    const mimetype = file.mimetype ?? 'audio/ogg';

    await this.client.send(
      new PutObjectCommand({
        Bucket: s3Environment.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      })
    );

    return {
      url: this.createUrl(key),
      name: normalizedName,
      extension,
      size: buffer.byteLength,
      mimetype,
      width: null,
      height: null,
    };
  }

  public async uploadAudioFromBuffer(
    buffer: Buffer,
    filename: string,
    mimetype: string,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    if (buffer.byteLength > MAX_AUDIO_UPLOAD_BYTES) {
      throw new Error('AUDIO_SIZE_LIMIT_EXCEEDED');
    }

    const extension = this.getFileExtension(filename) || this.extFromMime(mimetype) || 'ogg';
    const normalizedName = filename.endsWith(`.${extension}`)
      ? filename
      : `${filename}.${extension}`;
    const key = `${accountId}/${this.converterFilename(normalizedName)}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: s3Environment.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      })
    );

    return {
      url: this.createUrl(key),
      name: normalizedName,
      extension,
      size: buffer.byteLength,
      mimetype,
      width: null,
      height: null,
    };
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
      let p = u.pathname;

      while (p.endsWith('/')) p = p.slice(0, -1);

      const last = p.slice(p.lastIndexOf('/') + 1);
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    })();

    const guessedName =
      filenameHint ?? dispoName ?? urlName ?? `file-${Date.now()}`;

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    let ext =
      this.getFileExtension(guessedName) ?? this.extFromMime(contentType);

    let sniffedMime: string | undefined;
    if (!ext) {
      const ft = await fileTypeFromBuffer(buffer).catch(() => null);
      if (ft?.ext) {
        ext = ft.ext;
        sniffedMime = ft.mime;
      }
    }

    const finalExt = ext ?? 'bin';
    const baseName = this.getFileExtension(guessedName)
      ? guessedName
      : `${guessedName}.${finalExt}`;
    const key = `${accountId}/${this.converterFilename(baseName)}`;
    const mimeToStore = sniffedMime ?? contentTypeHeader;

    let width: number | null = null;
    let height: number | null = null;
    let mimetype: string | null = mimeToStore;

    const isImage = mimeToStore.startsWith('image/');
    if (isImage) {
      try {
        const metadata = await sharp(buffer).metadata();
        width = metadata.width ?? null;
        height = metadata.height ?? null;
        if (!mimetype && metadata.format) {
          mimetype = `image/${metadata.format}`;
        }
      } catch {
        width = null;
        height = null;
      }
    }

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
      width,
      height,
      mimetype,
    };
  }

  public async uploadFromBuffer(
    buffer: Buffer<ArrayBufferLike>,
    accountId: string,
    options?: {
      fileName?: string;
      mimetype?: string;
    }
  ): Promise<UploadFileResponse | null> {
    const ft = await fileTypeFromBuffer(buffer).catch(() => null);
    const providedName = options?.fileName;
    const providedExt = providedName ? this.getFileExtension(providedName) : '';
    const detectedExt = ft?.ext;
    const ext = providedExt || detectedExt || 'bin';
    const detectedMime = ft?.mime ?? 'application/octet-stream';
    const mime = options?.mimetype ?? detectedMime;

    const baseName = providedName
      ? providedExt
        ? providedName
        : `${providedName}.${ext}`
      : `${accountId}-${Date.now()}.${ext}`;
    const key = `${accountId}/${this.converterFilename(baseName)}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: s3Environment.s3BucketName,
        Key: key,
        Body: buffer,
        ContentType: mime,
      })
    );

    return {
      url: this.createUrl(key),
      name: baseName,
      extension: ext,
      size: buffer.byteLength,
      mimetype: mime,
      width: null,
      height: null,
    };
  }

  private parseDispositionFilename(disposition?: string | null) {
    if (!disposition) return '';

    const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);

    const quotedMatch = /filename\s*=\s*"([^"]+)"/i.exec(disposition);
    const simpleMatch = /filename\s*=\s*([^;]+)/i.exec(disposition);
    const simple = quotedMatch?.[1] ?? simpleMatch?.[1];

    return simple?.trim() ?? '';
  }

  private getFileExtension(name: string) {
    const m = /\.([^./\\]+)$/.exec(name);

    return m ? m[1].toLowerCase() : '';
  }

  private extFromMime(m: string): string | null {
    const clean = (m ?? '').toLowerCase().split(';')[0].trim();

    return (mimeToExt(clean) as string) ?? null;
  }

  public createUrl = (path: string) =>
    `${s3Environment.s3Endpoint}/${s3Environment.s3BucketName}/${path}`;
}
