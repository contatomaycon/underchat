import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { AiReplyService } from '@core/services/aiReply.service';
import {
  GenerateAiReplyParams,
  GenerateAiReplyBody,
} from '@core/schema/chat/generateAiReply/request.schema';
import type { GenerateAiReplyResponse } from '@core/schema/chat/generateAiReply/response.schema';
import { isChatParticipant } from '@core/common/functions/chatParticipants';

@injectable()
export class GenerateAiReplyUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(AiReplyService)
    private readonly aiReplyService: AiReplyService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: GenerateAiReplyParams,
    body: GenerateAiReplyBody,
    userId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<GenerateAiReplyResponse> {
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

    const result = await this.aiReplyService.generateReply(
      params.chat_id,
      body.message_id,
      body.response_type,
      accountId,
      body.instructions ?? undefined
    );

    return result;
  }
}
