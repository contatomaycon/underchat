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
      const isValid = this.validateFormat(
        probeData,
        targetMimetype,
        targetFormat
      );

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

  private validateFormat(
    probeData: any,
    targetMimetype: string,
    targetFormat: string
  ): boolean {
    const stream = Array.isArray(probeData.streams)
      ? (probeData.streams.find((item: any) => item?.codec_type === 'audio') ??
        probeData.streams[0])
      : null;
    const codecName = String(stream?.codec_name ?? '').toLowerCase();
    const formatName = String(
      probeData?.format?.format_name ?? ''
    ).toLowerCase();
    const channels = Number(stream?.channels);
    const sampleRate = Number(stream?.sample_rate);
    const normalizedTarget = `${targetMimetype} ${targetFormat}`.toLowerCase();

    if (normalizedTarget.includes('ogg') || normalizedTarget.includes('opus')) {
      return (
        formatName.includes('ogg') &&
        codecName === 'opus' &&
        channels === 1 &&
        sampleRate === 48000
      );
    }

    if (normalizedTarget.includes('mp3') || normalizedTarget.includes('mpeg')) {
      return formatName.includes('mp3') && codecName === 'mp3';
    }

    return false;
  }
}
