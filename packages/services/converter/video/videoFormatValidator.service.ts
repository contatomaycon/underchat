import { injectable } from 'tsyringe';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { IConvertVideoResult } from '@core/common/interfaces/IConvertVideoResult';
import { VideoProbeService } from './videoProbe.service';
import { FileUtils } from '../audio/fileUtils.service';

@injectable()
export class VideoFormatValidator {
  constructor(private readonly videoProbeService: VideoProbeService) {}

  async checkAndReturnIfValid(
    inputBuffer: Buffer
  ): Promise<IConvertVideoResult | null> {
    const tempPath = join(
      tmpdir(),
      `video-probe-${Date.now()}-${randomBytes(8).toString('hex')}.mp4`
    );

    try {
      await writeFile(tempPath, inputBuffer);

      const probeData = await this.videoProbeService.probeMetadata(tempPath);
      const duration = this.videoProbeService.extractDuration(probeData);
      const dimensions = this.videoProbeService.extractDimensions(probeData);
      const isValid = this.validateFormat(probeData);

      if (isValid) {
        await FileUtils.safeUnlink(tempPath);
        return {
          buffer: inputBuffer,
          mimetype: 'video/mp4',
          extension: 'mp4',
          duration,
          width: dimensions.width,
          height: dimensions.height,
        };
      }
    } catch {
    } finally {
      await FileUtils.safeUnlink(tempPath);
    }

    return null;
  }

  private validateFormat(probeData: any): boolean {
    const videoStream = probeData.streams?.find(
      (stream: any) => stream.codec_type === 'video'
    );

    if (!videoStream) {
      return false;
    }

    const codecName = videoStream.codec_name;
    const isH264 = codecName === 'h264' || codecName === 'avc1';
    const formatName = probeData.format?.format_name;

    return isH264 && formatName?.includes('mp4');
  }
}
