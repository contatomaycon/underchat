import { injectable, inject } from 'tsyringe';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { resolveVoiceIaModel } from '@core/common/functions/voiceIaProviderConfiguration';
import { ViewVoiceIaResponse } from '@core/schema/voiceIa/viewVoiceIa/response.schema';
import {
  IVoiceIaGenerateSpeechAndUploadResult,
  IVoiceIaGenerateSpeechResult,
  IVoiceIaTranscribeResult,
} from '@core/common/interfaces/IVoiceIaIntegration';
import { StorageService } from './storage.service';
import { ConverterService } from './converter';

type VoiceIaOperation = 'speech_generation' | 'transcription';
type VoiceIaProviderName = EVoiceIaType | 'unknown';

interface IVoiceIaProviderRequest {
  provider: EVoiceIaType;
  operation: VoiceIaOperation;
  voiceIaId: string;
  url: string;
  init: RequestInit;
}

interface IVoiceIaProviderFailure {
  httpStatus: number | null;
  code: string;
  attempt: number;
  retryable: boolean;
  willRetry: boolean;
}

interface IGeminiAudioInput {
  buffer: Buffer;
  mimeType: string;
}

interface IGeminiInlineAudio {
  data?: string;
  mimeType?: string;
}

interface IGeminiSpeechResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: IGeminiInlineAudio;
      }>;
    };
  }>;
}

interface IGeminiTranscriptionResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

@injectable()
export class VoiceIaIntegrationService {
  constructor(
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(ConverterService)
    private readonly converterService: ConverterService
  ) {}

  private readonly elevenLabsTtsUrl =
    'https://api.elevenlabs.io/v1/text-to-speech';
  private readonly elevenLabsSttUrl =
    'https://api.elevenlabs.io/v1/speech-to-text';
  private readonly openAiSpeechUrl = 'https://api.openai.com/v1/audio/speech';
  private readonly openAiTranscriptionsUrl =
    'https://api.openai.com/v1/audio/transcriptions';
  private readonly geminiBaseUrl =
    'https://generativelanguage.googleapis.com/v1beta';
  private readonly geminiTranscriptionModel = 'gemini-3.6-flash';
  private readonly providerRequestMaxAttempts = 3;
  private readonly providerRequestTimeoutMs = 30_000;
  private readonly retryBaseDelayMs = 500;
  private readonly retryMaxDelayMs = 5_000;
  private readonly geminiMaxInlineRequestBytes = 20 * 1024 * 1024;

  private parseNumber(
    value: string | null | undefined,
    fallback: number
  ): number {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async generateSpeech(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    const provider = this.resolveUsableProvider(config, 'speech_generation');
    if (!provider || text.trim().length === 0) {
      return null;
    }

    if (provider === EVoiceIaType.eleven_labs) {
      return this.generateSpeechElevenLabs(text, config);
    }
    if (provider === EVoiceIaType.gpt) {
      return this.generateSpeechGpt(text, config);
    }
    if (provider === EVoiceIaType.gemini) {
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
    const provider = this.resolveUsableProvider(config, 'transcription');
    if (!provider || audioBuffer.length === 0) {
      return null;
    }

    if (provider === EVoiceIaType.eleven_labs) {
      return this.transcribeElevenLabs(audioBuffer, config, mimetype);
    }
    if (provider === EVoiceIaType.gpt) {
      return this.transcribeGpt(audioBuffer, config, mimetype);
    }
    if (provider === EVoiceIaType.gemini) {
      return this.transcribeGemini(audioBuffer, config, mimetype);
    }

    return null;
  }

  private resolveUsableProvider(
    config: ViewVoiceIaResponse,
    operation: VoiceIaOperation
  ): EVoiceIaType | null {
    const provider = this.resolveProvider(config.voice_ia_type);
    if (!provider) {
      this.logLocalFailure('unknown', operation, 'UNSUPPORTED_PROVIDER');
      return null;
    }

    if (config.status !== EVoiceIaStatus.active) {
      this.logLocalFailure(provider, operation, 'INACTIVE_CONFIGURATION', true);
      return null;
    }

    if (!config.api_key?.trim()) {
      this.logLocalFailure(provider, operation, 'MISSING_API_KEY', true);
      return null;
    }

    return provider;
  }

  private resolveProvider(value: string): EVoiceIaType | null {
    if (value === EVoiceIaType.eleven_labs) {
      return EVoiceIaType.eleven_labs;
    }
    if (value === EVoiceIaType.gpt) {
      return EVoiceIaType.gpt;
    }
    if (value === EVoiceIaType.gemini) {
      return EVoiceIaType.gemini;
    }
    return null;
  }

  private async generateSpeechElevenLabs(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    const apiKey = config.api_key?.trim();
    if (!apiKey) {
      return null;
    }

    const url = `${this.elevenLabsTtsUrl}/${config.voice_id}`;
    const stability = this.parseNumber(config.stability, 0.5);
    const similarityBoost = this.parseNumber(config.similarity_boost, 0.75);
    const style = this.parseNumber(config.style_exaggeration, 0);
    const speed = this.parseNumber(config.speed, 1);

    const response = await this.requestProvider({
      provider: EVoiceIaType.eleven_labs,
      operation: 'speech_generation',
      voiceIaId: config.voice_ia_id,
      url,
      init: {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: resolveVoiceIaModel(
            EVoiceIaType.eleven_labs,
            config.model_id
          ),
          language_code:
            config.language_code === 'pt-BR'
              ? 'pt'
              : config.language_code || 'pt',
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            style,
            speed,
            use_speaker_boost: true,
          },
        }),
      },
    });

