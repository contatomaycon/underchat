import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';

@injectable()
export class ChatContactViewerUseCase {
  constructor(private readonly chatContactService: ChatContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string
  ): Promise<ViewChatContactResponse | null> {
    const contact = await this.chatContactService.viewChatContactById(
      contactId,
      accountId
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    return contact;
  }
}
