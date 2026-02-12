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
    contactId: string
  ): Promise<ViewChatContactPhoneResponse | null> {
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
