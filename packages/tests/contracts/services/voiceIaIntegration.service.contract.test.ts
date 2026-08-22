import 'reflect-metadata';

import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import { VoiceIaIntegrationService } from '@core/services/voiceIaIntegration.service';

interface VoiceIaIntegrationInternals {
  delayBeforeRetry: (attempt: number, retryAfterMs: number) => Promise<void>;
  providerRequestTimeoutMs: number;
  geminiMaxInlineRequestBytes: number;
}

interface GeminiTranscriptionRequest {
  contents: Array<{
    parts: Array<{
      text?: string;
      inlineData?: {
        mimeType: string;
        data: string;
      };
    }>;
  }>;
}

const buildGeminiConfig = () => ({
  voice_ia_id: '01900000-0000-7000-8000-000000000001',
  name: 'Gemini Voice',
  voice_ia_type: EVoiceIaType.gemini,
  api_key: 'test-key',
  status: EVoiceIaStatus.active,
  voice_id: 'Kore',
  model_id: '',
  language_code: 'pt-BR',
  speed: '1',
  stability: '0.5',
  similarity_boost: '0.75',
  style_exaggeration: '0',
  created_at: null,
  updated_at: null,
});

const buildGptConfig = () => ({
  ...buildGeminiConfig(),
  name: 'GPT Voice',
  voice_ia_type: EVoiceIaType.gpt,
  voice_id: 'alloy',
  model_id: 'tts-1',
});

const buildElevenLabsConfig = () => ({
  ...buildGeminiConfig(),
  name: 'ElevenLabs Voice',
  voice_ia_type: EVoiceIaType.eleven_labs,
  voice_id: 'eleven-voice-id',
  model_id: 'eleven_multilingual_v2',
});

const buildSpeechResponse = (
  audio = Buffer.from([1, 2, 3, 4]),
  mimeType = 'audio/L16;codec=pcm;rate=24000'
): Response =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: audio.toString('base64'),
                  mimeType,
                },
              },
            ],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

const buildTranscriptionResponse = (text = 'áudio transcrito'): Response =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

const createConverterMock = () => ({
  convertAudio: jest.fn(async (buffer: Buffer) => ({
    buffer,
    mimetype: 'audio/mpeg',
    extension: 'mp3',
  })),
});

const createService = (
  converterService: ReturnType<
    typeof createConverterMock
  > = createConverterMock()
): VoiceIaIntegrationService =>
  new VoiceIaIntegrationService({} as never, converterService as never);

const removeRetryDelay = (
  service: VoiceIaIntegrationService
): VoiceIaIntegrationInternals => {
  const internals = service as unknown as VoiceIaIntegrationInternals;
  internals.delayBeforeRetry = jest.fn(async () => undefined);
  return internals;
};

