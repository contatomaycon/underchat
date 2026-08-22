import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactDocumentResponse } from '@core/schema/chat/viewContactDocument/response.schema';

@injectable()
export class ChatContactDocumentViewerUseCase {
  constructor(
    @inject(ChatContactService)
    private readonly chatContactService: ChatContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string,
    allowedChannelIds: string[]
  ): Promise<ViewChatContactDocumentResponse | null> {
    const contact = await this.chatContactService.viewChatContactById(
      contactId,
      accountId,
      allowedChannelIds
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    const document =
      await this.chatContactService.getChatContactDocumentDecrypted(contactId);

    if (document === null) {
      throw new Error(t('contact_not_found'));
    }

    return {
      document,
    };
  }
}
