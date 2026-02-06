import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactByPhoneResponse } from '@core/schema/chat/viewContactByPhone/response.schema';

@injectable()
export class ChatContactByPhoneViewerUseCase {
  constructor(private readonly chatContactService: ChatContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    phone: string,
    phoneDdi: string,
    allowedChannelIds: string[] = []
  ): Promise<ViewChatContactByPhoneResponse | null> {
    const contact = await this.chatContactService.viewChatContactByPhone(
      accountId,
      phone,
      phoneDdi,
      allowedChannelIds
    );

    if (!contact) {
      return null;
    }

    return contact;
  }
}
