import 'reflect-metadata';

const execAsyncMock = jest.fn();

jest.mock('node:child_process', () => ({ exec: jest.fn() }));
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
      expect.stringContaining('ffprobe')
    );
    expect(execAsyncMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'format=duration,format_name:stream=codec_type,codec_name,channels,sample_rate,bit_rate'
      )
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
