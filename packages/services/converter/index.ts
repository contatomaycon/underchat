import { injectable, inject } from 'tsyringe';
import { Buffer } from 'node:buffer';
import { IConvertAudioResult } from '@core/common/interfaces/IConvertAudioResult';
import { IConvertVideoResult } from '@core/common/interfaces/IConvertVideoResult';
import { AudioFormatDetector } from './audio/audioFormatDetector.service';
import { AudioFfmpegConverter } from './audio/audioFfmpegConverter.service';
import { AudioWaveformGenerator } from './audio/audioWaveformGenerator.service';
import { VideoFormatDetector } from './video/videoFormatDetector.service';
import { VideoFormatValidator } from './video/videoFormatValidator.service';
import { VideoFfmpegConverter } from './video/videoFfmpegConverter.service';

@injectable()
export class ConverterService {
  constructor(
    @inject(AudioFormatDetector)
    private readonly audioFormatDetector: AudioFormatDetector,
    @inject(AudioFfmpegConverter)
    private readonly audioFfmpegConverter: AudioFfmpegConverter,
    @inject(AudioWaveformGenerator)
    private readonly audioWaveformGenerator: AudioWaveformGenerator,
    @inject(VideoFormatDetector)
    private readonly videoFormatDetector: VideoFormatDetector,
    @inject(VideoFormatValidator)
    private readonly videoFormatValidator: VideoFormatValidator,
    @inject(VideoFfmpegConverter)
    private readonly videoFfmpegConverter: VideoFfmpegConverter
  ) {}

  async convertAudio(
    inputBuffer: Buffer,
    inputMimetype?: string | null,
    ptt: boolean = true
  ): Promise<IConvertAudioResult> {
    const detectedFromBuffer =
      this.audioFormatDetector.detectFromBuffer(inputBuffer);
    const detectedFromMimetype =
      this.audioFormatDetector.getExtensionFromMimetype(inputMimetype);

    const currentFormat = detectedFromBuffer || detectedFromMimetype || 'webm';

    this.logConversionDebug('audio_detected', {
      input_size: inputBuffer.byteLength,
      input_mimetype: inputMimetype ?? null,
      detected_from_buffer: detectedFromBuffer || null,
      detected_from_mimetype: detectedFromMimetype || null,
      selected_format: currentFormat,
      ptt,
    });

    try {
      const converted = await this.audioFfmpegConverter.convert(
        inputBuffer,
        currentFormat,
        ptt
      );

      this.logConversionDebug('audio_converted', {
        input_size: inputBuffer.byteLength,
        output_size: this.bufferSize(converted.buffer),
        output_mimetype: converted.mimetype,
        output_extension: converted.extension,
        duration: converted.duration ?? null,
        ptt,
      });

      return converted;
    } catch (error) {
      this.logConversionDebug(
        'audio_conversion_failed',
        {
          input_size: inputBuffer.byteLength,
          input_mimetype: inputMimetype ?? null,
          selected_format: currentFormat,
          ptt,
          error: error instanceof Error ? error.message : String(error),
        },
        'warn'
      );
      throw error;
    }
  }

  async generateWaveformWithFfmpeg(
    audioBuffer: Buffer
  ): Promise<string | undefined> {
    return this.audioWaveformGenerator.generate(audioBuffer);
  }

  async convertVideo(
    inputBuffer: Buffer,
    inputMimetype?: string | null
  ): Promise<IConvertVideoResult> {
    const currentFormat =
      this.videoFormatDetector.detectFromBuffer(inputBuffer) ||
      this.videoFormatDetector.getExtensionFromMimetype(inputMimetype) ||
      'mp4';

    if (currentFormat === 'mp4') {
      const result =
        await this.videoFormatValidator.checkAndReturnIfValid(inputBuffer);
      if (result) {
        this.logConversionDebug('video_reused', {
          input_size: inputBuffer.byteLength,
          input_mimetype: inputMimetype ?? null,
          selected_format: currentFormat,
          output_mimetype: result.mimetype,
          output_extension: result.extension,
          duration: result.duration ?? null,
          width: result.width ?? null,
          height: result.height ?? null,
        });
        return result;
      }
    }

    this.logConversionDebug('video_conversion_required', {
      input_size: inputBuffer.byteLength,
      input_mimetype: inputMimetype ?? null,
      selected_format: currentFormat,
    });

    try {
      const converted = await this.videoFfmpegConverter.convert(
        inputBuffer,
        currentFormat
      );

      this.logConversionDebug('video_converted', {
        input_size: inputBuffer.byteLength,
        output_size: this.bufferSize(converted.buffer),
        output_mimetype: converted.mimetype,
        output_extension: converted.extension,
        duration: converted.duration ?? null,
        width: converted.width ?? null,
        height: converted.height ?? null,
      });

      return converted;
    } catch (error) {
      this.logConversionDebug(
        'video_conversion_failed',
        {
          input_size: inputBuffer.byteLength,
          input_mimetype: inputMimetype ?? null,
          selected_format: currentFormat,
          error: error instanceof Error ? error.message : String(error),
        },
        'warn'
      );
      throw error;
    }
  }

  private logConversionDebug(
    event: string,
    details: Record<string, unknown>,
    level: 'info' | 'warn' = 'info'
  ): void {
    const payload = {
      event,
      ...details,
    };

    if (level === 'warn') {
      console.warn('[MediaConversionDebug]', payload);
      return;
    }

    console.info('[MediaConversionDebug]', payload);
  }

  private bufferSize(value: unknown): number | null {
    return Buffer.isBuffer(value) ? value.byteLength : null;
  }
}
