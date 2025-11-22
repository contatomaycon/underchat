import { inject, injectable } from 'tsyringe';
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
import { TFunction } from 'i18next';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { ContactSensitiveDataRepository } from '@core/repositories/contact/ContactSensitiveData.repository';
import { ContactExistsByEmailAndPhoneRepository } from '@core/repositories/contact/ContactExistsByEmailAndPhone.repository';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';

@injectable()
export class ContactService {
  constructor(
    private readonly encryptService: EncryptService,
    private readonly contactListerRepository: ContactListerRepository,
    private readonly contactViewerExistsRepository: ContactViewerExistsRepository,
    private readonly contactCreatorRepository: ContactCreatorRepository,
    private readonly contactViewerRepository: ContactViewerRepository,
    private readonly contactDeleterRepository: ContactDeleterRepository,
    private readonly contactUpdaterRepository: ContactUpdaterRepository,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly contactSensitiveDataRepository: ContactSensitiveDataRepository,
    private readonly contactExistsByEmailAndPhoneRepository: ContactExistsByEmailAndPhoneRepository
  ) {}

  listContacts = async (
    perPage: number,
    currentPage: number,
    query: ListContactRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<[ListContactResponse[], number]> => {
    const searchHashes = query.search
      ? this.encryptService.encrypt(query.search)
      : null;

    const [result, total] = await Promise.all([
      this.contactListerRepository.listContacts(
        perPage,
        currentPage,
        query,
        isAdministrator,
        accountId,
        searchHashes
      ),
      this.contactListerRepository.listContactTotal(
        query,
        isAdministrator,
        accountId,
        searchHashes
      ),
    ]);

    return [result, total];
  };

  existsContactById = async (contactId: string): Promise<boolean> => {
    return this.contactViewerExistsRepository.existsContactById(contactId);
  };

  private prepareContactPayload(
    input: CreateContactRequest | ICreateContact,
    accountId: string,
    isValidated: boolean
  ): ICreateContact {
    const isAlreadyEncrypted = 'email_c' in input || 'phone_c' in input;

    let emailCEncrypted: string | null = null;
    let emailPartialEncrypted: string | null = null;
    let emailC: string | null = null;
    let phoneCEncrypted: string | null = null;
    let phonePartialEncrypted: string | null = null;
    let phoneC: string | null = null;

    if (isAlreadyEncrypted) {
      emailCEncrypted = input.email ?? null;
      emailPartialEncrypted = input.email_partial ?? null;
      emailC = input.email_c ?? null;
      phoneCEncrypted = input.phone ?? null;
      phonePartialEncrypted = input.phone_partial ?? null;
      phoneC = input.phone_c ?? null;
    } else {
      const plainEmail = 'email' in input ? input.email : null;
      const plainPhone = 'phone' in input ? input.phone : null;

      emailCEncrypted = plainEmail
        ? this.passwordEncryptorService.encrypt(plainEmail)
        : null;

      emailPartialEncrypted = plainEmail
        ? (
            this.encryptService.sanitize(plainEmail, ETypeSanetize.email) ?? ''
          ).slice(0, 50)
        : null;

      emailC = plainEmail ? this.encryptService.encrypt(plainEmail) : null;

      phoneCEncrypted = plainPhone
        ? this.passwordEncryptorService.encrypt(plainPhone)
        : null;

      phonePartialEncrypted = plainPhone
        ? this.encryptService.sanitize(plainPhone, ETypeSanetize.phone)
        : null;

      phoneC = plainPhone ? this.encryptService.encrypt(plainPhone) : null;
    }

    return {
      account_id: accountId,
      label_template_id: input.label_template_id,
      is_valided: isValidated,
      name: input.name,
      last_name: input.last_name,
      email: emailCEncrypted,
      email_partial: emailPartialEncrypted,
      email_c: emailC,
      phone_ddi: input.phone_ddi,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      phone_c: phoneC,
      nickname: input.nickname,
      birthday: nullIfEmpty(input.birthday),
      notes: input.notes,
    };
  }

  createContact = async (
    input: CreateContactRequest,
    accountId: string,
    isValidated: boolean = true
  ): Promise<string | null> => {
    const payload = this.prepareContactPayload(input, accountId, isValidated);
    return this.contactCreatorRepository.createContact(payload);
  };

  createContactWithGroup = async (
    t: TFunction<'translation', undefined>,
    input: ICreateContact,
    contactGroupId: string,
    accountId: string,
    isValidated: boolean = false
  ): Promise<boolean | null> => {
    const payload = this.prepareContactPayload(input, accountId, isValidated);

    return this.contactCreatorRepository.createContactWithGroup(
      t,
      payload,
      contactGroupId
    );
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
      ? this.passwordEncryptorService.encrypt(input.email)
      : null;

    const emailPartialEncrypted = input.email
      ? (
          this.encryptService.sanitize(input.email, ETypeSanetize.email) ?? ''
        ).slice(0, 50)
      : null;

    const emailC = input.email
      ? this.encryptService.encrypt(input.email)
      : null;

    const phoneCEncrypted = input.phone
      ? this.passwordEncryptorService.encrypt(input.phone)
      : null;

    const phonePartialEncrypted = input.phone
      ? this.encryptService.sanitize(input.phone, ETypeSanetize.phone)
      : null;

    const phoneC = input.phone
      ? this.encryptService.encrypt(input.phone)
      : null;

    const payload: IUpdateContact = {
      label_template_id: input.label_template_id,
      name: input.name,
      last_name: input.last_name,
      email: emailCEncrypted,
      email_partial: emailPartialEncrypted,
      email_c: emailC,
      phone_ddi: input.phone_ddi,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      phone_c: phoneC,
      nickname: input.nickname,
      birthday: nullIfEmpty(input.birthday),
      notes: input.notes,
    };

    return this.contactUpdaterRepository.updateContactById(contactId, payload);
  };

  getContactPhoneDecrypted = (
    encryptedPhone: string | null | undefined
  ): string | null => {
    if (!encryptedPhone) return null;

    if (typeof encryptedPhone !== 'string') {
      return null;
    }

    const isAESFormat =
      encryptedPhone.includes(':') && encryptedPhone.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedPhone =
        this.passwordEncryptorService.decrypt(encryptedPhone);

      return decryptedPhone;
    } catch {
      return null;
    }
  };

