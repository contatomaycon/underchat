import { injectable, inject } from 'tsyringe';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { IConvertAudioResult } from '@core/common/interfaces/IConvertAudioResult';
import { AudioProbeService } from './audioProbe.service';
import { FileUtils } from './fileUtils.service';

@injectable()
export class AudioFormatValidator {
  constructor(
    @inject(AudioProbeService)
    private readonly audioProbeService: AudioProbeService
  ) {}

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

      const probeData = await this.audioProbeService.probeMetadata(tempPath);
      const duration = this.audioProbeService.extractDuration(probeData);
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

    const isOpus = codecName === 'opus';

    return isOpus;
  }
}
