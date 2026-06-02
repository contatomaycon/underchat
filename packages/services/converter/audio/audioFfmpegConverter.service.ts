import { injectable, inject } from 'tsyringe';
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

type AudioProbeSummary = NonNullable<IConvertAudioResult['probe']>;

@injectable()
export class AudioFfmpegConverter {
  constructor(
    @inject(AudioProbeService)
    private readonly audioProbeService: AudioProbeService
  ) {}

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
      await this.validateInputFile(inputPath, currentFormat);

      await this.runConversion(inputPath, outputPath, ptt);
      const { duration, probe } = await this.validateOutputFile(
        outputPath,
        ptt
      );
      const outputBuffer = await readFile(outputPath);

      return {
        buffer: outputBuffer,
        mimetype: config.mimetype,
        extension: config.extension,
        duration,
        probe,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes('Invalid data found') ||
        errorMessage.includes('code 1') ||
        errorMessage.includes('codec not found')
      ) {
        throw new Error(
          `Arquivo de áudio inválido ou corrompido: ${errorMessage}`
        );
      }

      throw error;
    } finally {
      await FileUtils.safeUnlink(inputPath);
      await FileUtils.safeUnlink(outputPath);
    }
  }

  private getFormatConfig(ptt: boolean): IAudioFormatConfig {
    if (ptt) {
      return {
        format: 'ogg',
        mimetype: 'audio/ogg; codecs=opus',
        extension: 'ogg',
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
      let stderrOutput = '';

      const command = ffmpeg(inputPath).noVideo();

      if (ptt) {
        this.configurePttCommand(command);
      }

      if (!ptt) {
        this.configureRegularAudioCommand(command);
      }

      command
        .output(outputPath)
        .on('start', () => {
          stderrOutput = '';
        })
        .on('stderr', (stderrLine) => {
          stderrOutput += stderrLine + '\n';
        })
        .on('end', () => resolve())
        .on('error', (err) => {
          const errorMessage = err.message || String(err);

          if (
            errorMessage.includes('code 1') ||
            errorMessage.includes('Invalid data') ||
            stderrOutput.includes('Invalid data') ||
            stderrOutput.includes('codec not found')
          ) {
            reject(
              new Error(
                `Falha ao processar arquivo de áudio: ${errorMessage}. ` +
                  `Detalhes: ${stderrOutput.slice(0, 200)}`
              )
            );
            return;
          }

          reject(err);
        })
        .run();
    });
  }

  private configurePttCommand(command: ReturnType<typeof ffmpeg>): void {
    command
      .noVideo()
      .audioCodec('libopus')
      .format('ogg')
      .audioFrequency(48000)
      .audioChannels(1)
      .audioBitrate('32k')
      .audioFilters('aresample=async=1:first_pts=0')
      .outputOptions([
        '-map',
        '0:a:0',
        '-application',
        'voip',
        '-frame_duration',
        '20',
        '-vbr',
        'on',
        '-compression_level',
        '10',
        '-packet_loss',
        '0',
        '-map_metadata',
        '-1',
        '-fflags',
        '+genpts',
        '-avoid_negative_ts',
        'make_zero',
        '-muxdelay',
        '0',
        '-muxpreload',
        '0',
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
      .audioBitrate('128k')
      .audioFilters('aresample=async=1:first_pts=0')
      .outputOptions(['-map', '0:a:0', '-map_metadata', '-1']);
  }

  private async validateInputFile(
    inputPath: string,
    expectedFormat: string
  ): Promise<void> {
    try {
      await this.audioProbeService.probeDuration(inputPath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes('Invalid data') ||
        errorMessage.includes('code 1') ||
        errorMessage.includes('Invalid data found')
      ) {
        throw new Error(
          `Arquivo de áudio inválido ou corrompido. Formato esperado: ${expectedFormat}. ` +
            `O arquivo pode estar corrompido ou em um formato não suportado.`
        );
      }
    }
  }

  private async validateOutputFile(
    outputPath: string,
    ptt: boolean
  ): Promise<{ duration?: number; probe: AudioProbeSummary }> {
    const metadata = await this.audioProbeService.probeMetadata(outputPath);
    const duration = this.audioProbeService.extractDuration(metadata);
    const audioStream = Array.isArray(metadata?.streams)
      ? metadata.streams.find((stream: any) => stream?.codec_type === 'audio')
      : null;
    const probe = this.summarizeProbe(metadata, audioStream);

    if (!audioStream) {
      throw new Error('Arquivo de áudio convertido sem trilha de áudio.');
    }

    if (ptt) {
      this.validatePttOutput(metadata, audioStream);
      return { duration, probe };
    }

    this.validateRegularOutput(metadata, audioStream);
    return { duration, probe };
  }

  private validatePttOutput(metadata: any, audioStream: any): void {
    const formatName = String(
      metadata?.format?.format_name ?? ''
    ).toLowerCase();
    const codecName = String(audioStream?.codec_name ?? '').toLowerCase();
    const channels = Number(audioStream?.channels);
    const sampleRate = Number(audioStream?.sample_rate);
    const startTime = Number(audioStream?.start_time ?? 0);

    if (
      !formatName.includes('ogg') ||
      codecName !== 'opus' ||
      channels !== 1 ||
      sampleRate !== 48000 ||
      (Number.isFinite(startTime) && startTime < -0.05)
    ) {
      throw new Error(
        'Arquivo de áudio convertido fora do perfil de voz WhatsApp.'
      );
    }
  }

  private validateRegularOutput(metadata: any, audioStream: any): void {
    const formatName = String(
      metadata?.format?.format_name ?? ''
    ).toLowerCase();
    const codecName = String(audioStream?.codec_name ?? '').toLowerCase();

    if (!formatName.includes('mp3') || codecName !== 'mp3') {
      throw new Error('Arquivo de áudio convertido fora do perfil MP3.');
    }
  }

  private summarizeProbe(metadata: any, audioStream: any): AudioProbeSummary {
    const toNullableString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value : null;
    const toNullableNumber = (value: unknown): number | null => {
      const parsed =
        typeof value === 'number' ? value : Number.parseFloat(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      format_name: toNullableString(metadata?.format?.format_name),
      format_duration: toNullableString(metadata?.format?.duration),
      format_start_time: toNullableString(metadata?.format?.start_time),
      format_bit_rate: toNullableString(metadata?.format?.bit_rate),
      codec_name: toNullableString(audioStream?.codec_name),
      channels: toNullableNumber(audioStream?.channels),
      sample_rate: toNullableNumber(audioStream?.sample_rate),
      stream_duration: toNullableString(audioStream?.duration),
      stream_start_time: toNullableString(audioStream?.start_time),
      stream_bit_rate: toNullableString(audioStream?.bit_rate),
    };
  }
}
