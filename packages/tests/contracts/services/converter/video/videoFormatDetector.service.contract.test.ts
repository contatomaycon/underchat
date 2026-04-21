import 'reflect-metadata';
import { VideoFormatDetector } from '@core/services/converter/video/videoFormatDetector.service';

describe('VideoFormatDetector', () => {
  const service = new VideoFormatDetector();

  it('detects known video headers', () => {
    const mp4 = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    const webm = Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const avi = Buffer.from('RIFFxxxxAVI ');
    const mov = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
    ]);
    const mkv = Buffer.from([
      0x1a, 0x45, 0xdf, 0xa3, 0x42, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const flv = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]);
    const gp3 = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x70, 0x34,
    ]);

    expect(service.detectFromBuffer(mp4)).toBe('mp4');
    expect(service.detectFromBuffer(webm)).toBe('webm');
    expect(service.detectFromBuffer(avi)).toBe('avi');
    expect(service.detectFromBuffer(mov)).toBe('mov');
    expect(service.detectFromBuffer(mkv)).toBe('webm');
    expect(service.detectFromBuffer(flv)).toBe('flv');
    expect(service.detectFromBuffer(gp3)).toBe('3gp');
    expect(service.detectFromBuffer(Buffer.from([0x00]))).toBe('');
  });

  it('maps extension from mimetype and unknown', () => {
    expect(service.getExtensionFromMimetype('video/mp4')).toBe('mp4');
    expect(service.getExtensionFromMimetype('video/webm')).toBe('webm');
    expect(service.getExtensionFromMimetype('video/avi')).toBe('avi');
    expect(service.getExtensionFromMimetype('video/quicktime')).toBe('mov');
    expect(service.getExtensionFromMimetype('video/matroska')).toBe('mkv');
    expect(service.getExtensionFromMimetype('video/x-flv')).toBe('flv');
    expect(service.getExtensionFromMimetype('video/3gpp')).toBe('3gp');
    expect(service.getExtensionFromMimetype('video/unknown')).toBe('');
    expect(service.getExtensionFromMimetype(undefined)).toBe('');
  });
});
