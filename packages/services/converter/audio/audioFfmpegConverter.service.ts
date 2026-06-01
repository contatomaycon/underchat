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
      const duration = await this.validateOutputFile(outputPath, ptt);
      const outputBuffer = await readFile(outputPath);

      return {
        buffer: outputBuffer,
        mimetype: config.mimetype,
        extension: config.extension,
        duration,
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
      .outputOptions([
        '-application',
        'voip',
        '-frame_duration',
        '20',
        '-avoid_negative_ts',
        'make_zero',
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
  ): Promise<number | undefined> {
    const metadata = await this.audioProbeService.probeMetadata(outputPath);
    const duration = this.audioProbeService.extractDuration(metadata);
    const audioStream = Array.isArray(metadata?.streams)
      ? metadata.streams.find((stream: any) => stream?.codec_type === 'audio')
      : null;

    if (!audioStream) {
      throw new Error('Arquivo de áudio convertido sem trilha de áudio.');
    }

    if (ptt) {
      this.validatePttOutput(metadata, audioStream);
      return duration;
    }

    this.validateRegularOutput(metadata, audioStream);
    return duration;
  }

  private validatePttOutput(metadata: any, audioStream: any): void {
    const formatName = String(
      metadata?.format?.format_name ?? ''
    ).toLowerCase();
    const codecName = String(audioStream?.codec_name ?? '').toLowerCase();
    const channels = Number(audioStream?.channels);
    const sampleRate = Number(audioStream?.sample_rate);

    if (
      !formatName.includes('ogg') ||
      codecName !== 'opus' ||
      channels !== 1 ||
      sampleRate !== 48000
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
}
