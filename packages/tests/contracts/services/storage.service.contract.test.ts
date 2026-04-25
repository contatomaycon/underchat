jest.mock('@core/config/environments', () => ({
  s3Environment: {
    s3Endpoint: 'https://primary-s3.example.com/',
    s3EndpointBackup: 'https://backup-s3.example.com/',
  },
}));
jest.mock('uuid', () => ({ v7: jest.fn(() => 'uuid-mock') }));
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(async () => null),
  }),
  { virtual: true }
);
jest.mock('sharp', () => jest.fn());
jest.mock('@core/services/s3BackupUpload.service', () => ({
  S3BackupUploadService: class {},
}));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

import 'reflect-metadata';
import { StorageService } from '@core/services/storage.service';

describe('StorageService', () => {
  const makeFile = (
    filename: string,
    mimetype: string | undefined,
    body: Buffer
  ) => ({
    filename,
    mimetype,
    toBuffer: jest.fn(async () => body),
  });

  const makeService = () => {
    const bucketManager = {
      validateAndGetBucketId: jest.fn((id: string) => id.trim()),
      isBucketVerified: jest.fn(() => false),
      isBucketReady: jest.fn(async () => false),
      ensurePublicBucket: jest.fn(async (id: string) => id.trim()),
    };

    const uploader = {
      uploadWithRetry: jest.fn<Promise<any>, [any]>(async () => ({
        usedBackup: false,
        primaryAttempts: 1,
        backupAttempts: 0,
        primaryError: null,
        backupError: null,
      })),
    };

    const deleter = {
      deleteObject: jest.fn(async () => true),
    };

    const service = new StorageService(
      bucketManager as never,
      uploader as never,
      deleter as never
    );

    const fileValidator = {
      validateImageFormat: jest.fn(),
      validateImageSize: jest.fn(),
      validateDocumentSize: jest.fn(),
      validateVideoFormat: jest.fn(),
      validateVideoSize: jest.fn(),
      validateAudioSize: jest.fn(),
    };

    const fileProcessor = {
      getFileExtension: jest.fn((name: string) => {
        const match = /\.([^./\\]+)$/.exec(name);
        return match ? match[1].toLowerCase() : '';
      }),
      extFromMime: jest.fn((_: string) => null as string | null),
      generateUniqueFilename: jest.fn(() => 'generated.jpg'),
      normalizeFilename: jest.fn((name: string) => name.replaceAll(' ', '_')),
      normalizeFileNameWithExtension: jest.fn((name: string, ext: string) =>
        name.endsWith(`.${ext}`) ? name : `${name}.${ext}`
      ),
      determineBaseName: jest.fn(
        (
          providedName: string | null | undefined,
          providedExt: string | null | undefined,
          ext: string,
          accountId: string
        ) => {
          if (!providedName) {
            return `${accountId}.${ext}`;
          }
          if (providedExt) {
            return providedName;
          }
          return `${providedName}.${ext}`;
        }
      ),
      extractImageMetadata: jest.fn(
        async (): Promise<{
          width: number | null;
          height: number | null;
          mimetype: string | null;
        }> => ({
          width: 640,
          height: 480,
          mimetype: 'image/png',
        })
      ),
      parseDispositionFilename: jest.fn(() => ''),
      extractFilenameFromUrl: jest.fn(() => 'from-url.bin'),
      detectFileType: jest.fn(
        async (): Promise<{
          ext: string | undefined;
          mime: string | undefined;
        }> => ({
          ext: undefined,
          mime: undefined,
        })
      ),
    };

    const urlParser = {
      parse: jest.fn((): { accountId: string; key: string } | null => ({
        accountId: 'acc-1',
        key: 'folder/file.jpg',
      })),
    };

    (service as any).fileValidator = fileValidator;
    (service as any).fileProcessor = fileProcessor;
    (service as any).urlParser = urlParser;

    return {
      service,
      bucketManager,
      uploader,
      deleter,
      fileValidator,
      fileProcessor,
      urlParser,
    };
  };

  const originalFetch = global.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('returns null on image upload when extension is missing', async () => {
    const { service, fileProcessor, uploader } = makeService();
    fileProcessor.getFileExtension.mockReturnValueOnce('');

    const result = await service.uploadImage(
      makeFile('no-extension', 'image/jpeg', Buffer.from('img')) as never,
      'acc-1'
    );

    expect(result).toBeNull();
    expect(uploader.uploadWithRetry).not.toHaveBeenCalled();
  });

  it('uploads image with metadata and backup url when backup is used', async () => {
    const { service, fileProcessor, fileValidator, uploader } = makeService();

    fileProcessor.getFileExtension.mockReturnValueOnce('jpg');
    fileProcessor.generateUniqueFilename.mockReturnValueOnce('my image.jpg');
    fileProcessor.extractImageMetadata.mockResolvedValueOnce({
      width: 1024,
      height: 768,
      mimetype: 'image/webp',
    });
    uploader.uploadWithRetry.mockResolvedValueOnce({
      usedBackup: true,
      primaryAttempts: 3,
      backupAttempts: 1,
      primaryError: 'x',
      backupError: null,
    });

    const result = await service.uploadImage(
      makeFile(
        'photo.jpg',
        'image/jpeg',
        Buffer.from('image-content')
      ) as never,
      'acc-2'
    );

    expect(fileValidator.validateImageFormat).toHaveBeenCalledWith(
      'jpg',
      'image/jpeg'
    );
    expect(fileValidator.validateImageSize).toHaveBeenCalled();
    expect(uploader.uploadWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'acc-2',
        key: 'my_image.jpg',
        contentType: 'image/webp',
      })
    );

    expect(result).toEqual({
      url: 'https://backup-s3.example.com/acc-2/my_image.jpg',
      name: 'my image.jpg',
      extension: 'jpg',
      size: Buffer.from('image-content').byteLength,
      width: 1024,
      height: 768,
      mimetype: 'image/webp',
    });
  });

  it('uploads image with default jpeg contentType when no mimetype is available', async () => {
    const { service, fileProcessor, uploader } = makeService();

    fileProcessor.getFileExtension.mockReturnValueOnce('png');
    fileProcessor.extractImageMetadata.mockResolvedValueOnce({
      width: null,
      height: null,
      mimetype: null,
    });

    const result = await service.uploadImage(
      makeFile('photo.png', undefined, Buffer.from('img-default')) as never,
      'acc-2'
    );

    expect(uploader.uploadWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/jpeg',
      })
    );
    expect(result?.mimetype).toBeNull();
  });

  it('uploads document with fallback extension and default mimetype', async () => {
    const { service, fileProcessor, fileValidator, uploader } = makeService();

    fileProcessor.getFileExtension.mockReturnValueOnce('');
    fileProcessor.extFromMime.mockReturnValueOnce('pdf');

    const result = await service.uploadDocument(
      makeFile('invoice', undefined, Buffer.from('doc')) as never,
      'acc-3'
    );

    expect(fileValidator.validateDocumentSize).toHaveBeenCalledWith(
      Buffer.from('doc').byteLength
    );
    expect(uploader.uploadWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'invoice.pdf',
        contentType: 'application/octet-stream',
      })
    );
    expect(result?.extension).toBe('pdf');
    expect(result?.name).toBe('invoice.pdf');
  });

  it('keeps original document/video/audio names when extension already exists', async () => {
    const { service, fileProcessor } = makeService();

    fileProcessor.getFileExtension
      .mockReturnValueOnce('pdf')
      .mockReturnValueOnce('mp4')
      .mockReturnValueOnce('ogg');

    const document = await service.uploadDocument(
      makeFile(
        'contract.pdf',
        'application/pdf',
        Buffer.from('doc-ext')
      ) as never,
      'acc-3'
    );
    const video = await service.uploadVideo(
      makeFile('movie.mp4', 'video/mp4', Buffer.from('video-ext')) as never,
      'acc-3'
    );
    const audio = await service.uploadAudio(
      makeFile('voice.ogg', 'audio/ogg', Buffer.from('audio-ext')) as never,
      'acc-3'
    );

    expect(document?.name).toBe('contract.pdf');
    expect(video?.name).toBe('movie.mp4');
    expect(audio?.name).toBe('voice.ogg');
  });

  it('uploads video and audio using fallback extensions and default mimetypes', async () => {
    const { service, fileProcessor, fileValidator, uploader } = makeService();

    fileProcessor.getFileExtension.mockReturnValue('');
    fileProcessor.extFromMime
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    const video = await service.uploadVideo(
      makeFile('video', undefined, Buffer.from('video-content')) as never,
      'acc-4'
    );
    const audio = await service.uploadAudio(
      makeFile('audio', undefined, Buffer.from('audio-content')) as never,
      'acc-4'
    );

    expect(fileValidator.validateVideoFormat).toHaveBeenCalledWith(
      'mp4',
      undefined
    );
    expect(fileValidator.validateVideoSize).toHaveBeenCalled();
    expect(fileValidator.validateAudioSize).toHaveBeenCalled();

    expect(video?.extension).toBe('mp4');
    expect(video?.mimetype).toBe('video/mp4');
    expect(audio?.extension).toBe('opus');
    expect(audio?.mimetype).toBe('audio/ogg; codecs=opus');

    expect(uploader.uploadWithRetry).toHaveBeenCalled();
  });

  it('uploads video/audio from buffer with normalized names and dimensions', async () => {
    const { service, fileProcessor } = makeService();

    fileProcessor.getFileExtension
      .mockReturnValueOnce('')
      .mockReturnValueOnce('mp3');
    fileProcessor.extFromMime.mockReturnValueOnce('mp4');

    const videoResult = await service.uploadVideoFromBuffer(
      Buffer.from('v'),
      'recording',
      'video/mp4',
      'acc-5',
      1920,
      1080
    );

    const audioResult = await service.uploadAudioFromBuffer(
      Buffer.from('a'),
      'voice.mp3',
      'audio/mpeg',
      'acc-5'
    );

    expect(fileProcessor.normalizeFileNameWithExtension).toHaveBeenCalledWith(
      'recording',
      'mp4'
    );
    expect(videoResult?.width).toBe(1920);
    expect(videoResult?.height).toBe(1080);
    expect(audioResult?.extension).toBe('mp3');
    expect(audioResult?.width).toBeNull();
    expect(audioResult?.height).toBeNull();
  });

  it('uses buffer fallback extensions for video/audio when none is available', async () => {
    const { service, fileProcessor } = makeService();

    fileProcessor.getFileExtension.mockReturnValue('');
    fileProcessor.extFromMime
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('ogg');

    const videoResult = await service.uploadVideoFromBuffer(
      Buffer.from('vv'),
      'camera',
      'video/unknown',
      'acc-5'
    );
    const audioResult = await service.uploadAudioFromBuffer(
      Buffer.from('aa'),
      'sound',
      'audio/ogg',
      'acc-5'
    );

    expect(videoResult?.extension).toBe('mp4');
    expect(videoResult?.width).toBeNull();
    expect(videoResult?.height).toBeNull();
    expect(audioResult?.extension).toBe('ogg');
  });

  it('handles uploadFromUrl failure when fetch is not ok', async () => {
    const { service } = makeService();

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: jest.fn(() => null) },
    })) as never;

    await expect(
      service.uploadFromUrl('https://example.com/file', 'acc-6')
    ).rejects.toThrow('Failed to fetch: 404 Not Found');
  });

  it('uploads from url using sniffed type, path prefix and image metadata', async () => {
    const { service, fileProcessor, uploader } = makeService();

    fileProcessor.parseDispositionFilename.mockReturnValueOnce(
      undefined as never
    );
    fileProcessor.extractFilenameFromUrl.mockReturnValueOnce('download');
    fileProcessor.getFileExtension.mockReturnValue('');
    fileProcessor.extFromMime.mockReturnValueOnce(null);
    fileProcessor.detectFileType.mockResolvedValueOnce({
      ext: 'png',
      mime: 'image/png',
    });
    fileProcessor.extractImageMetadata.mockResolvedValueOnce({
      width: 300,
      height: 200,
      mimetype: 'image/png',
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (key: string) => {
          if (key === 'content-type') return 'application/octet-stream';
          if (key === 'content-disposition') return null;
          return null;
        },
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as never;

    const result = await service.uploadFromUrl(
      'https://example.com/path/file',
      'acc-7',
      undefined,
      'prefix'
    );

    expect(uploader.uploadWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'prefix/download.png',
        contentType: 'image/png',
      })
    );
    expect(result).toEqual({
      url: 'https://primary-s3.example.com/acc-7/prefix/download.png',
      name: 'download.png',
      extension: 'png',
      size: 3,
      width: 300,
      height: 200,
      mimetype: 'image/png',
    });
  });

  it('uploads from url without image metadata when type is not image', async () => {
    const { service, fileProcessor } = makeService();

    fileProcessor.parseDispositionFilename.mockReturnValueOnce('report.pdf');
    fileProcessor.getFileExtension.mockReturnValue('pdf');
    fileProcessor.extFromMime.mockReturnValueOnce('pdf');

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (key: string) => {
          if (key === 'content-type') return 'application/pdf';
          if (key === 'content-disposition') {
            return 'attachment; filename="report.pdf"';
          }
          return null;
        },
      },
      arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
    })) as never;

    const result = await service.uploadFromUrl(
      'https://example.com/path/report.pdf',
      'acc-8'
    );

    expect(fileProcessor.extractImageMetadata).not.toHaveBeenCalled();
    expect(result?.width).toBeNull();
    expect(result?.height).toBeNull();
    expect(result?.mimetype).toBe('application/pdf');
  });

  it('uploads from url using content-type default and filename/date fallbacks', async () => {
    const { service, fileProcessor, uploader } = makeService();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111111111);

    try {
      fileProcessor.parseDispositionFilename.mockReturnValueOnce(
        undefined as never
      );
      fileProcessor.extractFilenameFromUrl.mockReturnValueOnce(
        undefined as never
      );
      fileProcessor.getFileExtension
        .mockReturnValueOnce(undefined as never)
        .mockReturnValueOnce(undefined as never);
      fileProcessor.extFromMime.mockReturnValueOnce(undefined as never);
      fileProcessor.detectFileType.mockResolvedValueOnce({
        ext: undefined,
        mime: undefined,
      });

      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: () => null,
        },
        arrayBuffer: async () => new Uint8Array([7, 7, 7]).buffer,
      })) as never;

      const result = await service.uploadFromUrl(
        'https://example.com/unknown',
        'acc-8',
        undefined,
        undefined
      );

      expect(result?.name).toBe('file-1711111111111.bin');
      expect(result?.extension).toBe('bin');
      expect(result?.mimetype).toBe('application/octet-stream');
      expect(uploader.uploadWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'application/octet-stream',
        })
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('uploads from generic buffer with provided options and defaults', async () => {
    const { service, fileProcessor } = makeService();

    fileProcessor.detectFileType
      .mockResolvedValueOnce({ ext: 'txt', mime: 'text/plain' })
      .mockResolvedValueOnce({ ext: undefined, mime: undefined });
    fileProcessor.getFileExtension
      .mockReturnValueOnce('txt')
      .mockReturnValueOnce('');
    fileProcessor.determineBaseName
      .mockReturnValueOnce('notes.txt')
      .mockReturnValueOnce('acc-9.bin');

    const withOptions = await service.uploadFromBuffer(
      Buffer.from('text'),
      'acc-9',
      {
        fileName: 'notes.txt',
        mimetype: 'text/custom',
      }
    );

    const withoutOptions = await service.uploadFromBuffer(
      Buffer.from([0x00]),
      'acc-9'
    );

    expect(withOptions?.name).toBe('notes.txt');
    expect(withOptions?.mimetype).toBe('text/custom');
    expect(withoutOptions?.name).toBe('acc-9.bin');
    expect(withoutOptions?.extension).toBe('bin');
    expect(withoutOptions?.mimetype).toBe('application/octet-stream');
  });

  it('uploads pdf with normalized path and verified bucket shortcut', async () => {
    const { service, bucketManager, uploader } = makeService();

    bucketManager.isBucketReady.mockResolvedValueOnce(true);
    uploader.uploadWithRetry.mockResolvedValueOnce({
      usedBackup: false,
      primaryAttempts: 1,
      backupAttempts: 0,
      primaryError: null,
      backupError: null,
    });

    const url = await service.uploadPdf(
      new Uint8Array([1, 2, 3]),
      'acc-10',
      '/docs/file.pdf'
    );

    expect(bucketManager.ensurePublicBucket).not.toHaveBeenCalled();
    expect(url).toBe('https://primary-s3.example.com/acc-10/docs/file.pdf');
  });

  it('uploads pdf from Buffer and supports backup url base', async () => {
    const { service, uploader } = makeService();

    uploader.uploadWithRetry.mockResolvedValueOnce({
      usedBackup: true,
      primaryAttempts: 3,
      backupAttempts: 1,
      primaryError: 'x',
      backupError: null,
    });

    const url = await service.uploadPdf(
      Buffer.from('pdf-buffer'),
      'acc-11',
      'reports/r1.pdf'
    );

    expect(url).toBe('https://backup-s3.example.com/acc-11/reports/r1.pdf');
  });

  it('deletes image and handles parser/no-such-bucket/error branches', async () => {
    const { service, urlParser, bucketManager, deleter } = makeService();

    urlParser.parse.mockReturnValueOnce(null);
    await expect(service.deleteImage('invalid')).resolves.toBe(false);

    urlParser.parse.mockReturnValueOnce({ accountId: 'acc-1', key: 'k1' });
    deleter.deleteObject.mockResolvedValueOnce(true);
    await expect(service.deleteImage('valid')).resolves.toBe(true);

    urlParser.parse.mockReturnValueOnce({ accountId: 'acc-1', key: 'k2' });
    deleter.deleteObject.mockRejectedValueOnce({ name: 'NoSuchBucket' });
    await expect(service.deleteImage('missing-bucket')).resolves.toBe(false);

    urlParser.parse.mockReturnValueOnce({ accountId: 'acc-1', key: 'k3' });
    const err = new Error('delete-fail');
    bucketManager.validateAndGetBucketId.mockImplementationOnce(() => {
      throw err;
    });

    await expect(service.deleteImage('boom')).rejects.toBe(err);
  });

  it('returns false for deleteImage when error has Code or httpStatusCode 404', async () => {
    const { service, urlParser, deleter } = makeService();

    urlParser.parse.mockReturnValue({ accountId: 'acc-1', key: 'code-404' });
    deleter.deleteObject.mockRejectedValueOnce({ Code: 'NoSuchBucket' });
    await expect(service.deleteImage('code')).resolves.toBe(false);

    urlParser.parse.mockReturnValue({ accountId: 'acc-1', key: 'status-404' });
    deleter.deleteObject.mockRejectedValueOnce({
      $metadata: { httpStatusCode: 404 },
    });
    await expect(service.deleteImage('status')).resolves.toBe(false);
  });
});
