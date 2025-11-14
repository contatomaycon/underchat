import { injectable } from 'tsyringe';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

const execAsync = promisify(exec);

interface ConvertAudioResult {
  buffer: Buffer;
  mimetype: string;
  extension: string;
}

@injectable()
export class AudioConverterService {
  private readonly targetFormat = 'ogg';
  private readonly targetMimetype = 'audio/ogg; codecs=opus';

  async convertAudio(
    inputBuffer: Buffer,
    inputMimetype?: string | null
  ): Promise<ConvertAudioResult> {
    const currentFormat = this.detectFormatFromBuffer(
      inputBuffer,
      inputMimetype
    );

    if (currentFormat === this.targetFormat) {
      return {
        buffer: inputBuffer,
        mimetype: inputMimetype || this.targetMimetype,
        extension: this.targetFormat,
      };
    }

    const inputExtension =
      this.getExtensionFromMimetype(inputMimetype) || currentFormat || 'webm';

    const inputPath = join(
      tmpdir(),
      `audio-input-${Date.now()}-${Math.random().toString(36).substring(7)}.${inputExtension}`
    );
    const outputPath = join(
      tmpdir(),
      `audio-output-${Date.now()}-${Math.random().toString(36).substring(7)}.${this.targetFormat}`
    );

    try {
      await writeFile(inputPath, inputBuffer);

      const ffmpegCommand = `ffmpeg -i "${inputPath}" -vn -c:a libopus -b:a 32k -ar 48000 -ac 1 -f ${this.targetFormat} "${outputPath}" -y`;

      await execAsync(ffmpegCommand);

      const outputBuffer = await readFile(outputPath);

      return {
        buffer: outputBuffer,
        mimetype: this.targetMimetype,
        extension: this.targetFormat,
      };
    } finally {
      try {
        await unlink(inputPath);
      } catch {}
      try {
        await unlink(outputPath);
      } catch {}
    }
  }

  private detectFormatFromBuffer(
    buffer: Buffer,
    mimetype?: string | null
  ): string {
    if (buffer.length < 4) return this.getExtensionFromMimetype(mimetype);

    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];

    if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) {
      return 'ogg';
    }

    if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) {
      return 'webm';
    }

    if (buffer.length >= 6) {
      if (b0 === 0x23 && b1 === 0x21 && b2 === 0x41 && b3 === 0x4d) {
        if (buffer[4] === 0x52) {
          return 'amr';
        }
      }
    }

    if (buffer.length >= 3) {
      if (b0 === 0xff && (b1 === 0xfb || b1 === 0xf3 || b1 === 0xf2)) {
        return 'mp3';
      }
    }

    if (buffer.length >= 2) {
      if (b0 === 0xff && (b1 === 0xf1 || b1 === 0xf9)) {
        return 'aac';
      }
    }

    if (buffer.length >= 12) {
      if (
        (b0 === 0x00 && b1 === 0x00 && b2 === 0x00 && b3 >= 0x18) ||
        (b0 === 0x00 && b1 === 0x00 && b2 === 0x00 && b3 === 0x20)
      ) {
        const ftyp = buffer.toString('ascii', 4, 8);
        if (ftyp === 'ftyp') {
          const brand = buffer.toString('ascii', 8, 12);
          if (
            brand.includes('mp4') ||
            brand.includes('isom') ||
            brand.includes('M4A')
          ) {
            return 'mp4';
          }
        }
      }
    }

    if (buffer.length >= 3) {
      const id3 = buffer.toString('ascii', 0, 3);
      if (id3 === 'ID3') {
        return 'mp3';
      }
    }

    return this.getExtensionFromMimetype(mimetype);
  }

  private getExtensionFromMimetype(mimetype?: string | null): string {
    if (!mimetype) return '';

    const lower = mimetype.toLowerCase();

    if (lower.includes('ogg') || lower.includes('opus')) return 'ogg';
    if (lower.includes('webm')) return 'webm';
    if (lower.includes('mp3')) return 'mp3';
    if (lower.includes('aac')) return 'aac';
    if (lower.includes('amr')) return 'amr';
    if (lower.includes('mp4')) return 'mp4';

    return '';
  }
}
