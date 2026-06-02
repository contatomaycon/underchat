import 'reflect-metadata';

const writeFileMock = jest.fn();
const readFileMock = jest.fn();
const safeUnlinkMock = jest.fn(async () => undefined);

const ffmpegState = { shouldError: false };
const ffmpegChains: any[] = [];

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
      audioFrequency: jest.fn(() => chain),
      audioChannels: jest.fn(() => chain),
      audioBitrate: jest.fn(() => chain),
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

    ffmpegChains.push(chain);
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
    ffmpegChains.length = 0;
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(Buffer.from('out-video'));
  });

  it('converts video and enriches response with probe metadata', async () => {
    const service = new VideoFfmpegConverter({
      probeMetadata: jest.fn(async () => ({
        format: {
          duration: '7',
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
          start_time: '0.000000',
          bit_rate: '600000',
        },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1280,
            height: 720,
            pix_fmt: 'yuv420p',
            start_time: '0.000000',
            duration: '7.000000',
            bit_rate: '470000',
          },
          {
            codec_type: 'audio',
            codec_name: 'aac',
            channels: 2,
            sample_rate: '44100',
            start_time: '0.000000',
            duration: '7.000000',
            bit_rate: '128000',
          },
        ],
      })),
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
      probe: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        format_duration: '7',
        format_start_time: '0.000000',
        format_bit_rate: '600000',
        video_codec_name: 'h264',
        video_width: 1280,
        video_height: 720,
        video_pix_fmt: 'yuv420p',
        video_duration: '7.000000',
        video_start_time: '0.000000',
        video_bit_rate: '470000',
        audio_codec_name: 'aac',
        audio_channels: 2,
        audio_sample_rate: 44100,
        audio_duration: '7.000000',
        audio_start_time: '0.000000',
        audio_bit_rate: '128000',
      },
    });
    expect(writeFileMock).toHaveBeenCalled();
    expect(readFileMock).toHaveBeenCalled();
    expect(ffmpegChains[0].audioCodec).toHaveBeenCalledWith('aac');
    expect(ffmpegChains[0].audioFrequency).toHaveBeenCalledWith(44100);
    expect(ffmpegChains[0].audioChannels).toHaveBeenCalledWith(2);
    expect(ffmpegChains[0].audioBitrate).toHaveBeenCalledWith('128k');
    expect(ffmpegChains[0].outputOptions).toHaveBeenCalledWith([
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-movflags',
      '+faststart',
      '-pix_fmt',
      'yuv420p',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2,setpts=PTS-STARTPTS',
      '-af',
      'aresample=async=1:first_pts=0',
      '-map_metadata',
      '-1',
      '-fflags',
      '+genpts',
      '-avoid_negative_ts',
      'make_zero',
    ]);
    expect(safeUnlinkMock).toHaveBeenCalledTimes(2);
  });

  it('rejects converted video outside WhatsApp profile', async () => {
    const service = new VideoFfmpegConverter({
      probeMetadata: jest.fn(async () => ({
        format: { duration: '7', format_name: 'webm' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'vp9',
            width: 1280,
            height: 720,
            pix_fmt: 'yuv420p',
          },
        ],
      })),
      extractDuration: jest.fn(),
      extractDimensions: jest.fn(),
    } as never);

    await expect(service.convert(Buffer.from('video'), 'webm')).rejects.toThrow(
      'perfil WhatsApp MP4/H.264/AAC'
    );
    expect(readFileMock).not.toHaveBeenCalled();
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
