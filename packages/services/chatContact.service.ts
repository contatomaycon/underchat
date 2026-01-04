import { injectable } from 'tsyringe';
import { ChatContactListerRepository } from '@core/repositories/contact/ChatContactLister.repository';
import { ChatContactViewerRepository } from '@core/repositories/contact/ChatContactViewer.repository';
import { ChatLabelTemplateAllListerRepository } from '@core/repositories/labelTemplate/ChatLabelTemplateAllLister.repository';
import { ContactService } from '@core/services/contact.service';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { ListChatLabelTemplatesResponse } from '@core/schema/chat/listLabelTemplates/response.schema';

@injectable()
export class ChatContactService {
  constructor(
    private readonly chatContactListerRepository: ChatContactListerRepository,
    private readonly chatContactViewerRepository: ChatContactViewerRepository,
    private readonly chatLabelTemplateAllListerRepository: ChatLabelTemplateAllListerRepository,
    private readonly contactService: ContactService
  ) {}

  listChatContacts = async (
    perPage: number,
    currentPage: number,
    accountId: string,
    search?: string
  ): Promise<[ListChatContactsResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.chatContactListerRepository.listChatContacts(
        perPage,
        currentPage,
        accountId,
        search
      ),
      this.chatContactListerRepository.listChatContactsTotal(accountId, search),
    ]);

    return [result, total];
  };

  viewChatContactById = async (
    contactId: string,
    accountId: string
  ): Promise<ViewChatContactResponse | null> => {
    return this.chatContactViewerRepository.viewChatContactById(
      contactId,
      accountId
    );
  };

  getChatContactEmailDecrypted = async (
    contactId: string
  ): Promise<string | null> => {
    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData) {
      return null;
    }

    return sensitiveData.email;
  };

  getChatContactPhoneDecrypted = async (
    contactId: string
  ): Promise<string | null> => {
    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData) {
      return null;
    }

    return sensitiveData.phone;
  };

  getChatContactDocumentDecrypted = async (
    contactId: string
  ): Promise<string | null> => {
    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData) {
      return null;
    }

    return sensitiveData.document;
  };

  listChatLabelTemplates = async (
    accountId: string
  ): Promise<ListChatLabelTemplatesResponse[]> => {
    return this.chatLabelTemplateAllListerRepository.listChatLabelTemplateAll(
      accountId
    );
  };
}
