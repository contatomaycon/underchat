import { injectable } from 'tsyringe';
import { Buffer } from 'node:buffer';
import { IConvertAudioResult } from '@core/common/interfaces/IConvertAudioResult';
import { IAudioFormatConfig } from '@core/common/interfaces/IAudioFormatConfig';
import { AudioFormatDetector } from './audio/audioFormatDetector.service';
import { AudioFormatValidator } from './audio/audioFormatValidator.service';
import { AudioFfmpegConverter } from './audio/audioFfmpegConverter.service';
import { AudioWaveformGenerator } from './audio/audioWaveformGenerator.service';

@injectable()
export class ConverterService {
  async convertAudio(
    inputBuffer: Buffer,
    inputMimetype?: string | null,
    ptt: boolean = true
  ): Promise<IConvertAudioResult> {
    const config = this.getFormatConfig(ptt);
    const formatDetector = new AudioFormatDetector();
    const currentFormat =
      formatDetector.detectFromBuffer(inputBuffer) ||
      formatDetector.getExtensionFromMimetype(inputMimetype) ||
      'webm';

    if (ptt && currentFormat === config.format) {
      const validator = new AudioFormatValidator();
      const result = await validator.checkAndReturnIfValid(
        inputBuffer,
        config.mimetype,
        config.format
      );
      if (result) {
        return result;
      }
    }

    const converter = new AudioFfmpegConverter();
    return converter.convert(inputBuffer, currentFormat, ptt);
  }

  async generateWaveformWithFfmpeg(
    audioBuffer: Buffer
  ): Promise<string | undefined> {
    const generator = new AudioWaveformGenerator();
    return generator.generate(audioBuffer);
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
}
