jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7-mock'),
}));

jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(async () => null),
  }),
  { virtual: true }
);

jest.mock('sharp', () => jest.fn());

import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { FileProcessor } from '@core/services/storage/FileProcessor';

describe('FileProcessor', () => {
  const service = new FileProcessor();

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes filename and extracts extension', () => {
    expect(service.normalizeFilename('my file name.txt')).toBe(
      'my_file_name.txt'
    );
    expect(service.getFileExtension('image.JPEG')).toBe('jpeg');
    expect(service.getFileExtension('without-extension')).toBe('');
  });

  it('maps extension from mime including custom formats', () => {
    expect(service.extFromMime('application/was')).toBe('was');
    expect(service.extFromMime('application/x-tgsticker')).toBe('tgs');
    expect(service.extFromMime('image/png; charset=utf-8')).toBe('png');
    expect(service.extFromMime('application/unknown-type')).toBeFalsy();
    expect(service.extFromMime(undefined as never)).toBeFalsy();
  });

  it('determines base names and normalizes extension', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1711111111111);

    try {
      expect(service.determineBaseName(null, null, 'png', 'acc-1')).toBe(
        'acc-1-1711111111111.png'
      );
      expect(service.determineBaseName('invoice', 'pdf', 'png', 'acc-1')).toBe(
        'invoice'
      );
      expect(service.determineBaseName('invoice', null, 'pdf', 'acc-1')).toBe(
        'invoice.pdf'
      );

      expect(service.normalizeFileNameWithExtension('file', 'jpg')).toBe(
        'file.jpg'
      );
      expect(service.normalizeFileNameWithExtension('file.jpg', 'jpg')).toBe(
        'file.jpg'
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('extracts image metadata and falls back when sharp fails', async () => {
    const metadataMock = jest
      .fn<Promise<{ width?: number; height?: number; format?: string }>, []>()
      .mockResolvedValueOnce({ width: 1280, height: 720, format: 'png' })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('invalid-image'));

    (sharp as unknown as jest.Mock).mockImplementation(() => ({
      metadata: metadataMock,
    }));

    await expect(
      service.extractImageMetadata(Buffer.from('ok'))
    ).resolves.toEqual({
      width: 1280,
      height: 720,
      mimetype: 'image/png',
    });

    await expect(
      service.extractImageMetadata(Buffer.from('bad'))
    ).resolves.toEqual({
      width: null,
      height: null,
      mimetype: null,
    });

    await expect(
      service.extractImageMetadata(Buffer.from('missing-fields'))
    ).resolves.toEqual({
      width: null,
      height: null,
      mimetype: null,
    });
  });

  it('detects file type and handles detector errors', async () => {
    const detector = fileTypeFromBuffer as unknown as jest.Mock;

    detector
      .mockResolvedValueOnce({ ext: 'pdf', mime: 'application/pdf' })
      .mockRejectedValueOnce(new Error('cannot-detect'));

    await expect(service.detectFileType(Buffer.from('a'))).resolves.toEqual({
      ext: 'pdf',
      mime: 'application/pdf',
    });
    await expect(service.detectFileType(Buffer.from('b'))).resolves.toEqual({
      ext: undefined,
      mime: undefined,
    });
  });

  it('generates unique filename and parses disposition/url names', () => {
    expect(service.generateUniqueFilename('mp3')).toBe('uuid-v7-mock.mp3');
    expect(service.generateUniqueObjectKey('my file.pdf')).toBe(
      'uuid-v7-mock-my_file.pdf'
    );
    expect(service.generateUniqueObjectKey('my file.pdf', 'docs/')).toBe(
      'docs/uuid-v7-mock-my_file.pdf'
    );

    expect(
      service.parseDispositionFilename(
        "attachment; filename*=UTF-8''%E2%82%AC-rate.pdf"
      )
    ).toBe('€-rate.pdf');
    expect(
      service.parseDispositionFilename(
        'attachment; filename="report final.csv"'
      )
    ).toBe('report final.csv');
    expect(
      service.parseDispositionFilename('attachment; filename=plain.txt')
    ).toBe('plain.txt');
    expect(service.parseDispositionFilename('inline')).toBe('');
    expect(service.parseDispositionFilename(null)).toBe('');

    expect(
      service.extractFilenameFromUrl('https://x.com/path/My%20File.txt///')
    ).toBe('My File.txt');
    expect(service.extractFilenameFromUrl('https://x.com/path/%E0%A4%A')).toBe(
      '%E0%A4%A'
    );
  });
});
