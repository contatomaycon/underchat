import { injectable, inject } from 'tsyringe';
import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { IConvertVideoResult } from '@core/common/interfaces/IConvertVideoResult';
import { VideoProbeService } from './videoProbe.service';
import { FileUtils } from '../audio/fileUtils.service';

@injectable()
export class VideoFfmpegConverter {
  constructor(
    @inject(VideoProbeService)
    private readonly videoProbeService: VideoProbeService
  ) {}

  async convert(
    inputBuffer: Buffer,
    currentFormat: string
  ): Promise<IConvertVideoResult> {
    const inputRandomId = randomBytes(8).toString('hex');
    const outputRandomId = randomBytes(8).toString('hex');

    const inputPath = join(
      tmpdir(),
      `video-input-${Date.now()}-${inputRandomId}.${currentFormat}`
    );

    const outputPath = join(
      tmpdir(),
      `video-output-${Date.now()}-${outputRandomId}.mp4`
    );

    try {
      await writeFile(inputPath, inputBuffer);
      await this.runConversion(inputPath, outputPath);
      const outputBuffer = await readFile(outputPath);

      const probeData = await this.videoProbeService.probeMetadata(outputPath);
      const duration = this.videoProbeService.extractDuration(probeData);
      const dimensions = this.videoProbeService.extractDimensions(probeData);

      return {
        buffer: outputBuffer,
        mimetype: 'video/mp4',
        extension: 'mp4',
        duration,
        width: dimensions.width,
        height: dimensions.height,
      };
    } finally {
      await FileUtils.safeUnlink(inputPath);
      await FileUtils.safeUnlink(outputPath);
    }
  }

  private async runConversion(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .outputOptions([
          '-preset fast',
          '-crf 23',
          '-movflags +faststart',
          '-pix_fmt yuv420p',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }
}
