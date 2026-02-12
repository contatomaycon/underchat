import { injectable, inject } from 'tsyringe';
import { s3Environment } from '@core/config/environments';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { BucketManager } from './storage/BucketManager';
import { FileValidator } from './storage/FileValidator';
import { FileProcessor } from './storage/FileProcessor';
import { S3Uploader } from './storage/S3Uploader';
import { S3Deleter } from './storage/S3Deleter';
import { S3UrlParser } from './storage/S3UrlParser';

@injectable()
export class StorageService {
  private readonly fileValidator: FileValidator;
  private readonly fileProcessor: FileProcessor;
  private readonly urlParser: S3UrlParser;

  constructor(
    @inject(BucketManager)
    private readonly bucketManager: BucketManager,
    @inject(S3Uploader)
    private readonly uploader: S3Uploader,
    @inject(S3Deleter)
    private readonly deleter: S3Deleter
  ) {
    this.fileValidator = new FileValidator();
    this.fileProcessor = new FileProcessor();
    this.urlParser = new S3UrlParser();
  }

  private async ensureBucket(accountId: string): Promise<string> {
    const bucketId = this.bucketManager.validateAndGetBucketId(accountId);

    if (this.bucketManager.isBucketVerified(bucketId)) {
      return bucketId;
    }

    return this.bucketManager.ensurePublicBucket(accountId);
  }

  private createUrl(
    path: string,
    accountId: string,
    useBackup: boolean = false
  ): string {
    const baseUrl = useBackup
      ? s3Environment.s3EndpointBackup
      : s3Environment.s3Endpoint;
    return `${baseUrl}/${accountId}/${path}`;
  }

