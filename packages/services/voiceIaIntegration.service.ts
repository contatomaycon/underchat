import { injectable } from 'tsyringe';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { ViewVoiceIaResponse } from '@core/schema/voiceIa/viewVoiceIa/response.schema';
import {
  IVoiceIaGenerateSpeechAndUploadResult,
  IVoiceIaGenerateSpeechResult,
  IVoiceIaTranscribeResult,
} from '@core/common/interfaces/IVoiceIaIntegration';
import { StorageService } from './storage.service';
import { ConverterService } from './converter';

@injectable()
export class VoiceIaIntegrationService {
  constructor(
    private readonly storageService: StorageService,
    private readonly converterService: ConverterService
  ) {}

  private readonly ELEVENLABS_TTS_URL =
    'https://api.elevenlabs.io/v1/text-to-speech';
  private readonly ELEVENLABS_STT_URL =
    'https://api.elevenlabs.io/v1/speech-to-text';
  private readonly OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
  private readonly OPENAI_TRANSCRIPTIONS_URL =
    'https://api.openai.com/v1/audio/transcriptions';

  async generateSpeech(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    if (config.voice_ia_type === EVoiceIaType.eleven_labs) {
      return this.generateSpeechElevenLabs(text, config);
    }
    if (config.voice_ia_type === EVoiceIaType.gpt) {
      return this.generateSpeechGpt(text, config);
    }
    return null;
  }

  async generateSpeechAndUpload(
    text: string,
    config: ViewVoiceIaResponse,
    accountId: string
  ): Promise<IVoiceIaGenerateSpeechAndUploadResult | null> {
    const speechResult = await this.generateSpeech(text, config);
    if (!speechResult) {
      return null;
    }
    const converted = await this.converterService.convertAudio(
      speechResult.buffer,
      speechResult.mimetype,
      true
    );
    const filename = `voice-ia-${Date.now()}.${converted.extension}`;
    const uploadResult = await this.storageService.uploadAudioFromBuffer(
      converted.buffer,
      filename,
      converted.mimetype,
      accountId
    );
    if (!uploadResult?.url) {
      return null;
    }
    return {
      url: uploadResult.url,
      mimetype: converted.mimetype,
    };
  }

  async transcribe(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse,
    mimetype?: string
  ): Promise<IVoiceIaTranscribeResult | null> {
    if (config.voice_ia_type === EVoiceIaType.eleven_labs) {
      return this.transcribeElevenLabs(audioBuffer, config, mimetype);
    }
    if (config.voice_ia_type === EVoiceIaType.gpt) {
      return this.transcribeGpt(audioBuffer, config, mimetype);
    }
    return null;
  }

  private async generateSpeechElevenLabs(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    const apiKey = config.api_key;
    if (!apiKey) {
      return null;
    }

    const url = `${this.ELEVENLABS_TTS_URL}/${config.voice_id}`;
    const stability = parseFloat(config.stability) || 0.5;
    const similarityBoost = parseFloat(config.similarity_boost) || 0.75;
    const style = parseFloat(config.style_exaggeration) || 0;

    const body = {
      text,
      model_id: config.model_id || 'eleven_multilingual_v2',
      language_code:
        config.language_code === 'pt-BR' ? 'pt' : config.language_code || 'pt',
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        style,
        use_speaker_boost: true,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return {
        buffer,
        mimetype: 'audio/mpeg',
        extension: 'mp3',
      };
    } catch {
      return null;
    }
  }

  private async generateSpeechGpt(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    const apiKey = config.api_key;
    if (!apiKey) {
      return null;
    }

    const model = config.model_id || 'tts-1';
    const voice = config.voice_id || 'alloy';

    try {
      const response = await fetch(this.OPENAI_SPEECH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice,
          input: text,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return {
        buffer,
        mimetype: 'audio/mpeg',
        extension: 'mp3',
      };
    } catch {
      return null;
    }
  }

  private buildBlobFromBuffer(buffer: Buffer, mimetype = 'audio/mpeg'): Blob {
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(buffer);
    return new Blob([arrayBuffer], { type: mimetype });
  }

  private getAudioExtensionFromMimetype(mimetype: string): string {
    if (mimetype.includes('ogg') || mimetype.includes('opus')) return 'ogg';
    if (mimetype.includes('mp3') || mimetype.includes('mpeg')) return 'mp3';
    if (mimetype.includes('webm')) return 'webm';
    return 'mp3';
  }

  private async transcribeElevenLabs(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse,
    mimetype = 'audio/mpeg'
  ): Promise<IVoiceIaTranscribeResult | null> {
    const apiKey = config.api_key;
    if (!apiKey) {
      return null;
    }

    const extension = this.getAudioExtensionFromMimetype(mimetype);
    const formData = new FormData();
    const blob = this.buildBlobFromBuffer(audioBuffer, mimetype);
    formData.append('file', blob, `audio.${extension}`);
    formData.append('model_id', 'scribe_v1');

    try {
      const response = await fetch(this.ELEVENLABS_STT_URL, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { text?: string };
      const text = data?.text?.trim() ?? '';

      return { text };
    } catch {
      return null;
    }
  }

  private async transcribeGpt(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse,
    mimetype = 'audio/mpeg'
  ): Promise<IVoiceIaTranscribeResult | null> {
    const apiKey = config.api_key;
    if (!apiKey) {
      return null;
    }

    const extension = this.getAudioExtensionFromMimetype(mimetype);
    const formData = new FormData();
    const blob = this.buildBlobFromBuffer(audioBuffer, mimetype);
    formData.append('file', blob, `audio.${extension}`);
    formData.append('model', 'whisper-1');

    try {
      const response = await fetch(this.OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { text?: string };
      const text = data?.text?.trim() ?? '';

      return { text };
    } catch {
      return null;
    }
  }
}
