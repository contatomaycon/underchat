import { injectable, inject } from 'tsyringe';
import { ChatService } from './chat.service';
import { AiAgentService } from './aiAgent.service';
import { VoiceIaService } from './voiceIa.service';
import { VoiceIaIntegrationService } from './voiceIaIntegration.service';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import type { TranscribeAudioResponse } from '@core/schema/chat/transcribeAudio/response.schema';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';
import { getChatbotApiOutboundHttpPolicy } from '@core/common/functions/chatbotApiOutboundHttpPolicy';

@injectable()
export class TranscriptionService {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(VoiceIaService)
    private readonly voiceIaService: VoiceIaService,
    @inject(VoiceIaIntegrationService)
    private readonly voiceIaIntegrationService: VoiceIaIntegrationService,
    @inject(WorkerConfigViewerRepository)
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository
  ) {}

  async transcribeMessage(
    chatId: string,
    messageId: string,
    accountId: string,
    outboundWebhookSource = 'transcription_service'
  ): Promise<TranscribeAudioResponse> {
    const message = await this.chatService.findMessageByMessageId(
      accountId,
      messageId
    );

    if (!message) {
      throw new Error('Mensagem não encontrada.');
    }

    if (message.chat_id !== chatId) {
      throw new Error('message_not_found');
    }

    if (message.content?.type !== 'audio') {
      throw new Error('A mensagem não é do tipo áudio.');
    }

    const existingTranscription = message.content?.audio?.transcription;
    if (existingTranscription) {
      await this.persistTranscriptionEvent(
        message,
        existingTranscription,
        outboundWebhookSource
      );
      return { transcription: existingTranscription, cached: true };
    }

    const audioUrl = message.content?.audio?.url;
    if (!audioUrl) {
      throw new Error('URL do áudio não encontrada na mensagem.');
    }

    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error('Chat não encontrado.');
    }

    const workerId = chat.worker?.id;
    if (!workerId) {
      throw new Error('Canal do chat não encontrado.');
    }

    const aiAgentConfig =
      await this.workerConfigViewerRepository.fetchAiAgentValue(workerId);

    if (!aiAgentConfig.aiAgentId) {
      throw new Error(
        'Nenhum agente de IA configurado neste canal para transcrição.'
      );
    }

    const aiAgent = await this.aiAgentService.viewAiAgent(
      aiAgentConfig.aiAgentId,
      accountId
    );

    if (!aiAgent?.voice_ia_id) {
      throw new Error(
        'O agente de IA não possui Voice IA configurado para transcrição.'
      );
    }

    const voiceIaConfig = await this.voiceIaService.viewVoiceIa(
      aiAgent.voice_ia_id,
      accountId
    );

    if (
      !voiceIaConfig ||
      voiceIaConfig.status !== EVoiceIaStatus.active ||
      !voiceIaConfig.api_key?.trim()
    ) {
      throw new Error(
        'Configuração de Voice IA inativa ou sem chave API configurada.'
      );
    }

    const audioResponse = await executeSafeOutboundHttp({
      url: audioUrl,
      method: 'GET',
      ...getChatbotApiOutboundHttpPolicy(),
    });
    if (
      audioResponse.kind !== 'response' ||
      audioResponse.statusCode < 200 ||
      audioResponse.statusCode >= 300
    ) {
      throw new Error('Não foi possível baixar o áudio para transcrição.');
    }

    const mimetype = message.content?.audio?.mimetype?.trim() || 'audio/mpeg';

    const result = await this.voiceIaIntegrationService.transcribe(
      audioResponse.body,
      voiceIaConfig,
      mimetype
    );

    const transcription = result?.text?.trim();
    if (!transcription) {
      throw new Error('Não foi possível transcrever o áudio.');
    }

    const persisted = await this.persistTranscriptionEvent(
      message,
      transcription,
      outboundWebhookSource
    );
    if (!persisted) {
      throw new Error('Não foi possível persistir a transcrição do áudio.');
    }

    return { transcription, cached: false };
  }

  private async persistTranscriptionEvent(
    message: IChatMessage,
    transcription: string,
    outboundWebhookSource: string
  ): Promise<boolean> {
    if (!message?.content?.audio) {
      return false;
    }

    const updatedMessage = {
      ...message,
      content: {
        ...message.content,
        audio: {
          ...message.content.audio,
          transcription,
        },
      },
    };

    return this.chatService.updateMessageChat(updatedMessage, {
      eventTypes: ['message.transcription.updated'],
      idempotencyKey: `message-transcription:${message.message_id}`,
      source: outboundWebhookSource,
      previousMessage: message,
      actor: { type: 'system' },
      changes: {
        transcription_available: true,
        origin: outboundWebhookSource,
      },
    });
  }
}
