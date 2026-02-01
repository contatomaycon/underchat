import { injectable } from 'tsyringe';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { ViewVoiceIaResponse } from '@core/schema/voiceIa/viewVoiceIa/response.schema';
import {
  IVoiceIaGenerateSpeechAndUploadResult,
  IVoiceIaGenerateSpeechResult,
  IVoiceIaTranscribeResult,
} from '@core/common/interfaces/IVoiceIaIntegration';
import { StorageService } from './storage.service';

@injectable()
export class VoiceIaIntegrationService {
  constructor(private readonly storageService: StorageService) {}

  private readonly ELEVENLABS_TTS_URL =
    'https://api.elevenlabs.io/v1/text-to-speech';
  private readonly ELEVENLABS_STT_URL =
    'https://api.elevenlabs.io/v1/speech-to-text';

  async generateSpeech(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    if (config.voice_ia_type === EVoiceIaType.eleven_labs) {
      return this.generateSpeechElevenLabs(text, config);
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
    const filename = `voice-ia-${Date.now()}.${speechResult.extension}`;
    const uploadResult = await this.storageService.uploadAudioFromBuffer(
      speechResult.buffer,
      filename,
      speechResult.mimetype,
      accountId
    );
    if (!uploadResult?.url) {
      return null;
    }
    return {
      url: uploadResult.url,
      mimetype: speechResult.mimetype,
    };
  }

  async transcribe(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaTranscribeResult | null> {
    if (config.voice_ia_type === EVoiceIaType.eleven_labs) {
      return this.transcribeElevenLabs(audioBuffer, config);
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
      language_code: config.language_code || 'pt-BR',
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

  private buildBlobFromBuffer(buffer: Buffer): Blob {
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(buffer);
    return new Blob([arrayBuffer], { type: 'audio/mpeg' });
  }

  private async transcribeElevenLabs(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaTranscribeResult | null> {
    const apiKey = config.api_key;
    if (!apiKey) {
      return null;
    }

    const formData = new FormData();
    const blob = this.buildBlobFromBuffer(audioBuffer);
    formData.append('file', blob, 'audio.mp3');
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
}
