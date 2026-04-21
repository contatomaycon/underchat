import 'reflect-metadata';

const writeFileMock = jest.fn();
const safeUnlinkMock = jest.fn(async () => undefined);

jest.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));
jest.mock('@core/services/converter/audio/fileUtils.service', () => ({
  FileUtils: { safeUnlink: () => safeUnlinkMock() },
}));

import { AudioFormatValidator } from '@core/services/converter/audio/audioFormatValidator.service';

describe('AudioFormatValidator', () => {
  beforeEach(() => {
    writeFileMock.mockReset();
    safeUnlinkMock.mockClear();
    writeFileMock.mockResolvedValue(undefined);
  });

  it('returns conversion result for valid opus metadata', async () => {
    const probeMetadata = jest.fn(async () => ({
      streams: [{ codec_name: 'opus' }],
      format: { duration: '9.5' },
    }));
    const extractDuration = jest.fn(() => 10);

    const service = new AudioFormatValidator({
      probeMetadata,
      extractDuration,
    } as never);

    await expect(
      service.checkAndReturnIfValid(Buffer.from('a'), 'audio/ogg', 'opus')
    ).resolves.toEqual({
      buffer: Buffer.from('a'),
      mimetype: 'audio/ogg',
      extension: 'opus',
      duration: 10,
    });
    expect(writeFileMock).toHaveBeenCalled();
    expect(safeUnlinkMock).toHaveBeenCalled();
  });

  it('returns null for invalid codec and for failures', async () => {
    const service = new AudioFormatValidator({
      probeMetadata: jest.fn(async () => ({
        streams: [{ codec_name: 'aac' }],
      })),
      extractDuration: jest.fn(() => undefined),
    } as never);

    await expect(
      service.checkAndReturnIfValid(Buffer.from('a'), 'audio/mpeg', 'mp3')
    ).resolves.toBeNull();

    writeFileMock.mockRejectedValueOnce(new Error('io fail'));
    await expect(
      service.checkAndReturnIfValid(Buffer.from('a'), 'audio/mpeg', 'mp3')
    ).resolves.toBeNull();
  });
});
