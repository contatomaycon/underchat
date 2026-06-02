import 'reflect-metadata';

const execAsyncMock = jest.fn();

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('node:util', () => ({
  promisify: jest.fn(() => execAsyncMock),
}));

import { VideoProbeService } from '@core/services/converter/video/videoProbe.service';

describe('VideoProbeService', () => {
  beforeEach(() => {
    execAsyncMock.mockReset();
  });

  it('runs ffprobe metadata command and parses output', async () => {
    execAsyncMock.mockResolvedValue({
      stdout: '{"format":{"duration":"12.3"}}',
    });
    const service = new VideoProbeService();

    await expect(service.probeMetadata('/tmp/a.mp4')).resolves.toEqual({
      format: { duration: '12.3' },
    });
    expect(execAsyncMock).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining([
        '-show_entries',
        'format=duration,format_name,start_time,bit_rate:stream=codec_type,codec_name,width,height,pix_fmt,channels,sample_rate,start_time,duration,bit_rate',
        '/tmp/a.mp4',
      ])
    );
  });

  it('extracts duration and dimensions', () => {
    const service = new VideoProbeService();

    expect(service.extractDuration({ format: { duration: '8.9' } })).toBe(9);
    expect(
      service.extractDuration({ format: { duration: '0' } })
    ).toBeUndefined();

    expect(
      service.extractDimensions({
        streams: [{ codec_type: 'video', width: '1920', height: '1080' }],
      })
    ).toEqual({ width: 1920, height: 1080 });

    expect(
      service.extractDimensions({
        streams: [{ codec_type: 'audio', width: 'x' }],
      })
    ).toEqual({});
  });

  it('probes duration and returns undefined on invalid/error', async () => {
    execAsyncMock
      .mockResolvedValueOnce({ stdout: '11.2\n' })
      .mockResolvedValueOnce({ stdout: '0\n' })
      .mockRejectedValueOnce(new Error('ffprobe fail'));

    const service = new VideoProbeService();

    await expect(service.probeDuration('/tmp/a.mp4')).resolves.toBe(11);
    await expect(service.probeDuration('/tmp/a.mp4')).resolves.toBeUndefined();
    await expect(service.probeDuration('/tmp/a.mp4')).resolves.toBeUndefined();
  });
});
