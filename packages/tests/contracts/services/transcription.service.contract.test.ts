import 'reflect-metadata';

const mockExecuteSafeOutboundHttp = jest.fn();

jest.mock('@core/common/functions/safeOutboundHttp', () => ({
  ...jest.requireActual('@core/common/functions/safeOutboundHttp'),
  executeSafeOutboundHttp: (...args: unknown[]) =>
    mockExecuteSafeOutboundHttp(...args),
}));

jest.mock('@core/services/chat.service', () => ({ ChatService: class {} }));
jest.mock('@core/services/aiAgent.service', () => ({
  AiAgentService: class {},
}));
jest.mock('@core/services/voiceIa.service', () => ({
  VoiceIaService: class {},
}));
jest.mock('@core/services/voiceIaIntegration.service', () => ({
  VoiceIaIntegrationService: class {},
}));
jest.mock('@core/repositories/worker/WorkerConfigViewer.repository', () => ({
  WorkerConfigViewerRepository: class {},
}));

import { TranscriptionService } from '@core/services/transcription.service';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';

describe('TranscriptionService', () => {
  afterEach(() => {
    mockExecuteSafeOutboundHttp.mockReset();
  });

  function createService(overrides?: Record<string, unknown>) {
    const chatService = {
      findMessageByMessageId: jest.fn(async () => ({
        chat_id: 'c1',
        content: {
          type: 'audio',
          audio: { url: 'https://audio', mimetype: 'audio/ogg' },
        },
      })),
      findChatByChatId: jest.fn(async () => ({ worker: { id: 'w1' } })),
      updateMessageChat: jest.fn(async () => true),
      ...overrides,
    };

    const service = new TranscriptionService(
      chatService as never,
      { viewAiAgent: jest.fn(async () => ({ voice_ia_id: 'v1' })) } as never,
      {
        viewVoiceIa: jest.fn(async () => ({
          status: EVoiceIaStatus.active,
          api_key: 'key',
        })),
      } as never,
      {
        transcribe: jest.fn(async () => ({ text: 'transcribed text' })),
      } as never,
      {
        fetchAiAgentValue: jest.fn(async () => ({ aiAgentId: 'ai1' })),
      } as never
    );

    return { service, chatService };
  }

  it('returns cached transcription when already present', async () => {
    const { service } = createService({
      findMessageByMessageId: jest.fn(async () => ({
        chat_id: 'c1',
        content: {
          type: 'audio',
          audio: { transcription: 'cached text', url: 'x' },
        },
      })),
    });

    await expect(service.transcribeMessage('c1', 'm1', 'a1')).resolves.toEqual({
      transcription: 'cached text',
      cached: true,
    });
  });

  it('validates all preconditions and errors', async () => {
    const { service } = createService({
      findMessageByMessageId: jest.fn(async () => null),
    });
    await expect(service.transcribeMessage('c1', 'm1', 'a1')).rejects.toThrow(
      'Mensagem não encontrada.'
    );

    const noAudioService = new TranscriptionService(
      {
        findMessageByMessageId: jest.fn(async () => ({
          chat_id: 'c1',
          content: { type: 'text' },
        })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    await expect(
      noAudioService.transcribeMessage('c1', 'm1', 'a1')
    ).rejects.toThrow('A mensagem não é do tipo áudio.');
  });

  it('handles url/chat/worker/agent/voice fetch and transcribe errors', async () => {
    const { service } = createService({
      findMessageByMessageId: jest.fn(async () => ({
        chat_id: 'c1',
        content: { type: 'audio', audio: {} },
      })),
    });
    await expect(service.transcribeMessage('c1', 'm1', 'a1')).rejects.toThrow(
      'URL do áudio não encontrada na mensagem.'
    );

    const noChatService = new TranscriptionService(
      {
        findMessageByMessageId: jest.fn(async () => ({
          chat_id: 'c1',
          content: { type: 'audio', audio: { url: 'https://audio' } },
        })),
        findChatByChatId: jest.fn(async () => null),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    await expect(
      noChatService.transcribeMessage('c1', 'm1', 'a1')
    ).rejects.toThrow('Chat não encontrado.');
  });

  it('transcribes and persists when everything is valid', async () => {
    const audio = Buffer.from([1, 2, 3]);
    mockExecuteSafeOutboundHttp.mockResolvedValue({
      kind: 'response',
      statusCode: 200,
      headers: {},
      body: audio,
      finalUrl: 'https://audio',
      redirectCount: 0,
      durationMs: 1,
    });

    const { service, chatService } = createService();

    await expect(
      service.transcribeMessage('c1', 'm1', 'a1', 'public_api')
    ).resolves.toEqual({
      transcription: 'transcribed text',
      cached: false,
    });
    expect(chatService.updateMessageChat).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          audio: expect.objectContaining({
            transcription: 'transcribed text',
          }),
        }),
      }),
      expect.objectContaining({
        eventTypes: ['message.transcription.updated'],
        idempotencyKey: expect.stringContaining('message-transcription:'),
        source: 'public_api',
        changes: expect.objectContaining({ origin: 'public_api' }),
      })
    );
    expect(mockExecuteSafeOutboundHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://audio',
        method: 'GET',
      })
    );
  });

  it('rejects audio URLs blocked by the outbound SSRF policy', async () => {
    mockExecuteSafeOutboundHttp.mockResolvedValue({
      kind: 'failure',
      code: 'dns_blocked_address',
      message: 'blocked',
      retryable: false,
      isTimeout: false,
      durationMs: 1,
    });

    const { service, chatService } = createService();

    await expect(service.transcribeMessage('c1', 'm1', 'a1')).rejects.toThrow(
      'Não foi possível baixar o áudio para transcrição.'
    );
    expect(chatService.updateMessageChat).not.toHaveBeenCalled();
  });
});
