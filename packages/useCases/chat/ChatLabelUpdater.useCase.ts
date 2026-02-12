import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import {
  UpdateChatLabelParams,
  UpdateChatLabelRequest,
} from '@core/schema/chat/updateChatLabel/request.schema';
import { ChatService } from '@core/services/chat.service';
import { LabelTemplateViewerRepository } from '@core/repositories/labelTemplate/LabelTemplateViewer.repository';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';

@injectable()
export class ChatLabelUpdaterUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(LabelTemplateViewerRepository)
    private readonly labelTemplateViewerRepository: LabelTemplateViewerRepository,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: UpdateChatLabelParams,
    body: UpdateChatLabelRequest,
    userChannels: { id: string; name: string }[] = []
  ): Promise<boolean> {
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

    let label: IChat['label'] | null = null;

    if (body.label_template_ids) {
      const labelTemplateIds = extractArrayFieldValue(body.label_template_ids);

      if (labelTemplateIds.length > 0) {
        const labelTemplates =
          await this.labelTemplateViewerRepository.viewLabelTemplatesByIds(
            labelTemplateIds,
            accountId
          );

        if (labelTemplates.length !== labelTemplateIds.length) {
          throw new Error(t('label_template_not_found'));
        }

        label = labelTemplates.map((labelTemplate) => ({
          label_template_id: labelTemplate.label_template_id,
          label: labelTemplate.label,
          color: labelTemplate.color,
        }));
      }
    }

    const updated = await this.chatService.updateChatLabel(
      params.chat_id,
      label
    );

    if (!updated) {
      throw new Error(t('chat_label_update_failed'));
    }

    const updatedChat: IChat = {
      ...chat,
      label,
    };

    await this.chatService.saveChat(updatedChat);

    const channelAccountId = updatedChat.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);

    return true;
  }
}
