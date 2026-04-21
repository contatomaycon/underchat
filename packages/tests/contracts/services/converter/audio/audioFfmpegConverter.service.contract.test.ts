import 'reflect-metadata';

const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();
const mockRandomBytes = jest.fn();
const mockSafeUnlink = jest.fn(async () => undefined);

const ffmpegBehaviors: Array<{
  mode: 'success' | 'error';
  errorMessage?: string;
  errorObject?: unknown;
  stderrLines?: string[];
}> = [];

const ffmpegCommands: any[] = [];

const mockFfmpeg = jest.fn((inputPath: string) => {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const behavior = ffmpegBehaviors.shift() ?? { mode: 'success' as const };

  const command = {
    inputPath,
    noVideo: jest.fn(function (this: any) {
      return this;
    }),
    audioCodec: jest.fn(function (this: any) {
      return this;
    }),
    format: jest.fn(function (this: any) {
      return this;
    }),
    audioChannels: jest.fn(function (this: any) {
      return this;
    }),
    outputOptions: jest.fn(function (this: any) {
      return this;
    }),
    audioFrequency: jest.fn(function (this: any) {
      return this;
    }),
    audioBitrate: jest.fn(function (this: any) {
      return this;
    }),
    output: jest.fn(function (this: any) {
      return this;
    }),
    on: jest.fn(function (
      this: any,
      event: string,
      callback: (...args: any[]) => void
    ) {
      handlers[event] = callback;
      return this;
    }),
    run: jest.fn(() => {
      handlers.start?.('ffmpeg command');
      for (const line of behavior.stderrLines ?? []) {
        handlers.stderr?.(line);
      }

      if (behavior.mode === 'error') {
        handlers.error?.(
          behavior.errorObject ??
            new Error(behavior.errorMessage ?? 'ffmpeg error')
        );
        return;
      }

      handlers.end?.();
    }),
  };

  ffmpegCommands.push(command);
  return command;
});

jest.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  readFile: mockReadFile,
}));

jest.mock('node:crypto', () => ({
  randomBytes: mockRandomBytes,
}));

jest.mock('fluent-ffmpeg', () => ({
  __esModule: true,
  default: mockFfmpeg,
}));

jest.mock('@core/services/converter/audio/fileUtils.service', () => ({
  FileUtils: {
    safeUnlink: mockSafeUnlink,
  },
}));

jest.mock('@core/services/converter/audio/audioProbe.service', () => ({
  AudioProbeService: class {},
}));

import { AudioFfmpegConverter } from '@core/services/converter/audio/audioFfmpegConverter.service';

