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
    const acceptedFormats = ['ogg', 'opus', 'mp3', 'aac', 'amr'];
    const currentFormat = this.getExtensionFromMimetype(inputMimetype);

    if (acceptedFormats.includes(currentFormat)) {
      return {
        buffer: inputBuffer,
        mimetype: inputMimetype || this.targetMimetype,
        extension: currentFormat,
      };
    }

    const inputExtension =
      this.getExtensionFromMimetype(inputMimetype) || 'webm';
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

  private getExtensionFromMimetype(mimetype?: string | null): string {
    if (!mimetype) return this.targetFormat;

    if (mimetype.includes('ogg') || mimetype.includes('opus')) return 'ogg';
    if (mimetype.includes('mp3')) return 'mp3';
    if (mimetype.includes('aac')) return 'aac';
    if (mimetype.includes('amr')) return 'amr';
    if (mimetype.includes('mp4')) return 'mp4';

    return this.targetFormat;
  }
}
