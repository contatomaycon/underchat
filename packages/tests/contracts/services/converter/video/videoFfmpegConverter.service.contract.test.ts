import 'reflect-metadata';

const writeFileMock = jest.fn();
const readFileMock = jest.fn();
const safeUnlinkMock = jest.fn(async () => undefined);

const ffmpegState = { shouldError: false };

jest.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

jest.mock('@core/services/converter/audio/fileUtils.service', () => ({
  FileUtils: { safeUnlink: () => safeUnlinkMock() },
}));

jest.mock('fluent-ffmpeg', () => {
  return jest.fn((_inputPath: string) => {
    const handlers: Record<string, ((arg?: unknown) => void) | undefined> = {};
    let chain: any;
    chain = {
      videoCodec: jest.fn(() => chain),
      audioCodec: jest.fn(() => chain),
      format: jest.fn(() => chain),
      outputOptions: jest.fn(() => chain),
      output: jest.fn(() => chain),
      on: jest.fn((event: string, handler: (arg?: unknown) => void) => {
        handlers[event] = handler;
        return chain;
      }),
      run: jest.fn(() => {
        if (ffmpegState.shouldError) {
          handlers.error?.(new Error('ffmpeg failed'));
          return;
        }
        handlers.end?.();
      }),
    };

    return chain;
  });
});

import { VideoFfmpegConverter } from '@core/services/converter/video/videoFfmpegConverter.service';

describe('VideoFfmpegConverter', () => {
  beforeEach(() => {
    ffmpegState.shouldError = false;
    writeFileMock.mockReset();
    readFileMock.mockReset();
    safeUnlinkMock.mockClear();
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(Buffer.from('out-video'));
  });

  it('converts video and enriches response with probe metadata', async () => {
    const service = new VideoFfmpegConverter({
      probeMetadata: jest.fn(async () => ({ format: { duration: '7' } })),
      extractDuration: jest.fn(() => 7),
      extractDimensions: jest.fn(() => ({ width: 1280, height: 720 })),
    } as never);

    await expect(
      service.convert(Buffer.from('video'), 'webm')
    ).resolves.toEqual({
      buffer: Buffer.from('out-video'),
      mimetype: 'video/mp4',
      extension: 'mp4',
      duration: 7,
      width: 1280,
      height: 720,
    });
    expect(writeFileMock).toHaveBeenCalled();
    expect(readFileMock).toHaveBeenCalled();
    expect(safeUnlinkMock).toHaveBeenCalledTimes(2);
  });

  it('always cleans temp files when conversion fails', async () => {
    ffmpegState.shouldError = true;

    const service = new VideoFfmpegConverter({
      probeMetadata: jest.fn(),
      extractDuration: jest.fn(),
      extractDimensions: jest.fn(),
    } as never);

    await expect(service.convert(Buffer.from('video'), 'mp4')).rejects.toThrow(
      'ffmpeg failed'
    );
    expect(safeUnlinkMock).toHaveBeenCalledTimes(2);
  });
});
