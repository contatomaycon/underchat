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
  private readonly GEMINI_BASE_URL =
    'https://generativelanguage.googleapis.com/v1beta';

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
    if (config.voice_ia_type === EVoiceIaType.gemini) {
      return this.generateSpeechGemini(text, config);
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
    if (config.voice_ia_type === EVoiceIaType.gemini) {
      return this.transcribeGemini(audioBuffer, config, mimetype);
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

  private buildWavHeader(dataLength: number, sampleRate = 24000): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }

  private async generateSpeechGemini(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    const apiKey = config.api_key;
    if (!apiKey) {
      return null;
    }

    const model = config.model_id || 'gemini-2.5-flash-preview-tts';
    const voiceName = config.voice_id || 'Kore';
    const url = `${this.GEMINI_BASE_URL}/models/${model}:generateContent`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text }],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        return null;
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ inlineData?: { data?: string } }>;
          };
        }>;
      };
      const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!b64) {
        return null;
      }

      const pcm = Buffer.from(b64, 'base64');
      const wavHeader = this.buildWavHeader(pcm.length);
      const buffer = Buffer.concat([wavHeader, pcm]);

      return {
        buffer,
        mimetype: 'audio/wav',
        extension: 'wav',
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

  private async transcribeGemini(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse,
    mimetype = 'audio/mpeg'
  ): Promise<IVoiceIaTranscribeResult | null> {
    const apiKey = config.api_key;
    if (!apiKey) {
      return null;
    }

    let geminiMimetype = 'audio/mp3';
    if (mimetype.includes('wav')) {
      geminiMimetype = 'audio/wav';
    } else if (mimetype.includes('ogg') || mimetype.includes('opus')) {
      geminiMimetype = 'audio/ogg';
    }
    const base64Audio = audioBuffer.toString('base64');
    const url = `${this.GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Transcribe the speech in this audio. Return only the transcribed text, nothing else.',
                },
                {
                  inlineData: {
                    mimeType: geminiMimetype,
                    data: base64Audio,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        return null;
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };
      const text =
        json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

      return { text };
    } catch {
      return null;
    }
  }
}