describe('VoiceIaIntegrationService Gemini contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses Gemini 3.1 Flash TTS and returns a valid 24 kHz WAV', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(buildSpeechResponse());
    const service = createService();

    const result = await service.generateSpeech('Olá', buildGeminiConfig());

    expect(result).toMatchObject({
      mimetype: 'audio/wav',
      extension: 'wav',
    });
    expect(result?.buffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result?.buffer.toString('ascii', 8, 12)).toBe('WAVE');
    expect(result?.buffer.readUInt32LE(24)).toBe(24_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent'
    );
    expect(new Headers(request?.headers).get('x-goog-api-key')).toBe(
      'test-key'
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      contents: [{ parts: [{ text: 'Olá' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Kore',
            },
          },
        },
      },
    });
  });

  it('normalizes repeated models/ prefixes in a configured Gemini TTS model', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(buildSpeechResponse());
    const service = createService();

    await service.generateSpeech('Olá', {
      ...buildGeminiConfig(),
      model_id: '  models / models/ gemini-2.5-flash-preview-tts  ',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent'
    );
  });

  it('repairs a legacy GPT configuration containing an ElevenLabs model', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.from('generated-audio'), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    );
    const service = createService();

    await expect(
      service.generateSpeech('Olá', {
        ...buildGptConfig(),
        model_id: 'eleven_multilingual_v2',
      })
    ).resolves.toMatchObject({
      mimetype: 'audio/mpeg',
      extension: 'mp3',
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      model: 'tts-1',
      voice: 'alloy',
      input: 'Olá',
    });
  });

  it('rejects malformed base64 returned by Gemini TTS', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: 'not@@base64',
                      mimeType: 'audio/L16;codec=pcm;rate=24000',
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService();

    await expect(
      service.generateSpeech('Olá', buildGeminiConfig())
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] local processing failed',
      expect.objectContaining({
        code: 'INVALID_AUDIO_BASE64',
      })
    );
  });

  it('does not relabel non-WAV bytes when Gemini declares audio/wav', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        buildSpeechResponse(Buffer.from([1, 2, 3, 4]), 'audio/wav')
      );
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService();

    await expect(
      service.generateSpeech('Olá', buildGeminiConfig())
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] local processing failed',
      expect.objectContaining({
        code: 'INVALID_WAV_RESPONSE',
      })
    );
  });

  it('uses the current ElevenLabs Scribe v2 transcription model', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'áudio transcrito' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const service = createService();

    await expect(
      service.transcribe(
        Buffer.from('mp3-audio'),
        buildElevenLabsConfig(),
        'audio/mpeg'
      )
    ).resolves.toEqual({ text: 'áudio transcrito' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.elevenlabs.io/v1/speech-to-text'
    );
    const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('model_id')).toBe('scribe_v2');
  });

  it.each([
    ['audio/AAC', 'audio.aac'],
    ['audio/AIFF', 'audio.aiff'],
  ])(
    'uses the correct upload extension for %s',
    async (mimetype, expectedFilename) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ text: 'áudio transcrito' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const service = createService();

      await service.transcribe(
        Buffer.from('audio'),
        buildElevenLabsConfig(),
        mimetype
      );

      const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
      const uploadedFile = formData.get('file') as File;
      expect(uploadedFile.name).toBe(expectedFilename);
    }
  );

  it('uses Gemini 3.6 Flash and maps MP3 bytes to the documented MIME type', async () => {
    const audio = Buffer.from('mp3-audio');
    const converterService = createConverterMock();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(buildTranscriptionResponse());
    const service = createService(converterService);

    await expect(
      service.transcribe(audio, buildGeminiConfig(), 'audio/mpeg')
    ).resolves.toEqual({ text: 'áudio transcrito' });

    expect(converterService.convertAudio).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent'
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(
      String(request?.body)
    ) as GeminiTranscriptionRequest;
    expect(body.contents[0]?.parts[1]?.inlineData).toEqual({
      mimeType: 'audio/mp3',
      data: audio.toString('base64'),
    });
  });

  it('keeps documented OGG Vorbis input without converting or relabelling it', async () => {
    const audio = Buffer.from('ogg-vorbis-audio');
    const converterService = createConverterMock();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(buildTranscriptionResponse());
    const service = createService(converterService);

    await service.transcribe(
      audio,
      buildGeminiConfig(),
      'audio/ogg; codecs=vorbis'
    );

    expect(converterService.convertAudio).not.toHaveBeenCalled();
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(
      String(request?.body)
    ) as GeminiTranscriptionRequest;
    expect(body.contents[0]?.parts[1]?.inlineData).toEqual({
      mimeType: 'audio/ogg',
      data: audio.toString('base64'),
    });
  });

  it('converts OGG Opus input to MP3 instead of relabelling its bytes', async () => {
    const sourceAudio = Buffer.from('ogg-opus-audio');
    const convertedAudio = Buffer.from('normalized-mp3-audio');
    const converterService = createConverterMock();
    converterService.convertAudio.mockResolvedValue({
      buffer: convertedAudio,
      mimetype: 'audio/mpeg',
      extension: 'mp3',
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(buildTranscriptionResponse());
    const service = createService(converterService);

    await expect(
      service.transcribe(
        sourceAudio,
        buildGeminiConfig(),
        'audio/ogg; codecs=opus'
      )
    ).resolves.toEqual({ text: 'áudio transcrito' });

    expect(converterService.convertAudio).toHaveBeenCalledWith(
      sourceAudio,
      'audio/ogg; codecs=opus',
      false
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(
      String(request?.body)
    ) as GeminiTranscriptionRequest;
    expect(body.contents[0]?.parts[1]?.inlineData).toEqual({
      mimeType: 'audio/mp3',
      data: convertedAudio.toString('base64'),
    });
  });

  it('normalizes audio with an unknown MIME type instead of assuming MP3', async () => {
    const sourceAudio = Buffer.from('unknown-audio');
    const convertedAudio = Buffer.from('detected-and-converted-mp3');
    const converterService = createConverterMock();
    converterService.convertAudio.mockResolvedValue({
      buffer: convertedAudio,
      mimetype: 'audio/mpeg',
      extension: 'mp3',
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(buildTranscriptionResponse());
    const service = createService(converterService);

    await service.transcribe(sourceAudio, buildGeminiConfig());

    expect(converterService.convertAudio).toHaveBeenCalledWith(
      sourceAudio,
      'application/octet-stream',
      false
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(
      String(request?.body)
    ) as GeminiTranscriptionRequest;
    expect(body.contents[0]?.parts[1]?.inlineData).toEqual({
      mimeType: 'audio/mp3',
      data: convertedAudio.toString('base64'),
    });
  });

  it('rejects audio when conversion does not produce a Gemini-supported MIME type', async () => {
    const converterService = createConverterMock();
    converterService.convertAudio.mockResolvedValue({
      buffer: Buffer.from('still-webm'),
      mimetype: 'audio/webm',
      extension: 'webm',
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService(converterService);

    await expect(
      service.transcribe(Buffer.from('webm'), buildGeminiConfig(), 'audio/webm')
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] local processing failed',
      expect.objectContaining({
        provider: EVoiceIaType.gemini,
        operation: 'transcription',
        code: 'UNSUPPORTED_AUDIO_AFTER_CONVERSION',
      })
    );
  });

  it('rejects Gemini inline requests above 20 MB with actionable size metadata', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService();
    const internals = service as unknown as VoiceIaIntegrationInternals;
    expect(internals.geminiMaxInlineRequestBytes).toBe(20 * 1024 * 1024);
    internals.geminiMaxInlineRequestBytes = 100;

    await expect(
      service.transcribe(
        Buffer.alloc(100, 1),
        buildGeminiConfig(),
        'audio/mpeg'
      )
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] local processing failed',
      expect.objectContaining({
        code: 'INLINE_REQUEST_TOO_LARGE',
        request_bytes: expect.any(Number),
        limit_bytes: 100,
      })
    );
  });

  it('does not retry a 403 and logs only sanitized status/code metadata', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            status: 'PERMISSION_DENIED',
            message: 'provider-secret-message',
          },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService();

    await expect(
      service.generateSpeech('sensitive-text', buildGeminiConfig())
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] provider request failed',
      expect.objectContaining({
        provider: EVoiceIaType.gemini,
        operation: 'speech_generation',
        voice_ia_id: buildGeminiConfig().voice_ia_id,
        http_status: 403,
        code: 'PERMISSION_DENIED',
        attempt: 1,
        retryable: false,
      })
    );
    const serializedLogs = JSON.stringify(errorSpy.mock.calls);
    expect(serializedLogs).not.toContain('test-key');
    expect(serializedLogs).not.toContain('sensitive-text');
    expect(serializedLogs).not.toContain('provider-secret-message');
  });

  it('retries 429 with a fresh AbortSignal and succeeds', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '0',
            },
          }
        )
      )
      .mockResolvedValueOnce(buildSpeechResponse());
    const warningSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const service = createService();
    removeRetryDelay(service);

    await expect(
      service.generateSpeech('Olá', buildGeminiConfig())
    ).resolves.toMatchObject({
      mimetype: 'audio/wav',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).not.toBe(
      fetchMock.mock.calls[1]?.[1]?.signal
    );
    expect(warningSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] provider request will retry',
      expect.objectContaining({
        http_status: 429,
        code: 'RESOURCE_EXHAUSTED',
        attempt: 1,
        retryable: true,
      })
    );
  });

  it.each([408, 500, 503])(
    'retries HTTP %s up to the maximum attempt count',
    async (status) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => {
          return new Response(
            JSON.stringify({
              error: {
                status: `HTTP_${status}`,
              },
            }),
            {
              status,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        });
      const warningSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const service = createService();
      removeRetryDelay(service);

      await expect(
        service.generateSpeech('Olá', buildGeminiConfig())
      ).resolves.toBeNull();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(warningSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        '[VoiceIaIntegration] provider request failed',
        expect.objectContaining({
          http_status: status,
          code: `HTTP_${status}`,
          attempt: 3,
          retryable: true,
        })
      );
    }
  );

  it('retries a request timeout up to the maximum attempt count', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('missing abort signal'));
            return;
          }

          signals.push(signal);
          const rejectAsTimeout = () => {
            const error = new Error('provider-secret-timeout');
            error.name = 'AbortError';
            reject(error);
          };

          if (signal.aborted) {
            rejectAsTimeout();
            return;
          }
          signal.addEventListener('abort', rejectAsTimeout, { once: true });
        })
    );
    const warningSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService();
    const internals = removeRetryDelay(service);
    internals.providerRequestTimeoutMs = 1;

    await expect(
      service.generateSpeech('sensitive-text', buildGeminiConfig())
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(signals).size).toBe(3);
    expect(warningSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] provider request failed',
      expect.objectContaining({
        http_status: 408,
        code: 'REQUEST_TIMEOUT',
        attempt: 3,
        retryable: true,
      })
    );
    const serializedLogs = JSON.stringify([
      ...warningSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]);
    expect(serializedLogs).not.toContain('test-key');
    expect(serializedLogs).not.toContain('sensitive-text');
    expect(serializedLogs).not.toContain('provider-secret-timeout');
  });

  it('keeps the timeout active while the successful response body is read', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) => {
        const signal = init?.signal;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({
            'Content-Type': 'application/json',
          }),
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((_resolve, reject) => {
              const rejectAsTimeout = () => {
                const error = new Error('provider-secret-body-timeout');
                error.name = 'AbortError';
                reject(error);
              };

              if (signal?.aborted) {
                rejectAsTimeout();
                return;
              }
              signal?.addEventListener('abort', rejectAsTimeout, {
                once: true,
              });
            }),
        } as Response;
      });
    const warningSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService();
    const internals = removeRetryDelay(service);
    internals.providerRequestTimeoutMs = 1;

    await expect(
      service.generateSpeech('sensitive-text', buildGeminiConfig())
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warningSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] provider request failed',
      expect.objectContaining({
        http_status: 408,
        code: 'REQUEST_TIMEOUT',
        attempt: 3,
      })
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      'provider-secret-body-timeout'
    );
  });

  it('does not retry a non-timeout network failure', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('provider-secret-network-error'));
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = createService();

    await expect(
      service.generateSpeech('sensitive-text', buildGeminiConfig())
    ).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] provider request failed',
      expect.objectContaining({
        http_status: null,
        code: 'NETWORK_ERROR',
        attempt: 1,
        retryable: false,
      })
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(
      /test-key|sensitive-text|provider-secret-network-error/
    );
  });

  it('does not call a provider for an inactive configuration', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const warningSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const service = createService();

    await expect(
      service.generateSpeech('Olá', {
        ...buildGeminiConfig(),
        status: EVoiceIaStatus.inactive,
      })
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalledWith(
      '[VoiceIaIntegration] configuration unavailable',
      expect.objectContaining({
        provider: EVoiceIaType.gemini,
        code: 'INACTIVE_CONFIGURATION',
      })
    );
  });
});
