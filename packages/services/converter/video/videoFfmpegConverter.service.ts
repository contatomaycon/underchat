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

type VideoProbeSummary = NonNullable<IConvertVideoResult['probe']>;

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

      const probeData = await this.videoProbeService.probeMetadata(outputPath);
      this.validateOutputFile(probeData);
      const duration = this.videoProbeService.extractDuration(probeData);
      const dimensions = this.videoProbeService.extractDimensions(probeData);
      const probe = this.summarizeProbe(probeData);
      const outputBuffer = await readFile(outputPath);

      return {
        buffer: outputBuffer,
        mimetype: 'video/mp4',
        extension: 'mp4',
        duration,
        width: dimensions.width,
        height: dimensions.height,
        probe,
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
        .audioFrequency(44100)
        .audioChannels(2)
        .audioBitrate('128k')
        .format('mp4')
        .outputOptions([
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-movflags',
          '+faststart',
          '-pix_fmt',
          'yuv420p',
          '-vf',
          'scale=trunc(iw/2)*2:trunc(ih/2)*2,setpts=PTS-STARTPTS',
          '-af',
          'aresample=async=1:first_pts=0',
          '-map_metadata',
          '-1',
          '-fflags',
          '+genpts',
          '-avoid_negative_ts',
          'make_zero',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }

  private validateOutputFile(probeData: any): void {
    const streams = Array.isArray(probeData?.streams) ? probeData.streams : [];
    const videoStream = streams.find(
      (stream: any) => stream?.codec_type === 'video'
    );

    if (!videoStream) {
      throw new Error('Arquivo de vídeo convertido sem trilha de vídeo.');
    }

    const formatName = String(
      probeData?.format?.format_name ?? ''
    ).toLowerCase();
    const videoCodec = String(videoStream?.codec_name ?? '').toLowerCase();
    const width = Number(videoStream?.width);
    const height = Number(videoStream?.height);
    const pixFmt = String(videoStream?.pix_fmt ?? '').toLowerCase();
    const videoStartTime = Number(videoStream?.start_time ?? 0);
    const hasValidDimensions =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      width % 2 === 0 &&
      height % 2 === 0;
    const hasCompatibleAudio = streams
      .filter((stream: any) => stream?.codec_type === 'audio')
      .every(
        (stream: any) =>
          String(stream?.codec_name ?? '').toLowerCase() === 'aac'
      );

    if (
      !formatName.includes('mp4') ||
      (videoCodec !== 'h264' && videoCodec !== 'avc1') ||
      pixFmt !== 'yuv420p' ||
      !hasValidDimensions ||
      (Number.isFinite(videoStartTime) && videoStartTime < -0.05) ||
      !hasCompatibleAudio
    ) {
      throw new Error(
        'Arquivo de vídeo convertido fora do perfil WhatsApp MP4/H.264/AAC.'
      );
    }
  }

  private summarizeProbe(probeData: any): VideoProbeSummary {
    const streams = Array.isArray(probeData?.streams) ? probeData.streams : [];
    const videoStream = streams.find(
      (stream: any) => stream?.codec_type === 'video'
    );
    const audioStream = streams.find(
      (stream: any) => stream?.codec_type === 'audio'
    );
    const toNullableString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value : null;
    const toNullableNumber = (value: unknown): number | null => {
      const parsed =
        typeof value === 'number' ? value : Number.parseFloat(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      format_name: toNullableString(probeData?.format?.format_name),
      format_duration: toNullableString(probeData?.format?.duration),
      format_start_time: toNullableString(probeData?.format?.start_time),
      format_bit_rate: toNullableString(probeData?.format?.bit_rate),
      video_codec_name: toNullableString(videoStream?.codec_name),
      video_width: toNullableNumber(videoStream?.width),
      video_height: toNullableNumber(videoStream?.height),
      video_pix_fmt: toNullableString(videoStream?.pix_fmt),
      video_duration: toNullableString(videoStream?.duration),
      video_start_time: toNullableString(videoStream?.start_time),
      video_bit_rate: toNullableString(videoStream?.bit_rate),
      audio_codec_name: toNullableString(audioStream?.codec_name),
      audio_channels: toNullableNumber(audioStream?.channels),
      audio_sample_rate: toNullableNumber(audioStream?.sample_rate),
      audio_duration: toNullableString(audioStream?.duration),
      audio_start_time: toNullableString(audioStream?.start_time),
      audio_bit_rate: toNullableString(audioStream?.bit_rate),
    };
  }
}
