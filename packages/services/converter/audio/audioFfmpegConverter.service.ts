import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { IConvertAudioResult } from '@core/common/interfaces/IConvertAudioResult';
import { IAudioFormatConfig } from '@core/common/interfaces/IAudioFormatConfig';
import { AudioProbeService } from './audioProbe.service';
import { FileUtils } from './fileUtils.service';

export class AudioFfmpegConverter {
  async convert(
    inputBuffer: Buffer,
    currentFormat: string,
    ptt: boolean
  ): Promise<IConvertAudioResult> {
    const config = this.getFormatConfig(ptt);

    const inputRandomId = randomBytes(8).toString('hex');
    const outputRandomId = randomBytes(8).toString('hex');

    const inputPath = join(
      tmpdir(),
      `audio-input-${Date.now()}-${inputRandomId}.${currentFormat}`
    );

    const outputPath = join(
      tmpdir(),
      `audio-output-${Date.now()}-${outputRandomId}.${config.extension}`
    );

    try {
      await writeFile(inputPath, inputBuffer);
      await this.runConversion(inputPath, outputPath, ptt);
      const outputBuffer = await readFile(outputPath);

      const probeService = new AudioProbeService();
      const duration = await probeService.probeDuration(outputPath);

      return {
        buffer: outputBuffer,
        mimetype: config.mimetype,
        extension: config.extension,
        duration,
      };
    } finally {
      await FileUtils.safeUnlink(inputPath);
      await FileUtils.safeUnlink(outputPath);
    }
  }

  private getFormatConfig(ptt: boolean): IAudioFormatConfig {
    if (ptt) {
      return {
        format: 'opus',
        mimetype: 'audio/ogg; codecs=opus',
        extension: 'opus',
      };
    }
    return {
      format: 'mp3',
      mimetype: 'audio/mpeg',
      extension: 'mp3',
    };
  }

  private async runConversion(
    inputPath: string,
    outputPath: string,
    ptt: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath).noVideo();

      if (ptt) {
        this.configurePttCommand(command);
      }

      if (!ptt) {
        this.configureRegularAudioCommand(command);
      }

      command
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }

  private configurePttCommand(command: ReturnType<typeof ffmpeg>): void {
    command
      .audioCodec('libopus')
      .format('ogg')
      .audioBitrate('48k')
      .audioChannels(1)
      .audioFrequency(48000)
      .outputOptions([
        '-application voip',
        '-frame_duration 60',
        '-packet_loss 0',
        '-compression_level 10',
        '-metadata comment=WhatsApp',
      ]);
  }

  private configureRegularAudioCommand(
    command: ReturnType<typeof ffmpeg>
  ): void {
    command
      .audioCodec('libmp3lame')
      .format('mp3')
      .audioFrequency(44100)
      .audioChannels(2)
      .audioBitrate('128k');
  }
}
