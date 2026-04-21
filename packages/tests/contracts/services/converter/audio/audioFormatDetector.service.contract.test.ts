import 'reflect-metadata';
import { AudioFormatDetector } from '@core/services/converter/audio/audioFormatDetector.service';

describe('AudioFormatDetector', () => {
  const service = new AudioFormatDetector();

  it('detects known audio headers', () => {
    expect(
      service.detectFromBuffer(Buffer.from([0x4f, 0x67, 0x67, 0x53]))
    ).toBe('ogg');
    expect(
      service.detectFromBuffer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    ).toBe('webm');
    expect(
      service.detectFromBuffer(
        Buffer.from([0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a])
      )
    ).toBe('amr');
    expect(
      service.detectFromBuffer(Buffer.from([0xff, 0xfb, 0x00, 0x00]))
    ).toBe('mp3');
    expect(service.detectFromBuffer(Buffer.from('ID3\x03\x00\x00'))).toBe(
      'mp3'
    );
    expect(service.detectFromBuffer(Buffer.from([0xff, 0xf1]))).toBe('');
    expect(
      service.detectFromBuffer(Buffer.from([0xff, 0xf1, 0x00, 0x00]))
    ).toBe('aac');
  });

  it('detects mp4 and handles short/unknown buffers', () => {
    const mp4Buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);

    expect(service.detectFromBuffer(mp4Buffer)).toBe('mp4');
    expect(service.detectFromBuffer(Buffer.from([0x00]))).toBe('');
    expect(
      service.detectFromBuffer(
        Buffer.from([0x12, 0x34, 0x56, 0x78, 0x00, 0x00])
      )
    ).toBe('');
  });

  it('maps extension from mimetype', () => {
    expect(service.getExtensionFromMimetype('audio/ogg')).toBe('ogg');
    expect(service.getExtensionFromMimetype('audio/opus')).toBe('ogg');
    expect(service.getExtensionFromMimetype('audio/webm')).toBe('webm');
    expect(service.getExtensionFromMimetype('audio/mp3')).toBe('mp3');
    expect(service.getExtensionFromMimetype('audio/aac')).toBe('aac');
    expect(service.getExtensionFromMimetype('audio/amr')).toBe('amr');
    expect(service.getExtensionFromMimetype('audio/mp4')).toBe('mp4');
    expect(service.getExtensionFromMimetype(null)).toBe('');
    expect(service.getExtensionFromMimetype('audio/unknown')).toBe('');
  });
});
