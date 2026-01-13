import { injectable } from 'tsyringe';
import { Buffer } from 'node:buffer';
import { IConvertAudioResult } from '@core/common/interfaces/IConvertAudioResult';
import { IConvertVideoResult } from '@core/common/interfaces/IConvertVideoResult';
import { AudioFormatDetector } from './audio/audioFormatDetector.service';
import { AudioFormatValidator } from './audio/audioFormatValidator.service';
import { AudioFfmpegConverter } from './audio/audioFfmpegConverter.service';
import { AudioWaveformGenerator } from './audio/audioWaveformGenerator.service';
import { VideoFormatDetector } from './video/videoFormatDetector.service';
import { VideoFormatValidator } from './video/videoFormatValidator.service';
import { VideoFfmpegConverter } from './video/videoFfmpegConverter.service';

@injectable()
export class ConverterService {
  constructor(
    private readonly audioFormatDetector: AudioFormatDetector,
    private readonly audioFormatValidator: AudioFormatValidator,
    private readonly audioFfmpegConverter: AudioFfmpegConverter,
    private readonly audioWaveformGenerator: AudioWaveformGenerator,
    private readonly videoFormatDetector: VideoFormatDetector,
    private readonly videoFormatValidator: VideoFormatValidator,
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

    return this.audioFfmpegConverter.convert(inputBuffer, currentFormat, ptt);
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
        return result;
      }
    }

    return this.videoFfmpegConverter.convert(inputBuffer, currentFormat);
  }
}
