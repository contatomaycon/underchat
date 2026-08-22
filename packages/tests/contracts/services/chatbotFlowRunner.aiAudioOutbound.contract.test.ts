import 'reflect-metadata';

const mockExecuteSafeOutboundHttp = jest.fn();

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/services/promptDocumentExtractor.service', () => ({
  PromptDocumentExtractorService: class PromptDocumentExtractorService {},
}));

jest.mock('@core/common/functions/safeOutboundHttp', () => ({
  ...jest.requireActual('@core/common/functions/safeOutboundHttp'),
  executeSafeOutboundHttp: (...args: unknown[]) =>
    mockExecuteSafeOutboundHttp(...args),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';

interface AiAudioRunnerHarness {
  voiceIaService: {
    viewVoiceIa: jest.Mock;
  };
  voiceIaIntegrationService: {
    transcribe: jest.Mock;
  };
  transcribeAudioMessage: (
    data: IUpsertMessage,
    chat: IChat,
    aiAgent: ViewAiAgentResponse
  ) => Promise<string | null>;
}

const createHarness = () => {
  const voiceIaConfig = {
    voice_ia_id: 'voice-1',
    status: EVoiceIaStatus.active,
    api_key: 'secret-key',
  };
  const voiceIaService = {
    viewVoiceIa: jest.fn().mockResolvedValue(voiceIaConfig),
  };
  const voiceIaIntegrationService = {
    transcribe: jest.fn().mockResolvedValue({ text: 'mensagem transcrita' }),
  };
  const runner = Object.create(
    ChatbotFlowRunnerService.prototype
  ) as AiAudioRunnerHarness;
  runner.voiceIaService = voiceIaService;
  runner.voiceIaIntegrationService = voiceIaIntegrationService;

  const data = {
    type: EMessageType.audio,
    content: {
      audio: {
        url: 'https://storage.example.test/audio.ogg',
        mimetype: 'audio/ogg; codecs=opus',
      },
    },
  } as unknown as IUpsertMessage;
  const chat = {
    chat_id: 'chat-1',
    status: EChatStatus.ura,
    account: { id: 'account-1' },
  } as unknown as IChat;
  const aiAgent = {
    voice_ia_id: 'voice-1',
  } as ViewAiAgentResponse;

  return {
    runner,
    data,
    chat,
    aiAgent,
    voiceIaIntegrationService,
  };
};

describe('ChatbotFlowRunner AI audio outbound contract', () => {
  beforeEach(() => {
    mockExecuteSafeOutboundHttp.mockReset();
  });

  it('downloads AI audio through the guarded outbound client', async () => {
    const harness = createHarness();
    const audio = Buffer.from('audio-bytes');
    mockExecuteSafeOutboundHttp.mockResolvedValue({
      kind: 'response',
      statusCode: 200,
      headers: {},
      body: audio,
      finalUrl: 'https://storage.example.test/audio.ogg',
      redirectCount: 0,
      durationMs: 1,
    });

    await expect(
      harness.runner.transcribeAudioMessage(
        harness.data,
        harness.chat,
        harness.aiAgent
      )
    ).resolves.toBe('mensagem transcrita');

    expect(mockExecuteSafeOutboundHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://storage.example.test/audio.ogg',
        method: 'GET',
      })
    );
    expect(harness.voiceIaIntegrationService.transcribe).toHaveBeenCalledWith(
      audio,
      expect.objectContaining({ voice_ia_id: 'voice-1' }),
      'audio/ogg; codecs=opus'
    );
  });

  it('does not transcribe an outbound URL rejected by the SSRF policy', async () => {
    const harness = createHarness();
    mockExecuteSafeOutboundHttp.mockResolvedValue({
      kind: 'failure',
      code: 'dns_blocked_address',
      message: 'blocked',
      retryable: false,
      isTimeout: false,
      durationMs: 1,
    });

    await expect(
      harness.runner.transcribeAudioMessage(
        harness.data,
        harness.chat,
        harness.aiAgent
      )
    ).resolves.toBeNull();

    expect(harness.voiceIaIntegrationService.transcribe).not.toHaveBeenCalled();
  });
});