  getContactEmailDecrypted = (
    encryptedEmail: string | null | undefined
  ): string | null => {
    if (!encryptedEmail) return null;

    if (typeof encryptedEmail !== 'string') {
      return null;
    }

    if (encryptedEmail.includes('*')) {
      return null;
    }

    const isAESFormat =
      encryptedEmail.includes(':') && encryptedEmail.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedEmail =
        this.passwordEncryptorService.decrypt(encryptedEmail);

      return decryptedEmail;
    } catch {
      return null;
    }
  };

  getContactSensitiveDataDecrypted = async (
    contactId: string
  ): Promise<{ phone: string | null; email: string | null } | null> => {
    const sensitiveData =
      await this.contactSensitiveDataRepository.getContactSensitiveDataById(
        contactId
      );
    if (!sensitiveData) return null;

    return {
      phone: this.getContactPhoneDecrypted(sensitiveData.phone),
      email: this.getContactEmailDecrypted(sensitiveData.email),
    };
  };

  existsContactByEmail = async (
    emailC: string,
    contactId?: string | null
  ): Promise<boolean> => {
    return this.contactExistsByEmailAndPhoneRepository.existsContactByEmail(
      emailC,
      contactId
    );
  };

  existsContactByPhone = async (
    phonesC: string[],
    contactId?: string | null
  ): Promise<boolean> => {
    return this.contactExistsByEmailAndPhoneRepository.existsContactByPhone(
      phonesC,
      contactId
    );
  };
}
