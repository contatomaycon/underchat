import { injectable } from 'tsyringe';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { getAudioWaveform } from '@whiskeysockets/baileys';

const execAsync = promisify(exec);

interface ConvertAudioResult {
  buffer: Buffer;
  mimetype: string;
  extension: string;
  duration?: number;
}

@injectable()
export class AudioConverterService {
  private readonly targetFormat = 'ogg';
  private readonly targetMimetype = 'audio/ogg; codecs=opus';

  async convertAudio(
    inputBuffer: Buffer,
    inputMimetype?: string | null
  ): Promise<ConvertAudioResult> {
    const extensionFromMimetype = this.getExtensionFromMimetype(inputMimetype);
    const headerFormat = this.detectFormatFromBuffer(inputBuffer);
    const currentFormat = headerFormat || extensionFromMimetype || 'webm';

    if (currentFormat === this.targetFormat) {
      const tempPath = join(
        tmpdir(),
        `audio-probe-${Date.now()}-${randomBytes(8).toString('hex')}.ogg`
      );

      let duration: number | undefined;

      try {
        await writeFile(tempPath, inputBuffer);

        const probeCommand = [
          'ffprobe',
          '-v',
          'error',
          '-show_entries',
          'format=duration,stream=codec_name,stream=channels,stream=sample_rate,stream=bit_rate',
          '-of',
          'json',
          `"${tempPath}"`,
        ].join(' ');

        const { stdout } = await execAsync(probeCommand);
        const probeData = JSON.parse(stdout);
        const format = probeData.format;
        const stream = probeData.streams?.[0];

        if (format?.duration) {
          const parsedDuration = parseFloat(format.duration);
          if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
            duration = Math.round(parsedDuration);
          }
        }

        const codecName = stream?.codec_name;
        const channels = stream?.channels;
        const sampleRate = stream?.sample_rate;
        const bitRate = stream?.bit_rate ? parseInt(stream.bit_rate, 10) : null;

        const isOpus = codecName === 'opus';
        const isMono = channels === 1;
        const is48kHz = sampleRate === 48000;
        const isCorrectBitrate =
          !bitRate || (bitRate >= 16000 && bitRate <= 64000);

        if (isOpus && isMono && is48kHz && isCorrectBitrate) {
          try {
            await unlink(tempPath);
          } catch {}

          return {
            buffer: inputBuffer,
            mimetype: this.targetMimetype,
            extension: this.targetFormat,
            duration,
          };
        }
      } catch {
        duration = undefined;
      } finally {
        try {
          await unlink(tempPath);
        } catch {}
      }
    }

    const inputRandomId = randomBytes(8).toString('hex');
    const outputRandomId = randomBytes(8).toString('hex');

    const inputPath = join(
      tmpdir(),
      `audio-input-${Date.now()}-${inputRandomId}.${currentFormat}`
    );

    const outputPath = join(
      tmpdir(),
      `audio-output-${Date.now()}-${outputRandomId}.${this.targetFormat}`
    );

    try {
      await writeFile(inputPath, inputBuffer);

      const ffmpegCommand = [
        'ffmpeg',
        '-i',
        `"${inputPath}"`,
        '-vn',
        '-c:a libopus',
        '-b:a 32k',
        '-ar 48000',
        '-ac 1',
        '-application voip',
        '-frame_duration 60',
        '-packet_loss 0',
        '-compression_level 10',
        '-f ogg',
        `"${outputPath}"`,
        '-y',
      ].join(' ');

      await execAsync(ffmpegCommand);

      const outputBuffer = await readFile(outputPath);

      let duration: number | undefined;

      try {
        const probeCommand = [
          'ffprobe',
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          `"${outputPath}"`,
        ].join(' ');

        const { stdout } = await execAsync(probeCommand);
        const durationStr = stdout.trim();
        if (durationStr) {
          const parsedDuration = parseFloat(durationStr);
          if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
            duration = Math.round(parsedDuration);
          }
        }
      } catch {
        duration = undefined;
      }

      return {
        buffer: outputBuffer,
        mimetype: this.targetMimetype,
        extension: this.targetFormat,
        duration,
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

  private detectOggFormat(
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) {
      return 'ogg';
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

  private detectAmrFormat(
    buffer: Buffer,
    b0: number,
    b1: number,
    b2: number,
    b3: number
  ): string | null {
    if (buffer.length < 6) {
      return null;
    }

    if (
      b0 === 0x23 &&
      b1 === 0x21 &&
      b2 === 0x41 &&
      b3 === 0x4d &&
      buffer[4] === 0x52
    ) {
      return 'amr';
    }

    return null;
  }

  private detectMp3Format(
    buffer: Buffer,
    b0: number,
    b1: number
  ): string | null {
    if (buffer.length < 3) {
      return null;
    }

    if (b0 === 0xff && (b1 === 0xfb || b1 === 0xf3 || b1 === 0xf2)) {
      return 'mp3';
    }

    const id3 = buffer.toString('ascii', 0, 3);
    if (id3 === 'ID3') {
      return 'mp3';
    }

    return null;
  }

  private detectAacFormat(
    buffer: Buffer,
    b0: number,
    b1: number
  ): string | null {
    if (buffer.length < 2) {
      return null;
    }

    if (b0 === 0xff && (b1 === 0xf1 || b1 === 0xf9)) {
      return 'aac';
    }

    return null;
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
      brand.includes('M4A')
    ) {
      return 'mp4';
    }

    return null;
  }

  private detectFormatFromBuffer(buffer: Buffer): string {
    if (buffer.length < 4) {
      return '';
    }

    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];

    const format =
      this.detectOggFormat(b0, b1, b2, b3) ||
      this.detectWebmFormat(b0, b1, b2, b3) ||
      this.detectAmrFormat(buffer, b0, b1, b2, b3) ||
      this.detectMp3Format(buffer, b0, b1) ||
      this.detectAacFormat(buffer, b0, b1) ||
      this.detectMp4Format(buffer, b0, b1, b2, b3);

    return format || '';
  }

  private getExtensionFromMimetype(mimetype?: string | null): string {
    if (!mimetype) {
      return '';
    }

    const lower = mimetype.toLowerCase();

    if (lower.includes('ogg') || lower.includes('opus')) {
      return 'ogg';
    }

    if (lower.includes('webm')) {
      return 'webm';
    }
    if (lower.includes('mp3')) {
      return 'mp3';
    }
    if (lower.includes('aac')) {
      return 'aac';
    }
    if (lower.includes('amr')) {
      return 'amr';
    }
    if (lower.includes('mp4')) {
      return 'mp4';
    }

    return '';
  }

  async generateWaveformWithFfmpeg(
    audioBuffer: Buffer
  ): Promise<string | undefined> {
    try {
      const wave = await getAudioWaveform(audioBuffer);
      if (!wave) return undefined;

      return Buffer.from(wave).toString('base64');
    } catch (error) {
      console.error(
        'Failed to generate waveform with getAudioWaveform:',
        error
      );
      return undefined;
    }
  }
}
