import 'reflect-metadata';

const execAsyncMock = jest.fn();

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('node:util', () => ({
  promisify: jest.fn(() => execAsyncMock),
}));

import { AudioProbeService } from '@core/services/converter/audio/audioProbe.service';

describe('AudioProbeService', () => {
  beforeEach(() => {
    execAsyncMock.mockReset();
  });

  it('runs ffprobe metadata command and parses output', async () => {
    execAsyncMock.mockResolvedValue({
      stdout: '{"format":{"duration":"12.3"}}',
    });
    const service = new AudioProbeService();

    await expect(service.probeMetadata('/tmp/a.mp3')).resolves.toEqual({
      format: { duration: '12.3' },
    });
    expect(execAsyncMock).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining([
        '-show_entries',
        'format=duration,format_name,start_time,bit_rate:stream=codec_type,codec_name,channels,sample_rate,bit_rate,start_time,duration',
        '/tmp/a.mp3',
      ])
    );
  });

  it('extracts duration and handles invalid values', () => {
    const service = new AudioProbeService();

    expect(service.extractDuration({ format: { duration: '10.4' } })).toBe(10);
    expect(
      service.extractDuration({ format: { duration: '-1' } })
    ).toBeUndefined();
    expect(service.extractDuration({})).toBeUndefined();
  });

  it('probes duration and returns undefined on empty/invalid/error', async () => {
    execAsyncMock
      .mockResolvedValueOnce({ stdout: '22.8\n' })
      .mockResolvedValueOnce({ stdout: '0\n' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockRejectedValueOnce(new Error('ffprobe fail'));

    const service = new AudioProbeService();

    await expect(service.probeDuration('/tmp/a.mp3')).resolves.toBe(23);
    await expect(service.probeDuration('/tmp/a.mp3')).resolves.toBeUndefined();
    await expect(service.probeDuration('/tmp/a.mp3')).resolves.toBeUndefined();
    await expect(service.probeDuration('/tmp/a.mp3')).resolves.toBeUndefined();
  });
});