    if (!response) {
      return null;
    }

    return this.readBinaryAudioResponse(
      response,
      EVoiceIaType.eleven_labs,
      'audio/mpeg',
      'mp3'
    );
  }

  private async generateSpeechGpt(
    text: string,
    config: ViewVoiceIaResponse
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    const apiKey = config.api_key?.trim();
    if (!apiKey) {
      return null;
    }

    const response = await this.requestProvider({
      provider: EVoiceIaType.gpt,
      operation: 'speech_generation',
      voiceIaId: config.voice_ia_id,
      url: this.openAiSpeechUrl,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: resolveVoiceIaModel(EVoiceIaType.gpt, config.model_id),
          voice: config.voice_id || 'alloy',
          input: text,
        }),
      },
    });

    if (!response) {
      return null;
    }

    return this.readBinaryAudioResponse(
      response,
      EVoiceIaType.gpt,
      'audio/mpeg',
      'mp3'
    );
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
    const apiKey = config.api_key?.trim();
    if (!apiKey) {
      return null;
    }

    const model = resolveVoiceIaModel(EVoiceIaType.gemini, config.model_id);
    const voiceName = config.voice_id || 'Kore';
    const url = `${this.geminiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    const response = await this.requestProvider({
      provider: EVoiceIaType.gemini,
      operation: 'speech_generation',
      voiceIaId: config.voice_ia_id,
      url,
      init: {
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
      },
    });

    if (!response) {
      return null;
    }

    const json = await this.readJsonResponse<IGeminiSpeechResponse>(
      response,
      EVoiceIaType.gemini,
      'speech_generation'
    );
    if (!json) {
      return null;
    }

    const inlineAudio = this.findGeminiInlineAudio(json);
    if (!inlineAudio?.data) {
      this.logLocalFailure(
        EVoiceIaType.gemini,
        'speech_generation',
        'MISSING_AUDIO_DATA'
      );
      return null;
    }

    const audioBuffer = this.decodeBase64(inlineAudio.data);
    if (!audioBuffer) {
      this.logLocalFailure(
        EVoiceIaType.gemini,
        'speech_generation',
        'INVALID_AUDIO_BASE64'
      );
      return null;
    }

    if (this.isWavBuffer(audioBuffer)) {
      return {
        buffer: audioBuffer,
        mimetype: 'audio/wav',
        extension: 'wav',
      };
    }

    const normalizedResponseMimeType =
      inlineAudio.mimeType?.toLowerCase() ?? '';
    if (normalizedResponseMimeType.includes('audio/wav')) {
      this.logLocalFailure(
        EVoiceIaType.gemini,
        'speech_generation',
        'INVALID_WAV_RESPONSE'
      );
      return null;
    }

    if (
      normalizedResponseMimeType.includes('audio/mpeg') ||
      normalizedResponseMimeType.includes('audio/mp3')
    ) {
      if (!this.isMp3Buffer(audioBuffer)) {
        this.logLocalFailure(
          EVoiceIaType.gemini,
          'speech_generation',
          'INVALID_MP3_RESPONSE'
        );
        return null;
      }
      return {
        buffer: audioBuffer,
        mimetype: 'audio/mpeg',
        extension: 'mp3',
      };
    }

    if (
      normalizedResponseMimeType &&
      !normalizedResponseMimeType.includes('audio/l16') &&
      !normalizedResponseMimeType.includes('audio/pcm') &&
      !normalizedResponseMimeType.includes('audio/raw')
    ) {
      this.logLocalFailure(
        EVoiceIaType.gemini,
        'speech_generation',
        'UNSUPPORTED_AUDIO_RESPONSE'
      );
      return null;
    }

    const sampleRate = this.parseGeminiPcmSampleRate(inlineAudio.mimeType);
    const wavHeader = this.buildWavHeader(audioBuffer.length, sampleRate);

    return {
      buffer: Buffer.concat([wavHeader, audioBuffer]),
      mimetype: 'audio/wav',
      extension: 'wav',
    };
  }

  private decodeBase64(value: string): Buffer | null {
    const normalized = value.replace(/\s/g, '');
    if (
      !normalized ||
      normalized.length % 4 === 1 ||
      !/^[a-z0-9+/]*={0,2}$/i.test(normalized)
    ) {
      return null;
    }

    const buffer = Buffer.from(normalized, 'base64');
    const canonicalInput = normalized.replace(/=+$/, '');
    const canonicalOutput = buffer.toString('base64').replace(/=+$/, '');

    return buffer.length > 0 && canonicalInput === canonicalOutput
      ? buffer
      : null;
  }

  private findGeminiInlineAudio(
    response: IGeminiSpeechResponse
  ): IGeminiInlineAudio | null {
    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.inlineData?.data) {
          return part.inlineData;
        }
      }
    }
    return null;
  }

  private parseGeminiPcmSampleRate(mimeType?: string): number {
    const match = mimeType?.match(/(?:^|[;\s])rate=(\d+)(?:$|[;\s])/i);
    const parsed = Number.parseInt(match?.[1] ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= 8_000 && parsed <= 192_000) {
      return parsed;
    }
    return 24_000;
  }

  private isWavBuffer(buffer: Buffer): boolean {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
    );
  }

  private isMp3Buffer(buffer: Buffer): boolean {
    if (buffer.length < 3) {
      return false;
    }

    return (
      buffer.toString('ascii', 0, 3) === 'ID3' ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    );
  }

  private buildBlobFromBuffer(buffer: Buffer, mimetype = 'audio/mpeg'): Blob {
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(buffer);
    return new Blob([arrayBuffer], { type: mimetype });
  }

  private getAudioExtensionFromMimetype(mimetype: string): string {
    const normalizedMimetype = mimetype.toLowerCase();
    if (
      normalizedMimetype.includes('ogg') ||
      normalizedMimetype.includes('opus')
    ) {
      return 'ogg';
    }
    if (
      normalizedMimetype.includes('mp3') ||
      normalizedMimetype.includes('mpeg')
    ) {
      return 'mp3';
    }
    if (normalizedMimetype.includes('webm')) return 'webm';
    if (
      normalizedMimetype.includes('mp4') ||
      normalizedMimetype.includes('m4a')
    ) {
      return 'm4a';
    }
    if (normalizedMimetype.includes('aac')) return 'aac';
    if (normalizedMimetype.includes('wav')) return 'wav';
    if (normalizedMimetype.includes('aiff')) return 'aiff';
    if (normalizedMimetype.includes('flac')) return 'flac';
    if (normalizedMimetype.includes('amr')) return 'amr';
    return 'mp3';
  }

  private async transcribeElevenLabs(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse,
    mimetype = 'audio/mpeg'
  ): Promise<IVoiceIaTranscribeResult | null> {
    const apiKey = config.api_key?.trim();
    if (!apiKey) {
      return null;
    }

    const extension = this.getAudioExtensionFromMimetype(mimetype);
    const formData = new FormData();
    const blob = this.buildBlobFromBuffer(audioBuffer, mimetype);
    formData.append('file', blob, `audio.${extension}`);
    formData.append('model_id', 'scribe_v2');

    const response = await this.requestProvider({
      provider: EVoiceIaType.eleven_labs,
      operation: 'transcription',
      voiceIaId: config.voice_ia_id,
      url: this.elevenLabsSttUrl,
      init: {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
        },
        body: formData,
      },
    });

    if (!response) {
      return null;
    }

    const data = await this.readJsonResponse<{ text?: string }>(
      response,
      EVoiceIaType.eleven_labs,
      'transcription'
    );
    const text = data?.text?.trim() ?? '';
    if (!text) {
      this.logLocalFailure(
        EVoiceIaType.eleven_labs,
        'transcription',
        'MISSING_TRANSCRIPTION'
      );
      return null;
    }

    return { text };
  }

  private async transcribeGpt(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse,
    mimetype = 'audio/mpeg'
  ): Promise<IVoiceIaTranscribeResult | null> {
    const apiKey = config.api_key?.trim();
    if (!apiKey) {
      return null;
    }

    const extension = this.getAudioExtensionFromMimetype(mimetype);
    const formData = new FormData();
    const blob = this.buildBlobFromBuffer(audioBuffer, mimetype);
    formData.append('file', blob, `audio.${extension}`);
    formData.append('model', 'whisper-1');

    const response = await this.requestProvider({
      provider: EVoiceIaType.gpt,
      operation: 'transcription',
      voiceIaId: config.voice_ia_id,
      url: this.openAiTranscriptionsUrl,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      },
    });

    if (!response) {
      return null;
    }

    const data = await this.readJsonResponse<{ text?: string }>(
      response,
      EVoiceIaType.gpt,
      'transcription'
    );
    const text = data?.text?.trim() ?? '';
    if (!text) {
      this.logLocalFailure(
        EVoiceIaType.gpt,
        'transcription',
        'MISSING_TRANSCRIPTION'
      );
      return null;
    }

    return { text };
  }

  private async transcribeGemini(
    audioBuffer: Buffer,
    config: ViewVoiceIaResponse,
    mimetype = 'application/octet-stream'
  ): Promise<IVoiceIaTranscribeResult | null> {
    const apiKey = config.api_key?.trim();
    if (!apiKey) {
      return null;
    }

    const audioInput = await this.prepareGeminiAudioInput(
      audioBuffer,
      mimetype
    );
    if (!audioInput) {
      return null;
    }

    const inlineData = {
      mimeType: audioInput.mimeType,
      data: '',
    };
    const requestPayload = {
      contents: [
        {
          parts: [
            {
              text: 'Transcribe the speech in this audio. Return only the transcribed text, nothing else.',
            },
            {
              inlineData,
            },
          ],
        },
      ],
    };

    const base64Bytes = 4 * Math.ceil(audioInput.buffer.length / 3);
    const requestBytes =
      Buffer.byteLength(JSON.stringify(requestPayload), 'utf8') + base64Bytes;
    if (requestBytes > this.geminiMaxInlineRequestBytes) {
      this.logLocalFailure(
        EVoiceIaType.gemini,
        'transcription',
        'INLINE_REQUEST_TOO_LARGE',
        false,
        {
          request_bytes: requestBytes,
          limit_bytes: this.geminiMaxInlineRequestBytes,
        }
      );
      return null;
    }

    inlineData.data = audioInput.buffer.toString('base64');
    const requestBody = JSON.stringify(requestPayload);
    const url = `${this.geminiBaseUrl}/models/${this.geminiTranscriptionModel}:generateContent`;
    const response = await this.requestProvider({
      provider: EVoiceIaType.gemini,
      operation: 'transcription',
      voiceIaId: config.voice_ia_id,
      url,
      init: {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      },
    });

    if (!response) {
      return null;
    }

    const json = await this.readJsonResponse<IGeminiTranscriptionResponse>(
      response,
      EVoiceIaType.gemini,
      'transcription'
    );
    if (!json) {
      return null;
    }

    for (const candidate of json.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const text = part.text?.trim();
        if (text) {
          return { text };
        }
      }
    }

    this.logLocalFailure(
      EVoiceIaType.gemini,
      'transcription',
      'MISSING_TRANSCRIPTION'
    );
    return null;
  }

  private async prepareGeminiAudioInput(
    audioBuffer: Buffer,
    mimetype: string
  ): Promise<IGeminiAudioInput | null> {
    const supportedMimeType = this.getGeminiSupportedAudioMimeType(mimetype);
    if (supportedMimeType) {
      return {
        buffer: audioBuffer,
        mimeType: supportedMimeType,
      };
    }

    try {
      const converted = await this.converterService.convertAudio(
        audioBuffer,
        mimetype,
        false
      );
      const convertedMimeType = this.getGeminiSupportedAudioMimeType(
        converted.mimetype
      );
      if (!convertedMimeType || converted.buffer.length === 0) {
        this.logLocalFailure(
          EVoiceIaType.gemini,
          'transcription',
          'UNSUPPORTED_AUDIO_AFTER_CONVERSION'
        );
        return null;
      }

      return {
        buffer: converted.buffer,
        mimeType: convertedMimeType,
      };
    } catch {
      this.logLocalFailure(
        EVoiceIaType.gemini,
        'transcription',
        'AUDIO_NORMALIZATION_FAILED'
      );
      return null;
    }
  }

  private getGeminiSupportedAudioMimeType(mimetype: string): string | null {
    const normalizedMimeType = mimetype.trim().toLowerCase();
    const baseMimeType = normalizedMimeType.split(';', 1)[0]?.trim();

    if (baseMimeType === 'audio/mpeg' || baseMimeType === 'audio/mp3') {
      return 'audio/mp3';
    }
    if (
      baseMimeType === 'audio/wav' ||
      baseMimeType === 'audio/x-wav' ||
      baseMimeType === 'audio/wave'
    ) {
      return 'audio/wav';
    }
    if (baseMimeType === 'audio/aiff' || baseMimeType === 'audio/x-aiff') {
      return 'audio/aiff';
    }
    if (baseMimeType === 'audio/aac') {
      return 'audio/aac';
    }
    if (baseMimeType === 'audio/flac' || baseMimeType === 'audio/x-flac') {
      return 'audio/flac';
    }
    if (
      (baseMimeType === 'audio/ogg' || baseMimeType === 'application/ogg') &&
      /(?:^|[;\s])codecs?="?vorbis"?($|[;\s])/i.test(normalizedMimeType)
    ) {
      return 'audio/ogg';
    }

    // OGG may contain Opus (the format used by WhatsApp), while Gemini
    // documents OGG Vorbis support. Normalize it instead of relabelling bytes.
    return null;
  }

  private async requestProvider(
    request: IVoiceIaProviderRequest
  ): Promise<Response | null> {
    for (
      let attempt = 1;
      attempt <= this.providerRequestMaxAttempts;
      attempt += 1
    ) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.providerRequestTimeoutMs
      );
      let shouldRetry = false;
      let retryAfterMs = 0;

      try {
        const response = await fetch(request.url, {
          ...request.init,
          signal: controller.signal,
        });

        if (response.ok) {
          const responseBody = await response.arrayBuffer();
          return new Response(responseBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }

        const code = await this.extractProviderErrorCode(response);
        const retryable = this.isRetryableStatus(response.status);
        shouldRetry = retryable && attempt < this.providerRequestMaxAttempts;
        retryAfterMs = this.parseRetryAfterMs(
          response.headers.get('retry-after')
        );
        this.logProviderFailure(request, {
          httpStatus: response.status,
          code,
          attempt,
          retryable,
          willRetry: shouldRetry,
        });

        if (!shouldRetry) {
          return null;
        }
      } catch (error) {
        const isTimeout =
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError');
        const retryable = isTimeout;
        shouldRetry = retryable && attempt < this.providerRequestMaxAttempts;
        this.logProviderFailure(request, {
          httpStatus: isTimeout ? 408 : null,
          code: isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          attempt,
          retryable,
          willRetry: shouldRetry,
        });

        if (!shouldRetry) {
          return null;
        }
      } finally {
        clearTimeout(timeoutId);
      }

      await this.delayBeforeRetry(attempt, retryAfterMs);
    }

    return null;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
  }

  private async delayBeforeRetry(
    attempt: number,
    retryAfterMs: number
  ): Promise<void> {
    const exponentialDelay = Math.min(
      this.retryBaseDelayMs * 2 ** (attempt - 1),
      this.retryMaxDelayMs
    );
    const jitterRange = Math.max(1, Math.floor(exponentialDelay * 0.25));
    const jitter = Math.floor(Math.random() * jitterRange);
    const delayMs = Math.min(
      this.retryMaxDelayMs,
      Math.max(exponentialDelay + jitter, retryAfterMs)
    );

    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  private parseRetryAfterMs(value: string | null): number {
    if (!value) {
      return 0;
    }

    const seconds = Number.parseFloat(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, this.retryMaxDelayMs);
    }

    const retryAt = Date.parse(value);
    if (!Number.isFinite(retryAt)) {
      return 0;
    }

    return Math.min(Math.max(0, retryAt - Date.now()), this.retryMaxDelayMs);
  }

  private async extractProviderErrorCode(response: Response): Promise<string> {
    try {
      const payload: unknown = await response.json();
      if (!this.isRecord(payload)) {
        return `HTTP_${response.status}`;
      }

      const errorValue = this.isRecord(payload.error) ? payload.error : null;
      const detailValue = this.isRecord(payload.detail) ? payload.detail : null;
      const candidates: unknown[] = [
        errorValue?.status,
        errorValue?.code,
        errorValue?.type,
        detailValue?.status,
        detailValue?.code,
        payload.status,
        payload.code,
      ];

      for (const candidate of candidates) {
        const normalized = this.normalizeProviderCode(candidate);
        if (normalized) {
          return normalized;
        }
      }
    } catch {
      return `HTTP_${response.status}`;
    }

    return `HTTP_${response.status}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private normalizeProviderCode(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const normalized = String(value).trim().slice(0, 100);
    if (!normalized || !/^[a-z0-9_.:-]+$/i.test(normalized)) {
      return null;
    }

    return normalized;
  }

  private logProviderFailure(
    request: IVoiceIaProviderRequest,
    failure: IVoiceIaProviderFailure
  ): void {
    const details = {
      provider: request.provider,
      operation: request.operation,
      voice_ia_id: request.voiceIaId,
      http_status: failure.httpStatus,
      code: failure.code,
      attempt: failure.attempt,
      max_attempts: this.providerRequestMaxAttempts,
      retryable: failure.retryable,
    };

    if (failure.willRetry) {
      console.warn('[VoiceIaIntegration] provider request will retry', details);
      return;
    }

    console.error('[VoiceIaIntegration] provider request failed', details);
  }

  private logLocalFailure(
    provider: VoiceIaProviderName,
    operation: VoiceIaOperation,
    code: string,
    warning = false,
    context: Readonly<Record<string, number | string | boolean | null>> = {}
  ): void {
    const details = {
      provider,
      operation,
      http_status: null,
      code,
      attempt: 0,
      max_attempts: this.providerRequestMaxAttempts,
      retryable: false,
      ...context,
    };

    if (warning) {
      console.warn('[VoiceIaIntegration] configuration unavailable', details);
      return;
    }

    console.error('[VoiceIaIntegration] local processing failed', details);
  }

  private async readJsonResponse<ResponseBody>(
    response: Response,
    provider: EVoiceIaType,
    operation: VoiceIaOperation
  ): Promise<ResponseBody | null> {
    try {
      return (await response.json()) as ResponseBody;
    } catch {
      this.logLocalFailure(provider, operation, 'INVALID_JSON_RESPONSE');
      return null;
    }
  }

  private async readBinaryAudioResponse(
    response: Response,
    provider: EVoiceIaType,
    mimetype: string,
    extension: string
  ): Promise<IVoiceIaGenerateSpeechResult | null> {
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        this.logLocalFailure(
          provider,
          'speech_generation',
          'EMPTY_AUDIO_RESPONSE'
        );
        return null;
      }

      return {
        buffer,
        mimetype,
        extension,
      };
    } catch {
      this.logLocalFailure(
        provider,
        'speech_generation',
        'INVALID_AUDIO_RESPONSE'
      );
      return null;
    }
  }
}
