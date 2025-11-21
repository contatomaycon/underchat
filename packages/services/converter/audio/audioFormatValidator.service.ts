import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { IConvertAudioResult } from '@core/common/interfaces/IConvertAudioResult';
import { AudioProbeService } from './audioProbe.service';
import { FileUtils } from './fileUtils.service';

export class AudioFormatValidator {
  async checkAndReturnIfValid(
    inputBuffer: Buffer,
    targetMimetype: string,
    targetFormat: string
  ): Promise<IConvertAudioResult | null> {
    const tempPath = join(
      tmpdir(),
      `audio-probe-${Date.now()}-${randomBytes(8).toString('hex')}.${targetFormat}`
    );

    try {
      await writeFile(tempPath, inputBuffer);

      const probeService = new AudioProbeService();
      const probeData = await probeService.probeMetadata(tempPath);
      const duration = probeService.extractDuration(probeData);
      const isValid = this.validateFormat(probeData);

      if (isValid) {
        await FileUtils.safeUnlink(tempPath);
        return {
          buffer: inputBuffer,
          mimetype: targetMimetype,
          extension: targetFormat,
          duration,
        };
      }
    } catch {
    } finally {
      await FileUtils.safeUnlink(tempPath);
    }

    return null;
  }

  private validateFormat(probeData: any): boolean {
    const stream = probeData.streams?.[0];
    const codecName = stream?.codec_name;
    const channels = stream?.channels;
    const sampleRate = stream?.sample_rate;
    const bitRate = stream?.bit_rate
      ? Number.parseInt(stream.bit_rate, 10)
      : null;

    const isOpus = codecName === 'opus';
    const isMono = channels === 1;
    const is48kHz = sampleRate === 48000;
    const isCorrectBitrate = !bitRate || (bitRate >= 16000 && bitRate <= 64000);

    return isOpus && isMono && is48kHz && isCorrectBitrate;
  }
}