describe('AudioFfmpegConverter', () => {
  const makeService = () => {
    const audioProbeService = {
      probeDuration: jest.fn<Promise<number>, [string]>(async () => 0),
    };

    const service = new AudioFfmpegConverter(audioProbeService as never);

    return {
      service,
      audioProbeService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ffmpegBehaviors.length = 0;
    ffmpegCommands.length = 0;

    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(Buffer.from('converted-audio'));
    mockRandomBytes.mockReturnValue(Buffer.from('abcdabcd'));
    mockSafeUnlink.mockResolvedValue(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('converts regular audio to mp3 format and returns output metadata', async () => {
    const { service, audioProbeService } = makeService();

    audioProbeService.probeDuration
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(12);

    await expect(
      service.convert(Buffer.from('audio'), 'wav', false)
    ).resolves.toEqual({
      buffer: Buffer.from('converted-audio'),
      mimetype: 'audio/mpeg',
      extension: 'mp3',
      duration: 12,
    });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(ffmpegCommands[0].inputPath).toContain('audio-input-1700000000000');
    expect(ffmpegCommands[0].inputPath).toContain('.wav');

    expect(ffmpegCommands[0].audioCodec).toHaveBeenCalledWith('libmp3lame');
    expect(ffmpegCommands[0].format).toHaveBeenCalledWith('mp3');
    expect(ffmpegCommands[0].audioFrequency).toHaveBeenCalledWith(44100);
    expect(ffmpegCommands[0].audioChannels).toHaveBeenCalledWith(2);
    expect(ffmpegCommands[0].audioBitrate).toHaveBeenCalledWith('128k');

    expect(mockSafeUnlink).toHaveBeenCalledTimes(2);
    const safeUnlinkCalls = mockSafeUnlink.mock.calls as unknown as unknown[][];
    expect(safeUnlinkCalls[0][0]).toContain('audio-input-1700000000000');
    expect(safeUnlinkCalls[1][0]).toContain('audio-output-1700000000000');
  });

  it('converts ptt audio using opus configuration', async () => {
    const { service, audioProbeService } = makeService();

    audioProbeService.probeDuration
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(9);

    await expect(
      service.convert(Buffer.from('audio'), 'mp3', true)
    ).resolves.toEqual({
      buffer: Buffer.from('converted-audio'),
      mimetype: 'audio/ogg; codecs=opus',
      extension: 'opus',
      duration: 9,
    });

    expect(ffmpegCommands[0].audioCodec).toHaveBeenCalledWith('libopus');
    expect(ffmpegCommands[0].format).toHaveBeenCalledWith('ogg');
    expect(ffmpegCommands[0].audioChannels).toHaveBeenCalledWith(1);
    expect(ffmpegCommands[0].outputOptions).toHaveBeenCalledWith([
      '-avoid_negative_ts',
      'make_zero',
    ]);
  });

  it('maps invalid conversion errors to domain-specific message', async () => {
    const { service, audioProbeService } = makeService();

    audioProbeService.probeDuration.mockResolvedValueOnce(1);
    ffmpegBehaviors.push({
      mode: 'error',
      errorMessage: 'ffmpeg exited with code 1',
      stderrLines: ['Invalid data found when processing input'],
    });

    await expect(
      service.convert(Buffer.from('audio'), 'wav', false)
    ).rejects.toThrow('Arquivo de áudio inválido ou corrompido:');

    expect(mockSafeUnlink).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-format conversion errors and still cleans temporary files', async () => {
    const { service } = makeService();

    mockWriteFile.mockRejectedValueOnce(new Error('disk write failure'));

    await expect(
      service.convert(Buffer.from('audio'), 'wav', false)
    ).rejects.toThrow('disk write failure');

    expect(mockSafeUnlink).toHaveBeenCalledTimes(2);
  });

  it('handles non-Error thrown values while still cleaning temporary files', async () => {
    const { service } = makeService();

    mockWriteFile.mockRejectedValueOnce('raw-failure');

    await expect(
      service.convert(Buffer.from('audio'), 'wav', false)
    ).rejects.toEqual('raw-failure');

    expect(mockSafeUnlink).toHaveBeenCalledTimes(2);
  });

  it('validateInputFile ignores non-format probe errors and rejects known invalid formats', async () => {
    const { service, audioProbeService } = makeService();

    audioProbeService.probeDuration.mockRejectedValueOnce(
      new Error('temporary timeout')
    );
    await expect(
      (service as any).validateInputFile('/tmp/in.wav', 'wav')
    ).resolves.toBeUndefined();

    audioProbeService.probeDuration.mockRejectedValueOnce('probe non-error');
    await expect(
      (service as any).validateInputFile('/tmp/in.wav', 'wav')
    ).resolves.toBeUndefined();

    audioProbeService.probeDuration.mockRejectedValueOnce(
      new Error('Invalid data found when processing input')
    );
    await expect(
      (service as any).validateInputFile('/tmp/in.wav', 'wav')
    ).rejects.toThrow('Formato esperado: wav');
  });

  it('runConversion rejects original error when ffmpeg error is not format-related', async () => {
    const { service } = makeService();

    ffmpegBehaviors.push({
      mode: 'error',
      errorMessage: 'unexpected ffmpeg crash',
      stderrLines: ['some generic stderr'],
    });

    await expect(
      (service as any).runConversion('/tmp/input.wav', '/tmp/output.mp3', false)
    ).rejects.toThrow('unexpected ffmpeg crash');
  });

  it('runConversion evaluates fallback string conversion when error.message is empty', async () => {
    const { service } = makeService();

    const ffmpegErrorObject = {
      message: '',
      toString: () => 'custom non-message error',
    };

    ffmpegBehaviors.push({
      mode: 'error',
      errorObject: ffmpegErrorObject,
      stderrLines: ['generic stderr'],
    });

    await expect(
      (service as any).runConversion('/tmp/input.wav', '/tmp/output.mp3', false)
    ).rejects.toBe(ffmpegErrorObject);
  });
});
