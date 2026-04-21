import 'reflect-metadata';
import { ConverterService } from '@core/services/converter';

describe('ConverterService', () => {
  it('convertAudio chooses format by detector, mimetype fallback and default', async () => {
    const detectFromBuffer = jest
      .fn<string, unknown[]>()
      .mockReturnValueOnce('ogg')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');
    const getExtensionFromMimetype = jest
      .fn<string, unknown[]>()
      .mockReturnValueOnce('webm')
      .mockReturnValueOnce('');
    const convert = jest.fn(async (_buffer, format) => ({ extension: format }));

    const service = new ConverterService(
      { detectFromBuffer, getExtensionFromMimetype } as never,
      { convert } as never,
      { generate: jest.fn(async () => 'wf') } as never,
      {
        detectFromBuffer: jest.fn(),
        getExtensionFromMimetype: jest.fn(),
      } as never,
      { checkAndReturnIfValid: jest.fn() } as never,
      { convert: jest.fn() } as never
    );

    await expect(
      service.convertAudio(Buffer.from('a'), 'x', true)
    ).resolves.toEqual({
      extension: 'ogg',
    });
    await expect(
      service.convertAudio(Buffer.from('a'), 'audio/webm', true)
    ).resolves.toEqual({
      extension: 'webm',
    });
    await expect(
      service.convertAudio(Buffer.from('a'), null, true)
    ).resolves.toEqual({
      extension: 'webm',
    });

    expect(convert).toHaveBeenNthCalledWith(1, expect.any(Buffer), 'ogg', true);
    expect(convert).toHaveBeenNthCalledWith(
      2,
      expect.any(Buffer),
      'webm',
      true
    );
    expect(convert).toHaveBeenNthCalledWith(
      3,
      expect.any(Buffer),
      'webm',
      true
    );
  });

  it('delegates waveform generation', async () => {
    const generate = jest.fn(async () => 'base64-wave');
    const service = new ConverterService(
      {
        detectFromBuffer: jest.fn(),
        getExtensionFromMimetype: jest.fn(),
      } as never,
      { convert: jest.fn() } as never,
      { generate } as never,
      {
        detectFromBuffer: jest.fn(),
        getExtensionFromMimetype: jest.fn(),
      } as never,
      { checkAndReturnIfValid: jest.fn() } as never,
      { convert: jest.fn() } as never
    );

    await expect(
      service.generateWaveformWithFfmpeg(Buffer.from('a'))
    ).resolves.toBe('base64-wave');
  });

  it('convertVideo returns validator result for valid mp4, otherwise converts', async () => {
    const videoDetect = {
      detectFromBuffer: jest
        .fn<string, unknown[]>()
        .mockReturnValueOnce('mp4')
        .mockReturnValueOnce('mp4')
        .mockReturnValueOnce('webm'),
      getExtensionFromMimetype: jest.fn(() => ''),
    };
    const checkAndReturnIfValid = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce({ extension: 'mp4-valid' })
      .mockResolvedValueOnce(null);
    const convert = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce({ extension: 'mp4-converted' })
      .mockResolvedValueOnce({ extension: 'webm-converted' });

    const service = new ConverterService(
      {
        detectFromBuffer: jest.fn(),
        getExtensionFromMimetype: jest.fn(),
      } as never,
      { convert: jest.fn() } as never,
      { generate: jest.fn() } as never,
      videoDetect as never,
      { checkAndReturnIfValid } as never,
      { convert } as never
    );

    await expect(
      service.convertVideo(Buffer.from('a'), 'video/mp4')
    ).resolves.toEqual({
      extension: 'mp4-valid',
    });
    await expect(
      service.convertVideo(Buffer.from('a'), 'video/mp4')
    ).resolves.toEqual({
      extension: 'mp4-converted',
    });
    await expect(
      service.convertVideo(Buffer.from('a'), 'video/webm')
    ).resolves.toEqual({
      extension: 'webm-converted',
    });
  });
});
