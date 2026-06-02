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
    audioFilters: jest.fn(function (this: any) {
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
  const mp3Metadata = {
    format: {
      duration: '12.2',
      format_name: 'mp3',
      start_time: '0.000000',
      bit_rate: '128000',
    },
    streams: [
      {
        codec_type: 'audio',
        codec_name: 'mp3',
        channels: 2,
        sample_rate: '44100',
        start_time: '0.000000',
        duration: '12.2',
        bit_rate: '128000',
      },
    ],
  };

  const pttMetadata = {
    format: {
      duration: '9.2',
      format_name: 'ogg',
      start_time: '0.000000',
      bit_rate: '32000',
    },
    streams: [
      {
        codec_type: 'audio',
        codec_name: 'opus',
        channels: 1,
        sample_rate: '48000',
        start_time: '0.000000',
        duration: '9.2',
        bit_rate: '32000',
      },
    ],
  };

  const makeService = () => {
    const audioProbeService = {
      probeDuration: jest.fn<Promise<number>, [string]>(async () => 0),
      probeMetadata: jest.fn<Promise<any>, [string]>(async () => mp3Metadata),
      extractDuration: jest.fn<number | undefined, [any]>((metadata) => {
        const parsedDuration = Number.parseFloat(
          metadata?.format?.duration ?? ''
        );
        return Number.isFinite(parsedDuration)
          ? Math.round(parsedDuration)
          : undefined;
      }),
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

    audioProbeService.probeDuration.mockResolvedValueOnce(3);
    audioProbeService.probeMetadata.mockResolvedValueOnce(mp3Metadata);

    await expect(
      service.convert(Buffer.from('audio'), 'wav', false)
    ).resolves.toEqual({
      buffer: Buffer.from('converted-audio'),
      mimetype: 'audio/mpeg',
      extension: 'mp3',
      duration: 12,
      probe: {
        format_name: 'mp3',
        format_duration: '12.2',
        format_start_time: '0.000000',
        format_bit_rate: '128000',
        codec_name: 'mp3',
        channels: 2,
        sample_rate: 44100,
        stream_duration: '12.2',
        stream_start_time: '0.000000',
        stream_bit_rate: '128000',
      },
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
    expect(ffmpegCommands[0].audioFilters).toHaveBeenCalledWith(
      'aresample=async=1:first_pts=0'
    );
    expect(ffmpegCommands[0].outputOptions).toHaveBeenCalledWith([
      '-map',
      '0:a:0',
      '-map_metadata',
      '-1',
    ]);
    expect(audioProbeService.probeMetadata).toHaveBeenCalledTimes(1);
    expect(audioProbeService.extractDuration).toHaveBeenCalledWith(mp3Metadata);

    expect(mockSafeUnlink).toHaveBeenCalledTimes(2);
    const safeUnlinkCalls = mockSafeUnlink.mock.calls as unknown as unknown[][];
    expect(safeUnlinkCalls[0][0]).toContain('audio-input-1700000000000');
    expect(safeUnlinkCalls[1][0]).toContain('audio-output-1700000000000');
  });

  it('converts ptt audio using opus configuration', async () => {
    const { service, audioProbeService } = makeService();

    audioProbeService.probeDuration.mockResolvedValueOnce(2);
    audioProbeService.probeMetadata.mockResolvedValueOnce(pttMetadata);

    await expect(
      service.convert(Buffer.from('audio'), 'mp3', true)
    ).resolves.toEqual({
      buffer: Buffer.from('converted-audio'),
      mimetype: 'audio/ogg; codecs=opus',
      extension: 'ogg',
      duration: 9,
      probe: {
        format_name: 'ogg',
        format_duration: '9.2',
        format_start_time: '0.000000',
        format_bit_rate: '32000',
        codec_name: 'opus',
        channels: 1,
        sample_rate: 48000,
        stream_duration: '9.2',
        stream_start_time: '0.000000',
        stream_bit_rate: '32000',
      },
    });

    expect(ffmpegCommands[0].audioCodec).toHaveBeenCalledWith('libopus');
    expect(ffmpegCommands[0].format).toHaveBeenCalledWith('ogg');
    expect(ffmpegCommands[0].audioFrequency).toHaveBeenCalledWith(48000);
    expect(ffmpegCommands[0].audioChannels).toHaveBeenCalledWith(1);
    expect(ffmpegCommands[0].audioBitrate).toHaveBeenCalledWith('32k');
    expect(ffmpegCommands[0].audioFilters).toHaveBeenCalledWith(
      'aresample=async=1:first_pts=0'
    );
    expect(ffmpegCommands[0].outputOptions).toHaveBeenCalledWith([
      '-map',
      '0:a:0',
      '-application',
      'voip',
      '-frame_duration',
      '20',
      '-vbr',
      'on',
      '-compression_level',
      '10',
      '-packet_loss',
      '0',
      '-map_metadata',
      '-1',
      '-fflags',
      '+genpts',
      '-avoid_negative_ts',
      'make_zero',
      '-muxdelay',
      '0',
      '-muxpreload',
      '0',
    ]);
    expect(audioProbeService.probeMetadata).toHaveBeenCalledTimes(1);
    expect(audioProbeService.extractDuration).toHaveBeenCalledWith(pttMetadata);
  });

  it('rejects converted ptt audio outside the WhatsApp voice profile', async () => {
    const { service, audioProbeService } = makeService();

    audioProbeService.probeDuration.mockResolvedValueOnce(2);
    audioProbeService.probeMetadata.mockResolvedValueOnce({
      format: {
        duration: '9.2',
        format_name: 'ogg',
      },
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 2,
          sample_rate: '44100',
        },
      ],
    });

    await expect(
      service.convert(Buffer.from('audio'), 'm4a', true)
    ).rejects.toThrow('perfil de voz WhatsApp');

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockSafeUnlink).toHaveBeenCalledTimes(2);
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
