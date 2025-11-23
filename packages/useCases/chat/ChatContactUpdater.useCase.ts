import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import {
  UpdateChatContactBody,
  UpdateChatContactParams,
} from '@core/schema/chat/updateChatContact/request.schema';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ChatContactUpdaterUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: UpdateChatContactParams,
    body: UpdateChatContactBody
  ): Promise<IChat | null> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (!body.phone || !body.phone_ddi) {
      throw new Error(t('phone_ddi_and_phone_required'));
    }

    const contact = await this.contactService.getContactByPhone(
      accountId,
      body.phone,
      body.phone_ddi
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    const updatedChat: IChat = {
      ...chat,
      contact: {
        id: contact.contact_id,
        name: contact.name,
        phone: contact.phone_partial ?? body.phone,
        phone_ddi: contact.phone_ddi ?? body.phone_ddi,
      },
    };

    const saved = await this.chatService.saveChat(updatedChat);

    if (!saved) {
      throw new Error(t('chat_update_failed'));
    }

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

    return updatedChat;
  }
}
