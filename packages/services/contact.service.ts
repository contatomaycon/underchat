import { injectable } from 'tsyringe';
import { ContactListerRepository } from '@core/repositories/contact/ContactLister.repository';
import { ListContactRequest } from '@core/schema/contact/listContact/request.schema';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { ContactViewerExistsRepository } from '@core/repositories/contact/ContactViewerExists.repository';
import { EncryptService } from './encrypt.service';
import { ContactCreatorRepository } from '@core/repositories/contact/ContactCreator.repository';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import { ContactViewerRepository } from '@core/repositories/contact/ContactViewer.repository';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { ContactDeleterRepository } from '@core/repositories/contact/ContactDeleter.repository';
import { ContactUpdaterRepository } from '@core/repositories/contact/ContactUpdater.repository';
import { IUpdateContact } from '@core/common/interfaces/IUpdateContact';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';

@injectable()
export class ContactService {
  constructor(
    private readonly encryptService: EncryptService,
    private readonly contactListerRepository: ContactListerRepository,
    private readonly contactViewerExistsRepository: ContactViewerExistsRepository,
    private readonly contactCreatorRepository: ContactCreatorRepository,
    private readonly contactViewerRepository: ContactViewerRepository,
    private readonly contactDeleterRepository: ContactDeleterRepository,
    private readonly contactUpdaterRepository: ContactUpdaterRepository
  ) {}

  listContacts = async (
    perPage: number,
    currentPage: number,
    query: ListContactRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<[ListContactResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.contactListerRepository.listContacts(
        perPage,
        currentPage,
        query,
        isAdministrator,
        accountId
      ),
      this.contactListerRepository.listContactTotal(
        query,
        isAdministrator,
        accountId
      ),
    ]);

    return [result, total];
  };

  existsContactById = async (contactId: string): Promise<boolean> => {
    return this.contactViewerExistsRepository.existsContactById(contactId);
  };

  createContact = async (
    input: CreateContactRequest,
    accountId: string
  ): Promise<string | null> => {
    const emailCEncrypted = input.email
      ? this.encryptService.encrypt(input.email)
      : null;

    const emailPartialEncrypted = input.email
      ? this.encryptService.sanitize(input.email, ETypeSanetize.email)
      : null;

    const phoneCEncrypted = input.phone
      ? this.encryptService.encrypt(input.phone)
      : null;

    const phonePartialEncrypted = input.phone
      ? this.encryptService.sanitize(input.phone, ETypeSanetize.phone)
      : null;

    const payload: ICreateContact = {
      account_id: accountId,
      label_template_id: input.label_template_id,
      name: input.name,
      last_name: input.last_name,
      email: emailCEncrypted,
      email_partial: emailPartialEncrypted,
      phone_ddi: input.phone_ddi,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      nickname: input.nickname,
      birthday: input.birthday,
      notes: input.notes,
    };

    return this.contactCreatorRepository.createContact(payload);
  };

  viewContactById = async (
    contactId: string
  ): Promise<ViewContactResponse | null> => {
    return this.contactViewerRepository.viewContactById(contactId);
  };

  deleteContactById = async (contactId: string): Promise<boolean> => {
    return this.contactDeleterRepository.deleteContactById(contactId);
  };

  updateContactById = async (
    input: UpdateContactRequest,
    contactId: string
  ): Promise<boolean | null> => {
    const emailCEncrypted = input.email
      ? this.encryptService.encrypt(input.email)
      : null;

    const emailPartialEncrypted = input.email
      ? this.encryptService.sanitize(input.email, ETypeSanetize.email)
      : null;

    const phoneCEncrypted = input.phone
      ? this.encryptService.encrypt(input.phone)
      : null;

    const phonePartialEncrypted = input.phone
      ? this.encryptService.sanitize(input.phone, ETypeSanetize.phone)
      : null;

    const payload: IUpdateContact = {
      label_template_id: input.label_template_id,
      name: input.name,
      last_name: input.last_name,
      email: emailCEncrypted,
      email_partial: emailPartialEncrypted,
      phone_ddi: input.phone_ddi,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      nickname: input.nickname,
      birthday: input.birthday,
      notes: input.notes,
    };

    return this.contactUpdaterRepository.updateContactById(contactId, payload);
  };
}
