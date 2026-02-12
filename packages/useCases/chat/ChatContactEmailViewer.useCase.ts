import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactEmailResponse } from '@core/schema/chat/viewContactEmail/response.schema';

@injectable()
export class ChatContactEmailViewerUseCase {
  constructor(
    @inject(ChatContactService)
    private readonly chatContactService: ChatContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string
  ): Promise<ViewChatContactEmailResponse | null> {
    const email =
      await this.chatContactService.getChatContactEmailDecrypted(contactId);

    if (email === null) {
      throw new Error(t('contact_not_found'));
    }

    return {
      email,
    };
  }
}
