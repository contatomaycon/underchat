import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactPhoneResponse } from '@core/schema/chat/viewContactPhone/response.schema';

@injectable()
export class ChatContactPhoneViewerUseCase {
  constructor(
    @inject(ChatContactService)
    private readonly chatContactService: ChatContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string,
    allowedChannelIds: string[]
  ): Promise<ViewChatContactPhoneResponse | null> {
    const contact = await this.chatContactService.viewChatContactById(
      contactId,
      accountId,
      allowedChannelIds
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    const phone =
      await this.chatContactService.getChatContactPhoneDecrypted(contactId);

    if (phone === null) {
      throw new Error(t('contact_not_found'));
    }

    return {
      phone,
    };
  }
}
