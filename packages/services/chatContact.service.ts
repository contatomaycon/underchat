import { injectable } from 'tsyringe';
import { ChatContactListerRepository } from '@core/repositories/contact/ChatContactLister.repository';
import { ChatContactViewerRepository } from '@core/repositories/contact/ChatContactViewer.repository';
import { ChatLabelTemplateAllListerRepository } from '@core/repositories/labelTemplate/ChatLabelTemplateAllLister.repository';
import { ContactService } from '@core/services/contact.service';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
import { ListChatContactsRequest } from '@core/schema/chat/listContacts/request.schema';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { ViewChatContactByPhoneResponse } from '@core/schema/chat/viewContactByPhone/response.schema';
import { ViewChatContactsBatchResponse } from '@core/schema/chat/viewContactsBatch/response.schema';
import { ListChatLabelTemplatesResponse } from '@core/schema/chat/listLabelTemplates/response.schema';
import { EncryptService } from '@core/services/encrypt.service';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { onlyDigits } from '@core/common/functions/onlyDigits';

@injectable()
export class ChatContactService {
  constructor(
    private readonly chatContactListerRepository: ChatContactListerRepository,
    private readonly chatContactViewerRepository: ChatContactViewerRepository,
    private readonly chatLabelTemplateAllListerRepository: ChatLabelTemplateAllListerRepository,
    private readonly contactService: ContactService,
    private readonly encryptService: EncryptService
  ) {}

  listChatContacts = async (
    perPage: number,
    currentPage: number,
    accountId: string,
    query?: ListChatContactsRequest,
    allowedChannelIds: string[] = []
  ): Promise<[ListChatContactsResponse[], number]> => {
    let emailHash: string | null = null;
    let phoneHashes: string[] | null = null;
    let documentHash: string | null = null;

    if (query?.filter_email) {
      emailHash = this.encryptService.encrypt(query.filter_email);
    }

    if (query?.filter_phone) {
      const phoneDigits = onlyDigits(query.filter_phone);
      const phoneDdi = query.filter_phone_ddi ?? '55';
      const phoneCandidates = buildCandidatesWithDdi(phoneDigits, phoneDdi);
      phoneHashes = phoneCandidates.map((phone) =>
        this.encryptService.encrypt(phone)
      );
    }

    if (query?.filter_document) {
      const documentDigits = onlyDigits(query.filter_document);
      documentHash = this.encryptService.encrypt(documentDigits);
    }

    const [result, total] = await Promise.all([
      this.chatContactListerRepository.listChatContacts(
        perPage,
        currentPage,
        accountId,
        query,
        emailHash,
        phoneHashes,
        documentHash,
        allowedChannelIds
      ),
      this.chatContactListerRepository.listChatContactsTotal(
        accountId,
        query,
        emailHash,
        phoneHashes,
        documentHash,
        allowedChannelIds
      ),
    ]);

    return [result, total];
  };

  viewChatContactById = async (
    contactId: string,
    accountId: string,
    allowedChannelIds: string[] = []
  ): Promise<ViewChatContactResponse | null> => {
    return this.chatContactViewerRepository.viewChatContactById(
      contactId,
      accountId,
      allowedChannelIds
    );
  };

  viewChatContactByPhone = async (
    accountId: string,
    phone: string,
    phoneDdi: string,
    allowedChannelIds: string[] = []
  ): Promise<ViewChatContactByPhoneResponse | null> => {
    const phoneDigits = onlyDigits(phone);
    const phoneDdiToSave = phoneDdi ?? '55';
    const phoneCandidates = buildCandidatesWithDdi(phoneDigits, phoneDdiToSave);
    const phonesC = phoneCandidates.map((phone) =>
      this.encryptService.encrypt(phone)
    );

    return this.chatContactViewerRepository.viewChatContactByPhone(
      accountId,
      phonesC,
      phoneDdiToSave,
      allowedChannelIds
    );
  };

  viewChatContactsByIds = async (
    contactIds: string[],
    accountId: string,
    allowedChannelIds: string[] = []
  ): Promise<ViewChatContactsBatchResponse> => {
    return this.chatContactViewerRepository.viewChatContactsByIds(
      contactIds,
      accountId,
      allowedChannelIds
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
