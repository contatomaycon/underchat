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
      format: jest.fn(() => chain),
      audioCodec: jest.fn(() => chain),
      audioFrequency: jest.fn(() => chain),
      audioChannels: jest.fn(() => chain),
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

import { AudioWaveformGenerator } from '@core/services/converter/audio/audioWaveformGenerator.service';

describe('AudioWaveformGenerator', () => {
  beforeEach(() => {
    ffmpegState.shouldError = false;
    writeFileMock.mockReset();
    readFileMock.mockReset();
    safeUnlinkMock.mockClear();
    writeFileMock.mockResolvedValue(undefined);
  });

  it('generates base64 waveform from PCM data', async () => {
    const pcm = Buffer.alloc(64 * 2);
    for (let i = 0; i < 64; i++) {
      pcm.writeInt16LE(20000, i * 2);
    }
    readFileMock.mockResolvedValue(pcm);

    const service = new AudioWaveformGenerator();
    const base64 = await service.generate(Buffer.from('audio'));

    expect(base64).toBeDefined();
    const decoded = Buffer.from(base64 as string, 'base64');
    expect(decoded.length).toBe(64);
    expect(safeUnlinkMock).toHaveBeenCalledTimes(2);
  });

  it('returns undefined for zero waveform or conversion failure', async () => {
    readFileMock.mockResolvedValue(Buffer.alloc(64 * 2));
    const service = new AudioWaveformGenerator();

    await expect(
      service.generate(Buffer.from('audio'))
    ).resolves.toBeUndefined();

    ffmpegState.shouldError = true;
    await expect(
      service.generate(Buffer.from('audio'))
    ).resolves.toBeUndefined();
  });
});
