import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactDocumentResponse } from '@core/schema/chat/viewContactDocument/response.schema';

@injectable()
export class ChatContactDocumentViewerUseCase {
  constructor(private readonly chatContactService: ChatContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string
  ): Promise<ViewChatContactDocumentResponse | null> {
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
