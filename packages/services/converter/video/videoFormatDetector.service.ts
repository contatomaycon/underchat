import { Buffer } from 'node:buffer';

export class VideoFormatDetector {
  detectFromBuffer(buffer: Buffer): string {
    if (buffer.length < 12) {
      return '';
    }

    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];

    const format =
      this.detectMp4Format(buffer, b0, b1, b2, b3) ||
      this.detectWebmFormat(b0, b1, b2, b3) ||
      this.detectAviFormat(buffer, b0, b1, b2, b3) ||
      this.detectMovFormat(buffer, b0, b1, b2, b3) ||
      this.detectMkvFormat(buffer, b0, b1, b2, b3) ||
      this.detectFlvFormat(buffer, b0, b1, b2, b3) ||
      this.detect3gpFormat(buffer, b0, b1, b2, b3);

    return format || '';
  }

  getExtensionFromMimetype(mimetype?: string | null): string {
    if (!mimetype) {
      return '';
    }

    const lower = mimetype.toLowerCase();

    if (lower.includes('mp4')) {
      return 'mp4';
    }

    if (lower.includes('webm')) {
      return 'webm';
    }

    if (lower.includes('avi')) {
      return 'avi';
    }

    if (lower.includes('quicktime') || lower.includes('mov')) {
      return 'mov';
    }

    if (lower.includes('matroska') || lower.includes('mkv')) {
      return 'mkv';
    }

    if (lower.includes('x-flv') || lower.includes('flv')) {
      return 'flv';
    }

    if (lower.includes('3gpp') || lower.includes('3gp')) {
      return '3gp';
    }

    return '';
  }

  private detectMp4Format(
    buffer: Buffer,
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (buffer.length < 12) {
      return null;
    }

    const isMp4Header =
      (b0 === 0x00 && b1 === 0x00 && b2 === 0x00 && b3 >= 0x18) ||
      (b0 === 0x00 && b1 === 0x00 && b2 === 0x00 && b3 === 0x20);

    if (!isMp4Header) {
      return null;
    }

    const ftyp = buffer.toString('ascii', 4, 8);
    if (ftyp !== 'ftyp') {
      return null;
    }

    const brand = buffer.toString('ascii', 8, 12);
    if (
      brand.includes('mp4') ||
      brand.includes('isom') ||
      brand.includes('avc1') ||
      brand.includes('iso2')
    ) {
      return 'mp4';
    }

    return null;
  }

  private detectWebmFormat(
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) {
      return 'webm';
    }
    return null;
  }

  private detectAviFormat(
    buffer: Buffer,
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (buffer.length < 12) {
      return null;
    }

    const riff = buffer.toString('ascii', 0, 4);
    const avi = buffer.toString('ascii', 8, 12);

    if (riff === 'RIFF' && avi === 'AVI ') {
      return 'avi';
    }

    return null;
  }

  private detectMovFormat(
    buffer: Buffer,
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (buffer.length < 12) {
      return null;
    }

    const ftyp = buffer.toString('ascii', 4, 8);
    if (ftyp !== 'ftyp') {
      return null;
    }

    const brand = buffer.toString('ascii', 8, 12);
    if (brand.includes('qt') || brand.includes('mov')) {
      return 'mov';
    }

    return null;
  }

  private detectMkvFormat(
    buffer: Buffer,
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) {
      if (buffer.length >= 5 && buffer[4] === 0x42) {
        return 'mkv';
      }
    }
    return null;
  }

  private detectFlvFormat(
    buffer: Buffer,
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (buffer.length < 4) {
      return null;
    }

    if (b0 === 0x46 && b1 === 0x4c && b2 === 0x56 && b3 === 0x01) {
      return 'flv';
    }

    return null;
  }

  private detect3gpFormat(
    buffer: Buffer,
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (buffer.length < 12) {
      return null;
    }

    const ftyp = buffer.toString('ascii', 4, 8);
    if (ftyp !== 'ftyp') {
      return null;
    }

    const brand = buffer.toString('ascii', 8, 12);
    if (brand.includes('3gp')) {
      return '3gp';
    }

    return null;
  }
}
