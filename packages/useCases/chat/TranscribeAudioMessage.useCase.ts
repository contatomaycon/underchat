import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { TranscriptionService } from '@core/services/transcription.service';
import { TranscribeAudioParams } from '@core/schema/chat/transcribeAudio/request.schema';
import type { TranscribeAudioResponse } from '@core/schema/chat/transcribeAudio/response.schema';
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

@injectable()
export class TranscribeAudioMessageUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(TranscriptionService)
    private readonly transcriptionService: TranscriptionService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: TranscribeAudioParams,
    userId: string,
    userChannels: { id: string; name: string }[] = [],
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<TranscribeAudioResponse> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    if (!isChatParticipant(chat, userId)) {
      throw new Error(t('chat_access_denied'));
    }

    const message = await this.chatService.findMessageByMessageId(
      accountId,
      params.message_id
    );
    if (!message || message.chat_id !== params.chat_id) {
      throw new Error(t('message_not_found'));
    }

    const result = await this.transcriptionService.transcribeMessage(
      params.chat_id,
      params.message_id,
      accountId,
      webhookSource
    );

    return result;
  }
}