  public async uploadImage(
    file: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    const extension = this.fileProcessor.getFileExtension(file.filename);

    if (!extension) {
      return null;
    }

    this.fileValidator.validateImageFormat(extension, file.mimetype);

    const buffer = await file.toBuffer();
    this.fileValidator.validateImageSize(buffer.byteLength);

    const generatedFilename =
      this.fileProcessor.generateUniqueFilename(extension);
    const path = this.fileProcessor.normalizeFilename(generatedFilename);

    let width: number | null = null;
    let height: number | null = null;
    let mimetype: string | null = file.mimetype ?? null;

    const metadata = await this.fileProcessor.extractImageMetadata(buffer);
    width = metadata.width;
    height = metadata.height;
    if (metadata.mimetype) {
      mimetype = metadata.mimetype;
    }

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key: path,
      body: buffer,
      contentType: mimetype ?? 'image/jpeg',
    });

    return {
      url: this.createUrl(path, bucketId, usedBackup),
      name: generatedFilename,
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
    this.fileValidator.validateDocumentSize(buffer.byteLength);

    const initialExtension = this.fileProcessor.getFileExtension(file.filename);
    const fallbackExtension =
      this.fileProcessor.extFromMime(file.mimetype ?? '') ?? 'bin';
    const extension = initialExtension || fallbackExtension;

    const normalizedName = initialExtension
      ? file.filename
      : `${file.filename}.${extension}`;
    const key = this.fileProcessor.normalizeFilename(normalizedName);
    const mimetype = file.mimetype ?? 'application/octet-stream';

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: buffer,
      contentType: mimetype,
    });

    return {
      url: this.createUrl(key, bucketId, usedBackup),
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
    const initialExtension = this.fileProcessor.getFileExtension(file.filename);
    const fallbackExtension =
      this.fileProcessor.extFromMime(file.mimetype ?? '') ?? 'mp4';
    const extension = initialExtension || fallbackExtension;

    this.fileValidator.validateVideoFormat(extension, file.mimetype);

    const buffer = await file.toBuffer();
    this.fileValidator.validateVideoSize(buffer.byteLength);

    const normalizedName = initialExtension
      ? file.filename
      : `${file.filename}.${extension}`;
    const key = this.fileProcessor.normalizeFilename(normalizedName);
    const mimetype = file.mimetype ?? 'video/mp4';

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: buffer,
      contentType: mimetype,
    });

    return {
      url: this.createUrl(key, bucketId, usedBackup),
      name: normalizedName,
      extension,
      size: buffer.byteLength,
      mimetype,
      width: null,
      height: null,
    };
  }

  public async uploadVideoFromBuffer(
    buffer: Buffer,
    filename: string,
    mimetype: string,
    accountId: string,
    width?: number,
    height?: number
  ): Promise<UploadFileResponse | null> {
    this.fileValidator.validateVideoSize(buffer.byteLength);

    const extension =
      this.fileProcessor.getFileExtension(filename) ||
      this.fileProcessor.extFromMime(mimetype) ||
      'mp4';
    const normalizedName = this.fileProcessor.normalizeFileNameWithExtension(
      filename,
      extension
    );
    const key = this.fileProcessor.normalizeFilename(normalizedName);

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: buffer,
      contentType: mimetype,
    });

    return {
      url: this.createUrl(key, bucketId, usedBackup),
      name: normalizedName,
      extension,
      size: buffer.byteLength,
      mimetype,
      width: width ?? null,
      height: height ?? null,
    };
  }

  public async uploadAudio(
    file: UploadFileRequest,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    const buffer = await file.toBuffer();
    this.fileValidator.validateAudioSize(buffer.byteLength);

    const initialExtension = this.fileProcessor.getFileExtension(file.filename);
    const fallbackExtension =
      this.fileProcessor.extFromMime(file.mimetype ?? '') ?? 'opus';
    const extension = initialExtension || fallbackExtension;

    const normalizedName = initialExtension
      ? file.filename
      : `${file.filename}.${extension}`;
    const key = this.fileProcessor.normalizeFilename(normalizedName);
    const mimetype = file.mimetype ?? 'audio/ogg; codecs=opus';

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: buffer,
      contentType: mimetype,
    });

    return {
      url: this.createUrl(key, bucketId, usedBackup),
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
    this.fileValidator.validateAudioSize(buffer.byteLength);

    const extension =
      this.fileProcessor.getFileExtension(filename) ||
      this.fileProcessor.extFromMime(mimetype) ||
      'opus';
    const normalizedName = this.fileProcessor.normalizeFileNameWithExtension(
      filename,
      extension
    );
    const key = this.fileProcessor.normalizeFilename(normalizedName);

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: buffer,
      contentType: mimetype,
    });

    return {
      url: this.createUrl(key, bucketId, usedBackup),
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
    if (!res.ok) {
      throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
    }

    const contentTypeHeader =
      res.headers.get('content-type') ?? 'application/octet-stream';
    const contentType = contentTypeHeader.split(';')[0].trim();

    const dispoName = this.fileProcessor.parseDispositionFilename(
      res.headers.get('content-disposition')
    );

    const urlName = this.fileProcessor.extractFilenameFromUrl(url);

    const guessedName =
      filenameHint ?? dispoName ?? urlName ?? `file-${Date.now()}`;

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    let ext =
      this.fileProcessor.getFileExtension(guessedName) ??
      this.fileProcessor.extFromMime(contentType);

    let sniffedMime: string | undefined;
    if (!ext) {
      const fileType = await this.fileProcessor.detectFileType(buffer);
      if (fileType.ext) {
        ext = fileType.ext;
        sniffedMime = fileType.mime;
      }
    }

    const finalExt = ext ?? 'bin';
    const baseName = this.fileProcessor.getFileExtension(guessedName)
      ? guessedName
      : `${guessedName}.${finalExt}`;
    const key = this.fileProcessor.normalizeFilename(baseName);
    const mimeToStore = sniffedMime ?? contentTypeHeader;

    let width: number | null = null;
    let height: number | null = null;
    let mimetype: string | null = mimeToStore;

    const isImage = mimeToStore.startsWith('image/');
    if (isImage) {
      const metadata = await this.fileProcessor.extractImageMetadata(buffer);
      width = metadata.width;
      height = metadata.height;
      if (metadata.mimetype) {
        mimetype = metadata.mimetype;
      }
    }

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: buffer,
      contentType: mimeToStore,
    });

    return {
      url: this.createUrl(key, bucketId, usedBackup),
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
    const fileType = await this.fileProcessor.detectFileType(buffer);
    const providedName = options?.fileName;
    const providedExt = providedName
      ? this.fileProcessor.getFileExtension(providedName)
      : '';
    const detectedExt = fileType.ext;
    const ext = providedExt || detectedExt || 'bin';
    const detectedMime = fileType.mime ?? 'application/octet-stream';
    const mime = options?.mimetype ?? detectedMime;

    const baseName = this.fileProcessor.determineBaseName(
      providedName,
      providedExt,
      ext,
      accountId
    );
    const key = this.fileProcessor.normalizeFilename(baseName);

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: buffer,
      contentType: mime,
    });

    return {
      url: this.createUrl(key, bucketId, usedBackup),
      name: baseName,
      extension: ext,
      size: buffer.byteLength,
      mimetype: mime,
      width: null,
      height: null,
    };
  }

  public async uploadPdf(
    buffer: Buffer | Uint8Array,
    accountId: string,
    key: string
  ): Promise<string> {
    const pdfBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    const bucketId = await this.ensureBucket(accountId);

    const { usedBackup } = await this.uploader.uploadWithRetry({
      bucket: bucketId,
      key,
      body: pdfBuffer,
      contentType: 'application/pdf',
    });

    return this.createUrl(key, bucketId, usedBackup);
  }

  public async deleteImage(url: string): Promise<boolean> {
    const parsed = this.urlParser.parse(url);

    if (!parsed) {
      return false;
    }

    const { accountId, key } = parsed;

    try {
      const bucketId = this.bucketManager.validateAndGetBucketId(accountId);
      const result = await this.deleter.deleteObject(bucketId, key);
      return result;
    } catch (error: any) {
      if (
        error.name === 'NoSuchBucket' ||
        error.Code === 'NoSuchBucket' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }
}
