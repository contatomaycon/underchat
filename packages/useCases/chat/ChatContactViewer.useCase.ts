import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';

@injectable()
export class ChatContactViewerUseCase {
  constructor(
    @inject(ChatContactService)
    private readonly chatContactService: ChatContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string,
    allowedChannelIds: string[] = []
  ): Promise<ViewChatContactResponse | null> {
    const contact = await this.chatContactService.viewChatContactById(
      contactId,
      accountId,
      allowedChannelIds
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    return contact;
  }
}
