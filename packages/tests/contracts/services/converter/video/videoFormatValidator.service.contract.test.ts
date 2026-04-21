import 'reflect-metadata';

const writeFileMock = jest.fn();
const safeUnlinkMock = jest.fn(async () => undefined);

jest.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));
jest.mock('@core/services/converter/audio/fileUtils.service', () => ({
  FileUtils: { safeUnlink: () => safeUnlinkMock() },
}));

import { VideoFormatValidator } from '@core/services/converter/video/videoFormatValidator.service';

describe('VideoFormatValidator', () => {
  beforeEach(() => {
    writeFileMock.mockReset();
    safeUnlinkMock.mockClear();
    writeFileMock.mockResolvedValue(undefined);
  });

  it('returns conversion result for valid h264/mp4 metadata', async () => {
    const probeMetadata = jest.fn(async () => ({
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    }));

    const service = new VideoFormatValidator({
      probeMetadata,
      extractDuration: jest.fn(() => 8),
      extractDimensions: jest.fn(() => ({ width: 1920, height: 1080 })),
    } as never);

    await expect(
      service.checkAndReturnIfValid(Buffer.from('v'))
    ).resolves.toEqual({
      buffer: Buffer.from('v'),
      mimetype: 'video/mp4',
      extension: 'mp4',
      duration: 8,
      width: 1920,
      height: 1080,
    });
    expect(writeFileMock).toHaveBeenCalled();
    expect(safeUnlinkMock).toHaveBeenCalled();
  });

  it('returns null for invalid format and for failures', async () => {
    const service = new VideoFormatValidator({
      probeMetadata: jest.fn(async () => ({
        streams: [{ codec_type: 'video', codec_name: 'vp9' }],
        format: { format_name: 'webm' },
      })),
      extractDuration: jest.fn(() => undefined),
      extractDimensions: jest.fn(() => ({})),
    } as never);

    await expect(
      service.checkAndReturnIfValid(Buffer.from('x'))
    ).resolves.toBeNull();

    writeFileMock.mockRejectedValueOnce(new Error('io fail'));
    await expect(
      service.checkAndReturnIfValid(Buffer.from('x'))
    ).resolves.toBeNull();
  });
});
