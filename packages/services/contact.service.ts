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
import { TFunction } from 'i18next';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { ContactSensitiveDataRepository } from '@core/repositories/contact/ContactSensitiveData.repository';
import { ContactExistsByEmailAndPhoneRepository } from '@core/repositories/contact/ContactExistsByEmailAndPhone.repository';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';
import { StorageService } from './storage.service';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';

type FieldValue = string | { value: string } | null;

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
    private readonly contactExistsByEmailAndPhoneRepository: ContactExistsByEmailAndPhoneRepository,
    private readonly storageService: StorageService
  ) {}

  listContacts = async (
    perPage: number,
    currentPage: number,
    query: ListContactRequest,
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
        accountId,
        searchHashes
      ),
      this.contactListerRepository.listContactTotal(
        query,
        accountId,
        searchHashes
      ),
    ]);

    return [result, total];
  };

  existsContactById = async (contactId: string): Promise<boolean> => {
    return this.contactViewerExistsRepository.existsContactById(contactId);
  };

  private extractFieldValue(field: FieldValue | undefined): string | null {
    if (field === null || field === undefined) {
      return null;
    }

    if (typeof field === 'object' && 'value' in field) {
      return field.value ?? null;
    }

    if (typeof field === 'string') {
      return field;
    }

    return null;
  }

  private processEmailFields(
    input: CreateContactRequest | ICreateContact,
    isAlreadyEncrypted: boolean
  ): {
    emailCEncrypted: string | null;
    emailPartialEncrypted: string | null;
    emailC: string | null;
  } {
    if (isAlreadyEncrypted) {
      const encryptedInput = input as ICreateContact;

      return {
        emailCEncrypted: encryptedInput.email ?? null,
        emailPartialEncrypted: encryptedInput.email_partial ?? null,
        emailC: encryptedInput.email_c ?? null,
      };
    }

    const emailField = 'email' in input ? input.email : null;
    const plainEmail = this.extractFieldValue(emailField as FieldValue);
    if (!plainEmail) {
      return {
        emailCEncrypted: null,
        emailPartialEncrypted: null,
        emailC: null,
      };
    }

    return {
      emailCEncrypted: this.passwordEncryptorService.encrypt(plainEmail),
      emailPartialEncrypted: (
        this.encryptService.sanitize(plainEmail, ETypeSanetize.email) ?? ''
      ).slice(0, 50),
      emailC: this.encryptService.encrypt(plainEmail),
    };
  }

  private processPhoneFields(
    input: CreateContactRequest | ICreateContact,
    isAlreadyEncrypted: boolean
  ): {
    phoneCEncrypted: string | null;
    phonePartialEncrypted: string | null;
    phoneC: string | null;
  } {
    if (isAlreadyEncrypted) {
      const encryptedInput = input as ICreateContact;

      return {
        phoneCEncrypted: encryptedInput.phone ?? null,
        phonePartialEncrypted: encryptedInput.phone_partial ?? null,
        phoneC: encryptedInput.phone_c ?? null,
      };
    }

    const phoneField = 'phone' in input ? input.phone : null;
    const plainPhone = this.extractFieldValue(phoneField as FieldValue);
    if (!plainPhone) {
      return {
        phoneCEncrypted: null,
        phonePartialEncrypted: null,
        phoneC: null,
      };
    }

    return {
      phoneCEncrypted: this.passwordEncryptorService.encrypt(plainPhone),
      phonePartialEncrypted: this.encryptService.sanitize(
        plainPhone,
        ETypeSanetize.phone
      ),
      phoneC: this.encryptService.encrypt(plainPhone),
    };
  }

  private prepareContactPayload(
    input: CreateContactRequest | ICreateContact,
    accountId: string,
    isValidated: boolean,
    photoUrl?: string | null
  ): ICreateContact {
    const isAlreadyEncrypted = 'email_c' in input || 'phone_c' in input;

    const emailFields = this.processEmailFields(input, isAlreadyEncrypted);
    const phoneFields = this.processPhoneFields(input, isAlreadyEncrypted);

    if (isAlreadyEncrypted) {
      return {
        ...input,
        photo: photoUrl ?? input.photo,
      };
    }

    const createInput = input as CreateContactRequest;
    const labelTemplateId = this.extractFieldValue(
      createInput.label_template_id as FieldValue
    );
    const name = this.extractFieldValue(createInput.name as FieldValue);
    const lastName = this.extractFieldValue(
      createInput.last_name as FieldValue
    );
    const phoneDdi = this.extractFieldValue(
      createInput.phone_ddi as FieldValue
    );
    const nickname = this.extractFieldValue(createInput.nickname as FieldValue);
    const birthday = this.extractFieldValue(createInput.birthday as FieldValue);
    const notes = this.extractFieldValue(createInput.notes as FieldValue);

    return {
      account_id: accountId,
      label_template_id: labelTemplateId,
      is_valided: isValidated,
      name: name ?? '',
      last_name: lastName,
      email: emailFields.emailCEncrypted,
      email_partial: emailFields.emailPartialEncrypted,
      email_c: emailFields.emailC,
      phone_ddi: phoneDdi ?? '',
      phone: phoneFields.phoneCEncrypted,
      phone_partial: phoneFields.phonePartialEncrypted,
      phone_c: phoneFields.phoneC,
      nickname,
      photo: photoUrl,
      birthday: nullIfEmpty(birthday),
      notes,
    };
  }

  createContact = async (
    input: CreateContactRequest,
    accountId: string,
    isValidated: boolean = true
  ): Promise<string | null> => {
    let photoUrl: string | null = null;

    const imageUrl = this.extractFieldValue(input.image_url as FieldValue);

    if (imageUrl) {
      photoUrl = imageUrl;
    }
    if (!imageUrl && input.photo) {
      const uploadResult = await this.storageService.uploadImage(
        input.photo,
        accountId
      );
      photoUrl = uploadResult?.url ?? null;
    }

    const payload = this.prepareContactPayload(
      input,
      accountId,
      isValidated,
      photoUrl
    );
    return this.contactCreatorRepository.createContact(payload);
  };

  createContactWithGroup = async (
    t: TFunction<'translation', undefined>,
    input: ICreateContact,
    contactGroupId: string,
    accountId: string,
    isValidated: boolean = false
  ): Promise<boolean | null> => {
    const payload = this.prepareContactPayload(
      input,
      accountId,
      isValidated,
      input.photo
    );

    return this.contactCreatorRepository.createContactWithGroup(
      t,
      payload,
      contactGroupId
    );
  };

  viewContactById = async (
    contactId: string,
    accountId?: string
  ): Promise<(ViewContactResponse & { phone: string }) | null> => {
    return this.contactViewerRepository.viewContactById(contactId, accountId);
  };

  getContactById = async (
    contactId: string,
    accountId?: string
  ): Promise<ViewContactResponse | null> => {
    return this.contactViewerRepository.viewContactById(contactId, accountId);
  };

  getContactByPhone = async (
    accountId: string,
    phone: string,
    phoneDdi: string | null
  ): Promise<ViewContactResponse | null> => {
    const phoneC = phone ? this.encryptService.encrypt(phone) : null;
    if (!phoneC) return null;
    const phoneDdiToSave = phoneDdi ?? '55';

    const phones = buildCandidatesWithDdi(phone, phoneDdiToSave);
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    return this.contactViewerRepository.viewContactByPhone(
      accountId,
      phonesC,
      phoneDdiToSave
    );
  };

  validateContact = async (
    contactId: string,
    phone: string,
    phoneDdi: string | null
  ): Promise<boolean> => {
    const phoneCEncrypted = phone
      ? this.passwordEncryptorService.encrypt(phone)
      : null;

    const phonePartialEncrypted = phone
      ? this.encryptService.sanitize(phone, ETypeSanetize.phone)
      : null;

    const phoneC = phone ? this.encryptService.encrypt(phone) : null;

    const payload: IUpdateContact = {
      phone_ddi: phoneDdi,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      phone_c: phoneC,
      is_valided: true,
    };

    return this.contactUpdaterRepository.validateContact(contactId, payload);
  };

  deleteContactById = async (contactId: string): Promise<boolean> => {
    return this.contactDeleterRepository.deleteContactById(contactId);
  };

  private determineIsValided(
    currentContact: (ViewContactResponse & { phone: string }) | null,
    newPhoneEncrypted: string | null,
    newPhoneDdi: string | null | undefined,
    newPhone: string | null | undefined
  ): boolean {
    if (!currentContact) return !!(newPhone && newPhoneDdi);
    if (!newPhoneDdi) return currentContact.is_valided ?? false;

    const phoneChanged =
      newPhoneEncrypted !== currentContact.phone ||
      newPhoneDdi !== currentContact.phone_ddi;

    if (!phoneChanged) {
      return currentContact.is_valided ?? false;
    }

    return !!(newPhone && newPhoneDdi);
  }

  updateContactById = async (
    input: UpdateContactRequest,
    contactId: string,
    accountId?: string
  ): Promise<boolean | null> => {
    const currentContact = await this.viewContactById(contactId, accountId);

    const emailField = this.extractFieldValue(input.email as FieldValue);
    const emailCEncrypted = emailField
      ? this.passwordEncryptorService.encrypt(emailField)
      : null;

    const emailPartialEncrypted = emailField
      ? (
          this.encryptService.sanitize(emailField, ETypeSanetize.email) ?? ''
        ).slice(0, 50)
      : null;

    const emailC = emailField ? this.encryptService.encrypt(emailField) : null;

    const phoneField = this.extractFieldValue(input.phone as FieldValue);
    const phoneCEncrypted = phoneField
      ? this.passwordEncryptorService.encrypt(phoneField)
      : null;

    const phonePartialEncrypted = phoneField
      ? this.encryptService.sanitize(phoneField, ETypeSanetize.phone)
      : null;

    const phoneC = phoneField ? this.encryptService.encrypt(phoneField) : null;

    const phoneDdiField = this.extractFieldValue(input.phone_ddi as FieldValue);
    const isValided = this.determineIsValided(
      currentContact,
      phoneCEncrypted,
      phoneDdiField,
      phoneField
    );

    let photoUrl: string | null | undefined = undefined;

    const imageUrl = this.extractFieldValue(input.image_url as FieldValue);

    if (imageUrl) {
      photoUrl = imageUrl;
    }
    if (!imageUrl && input.photo && accountId) {
      const uploadResult = await this.storageService.uploadImage(
        input.photo,
        accountId
      );
      photoUrl = uploadResult?.url ?? null;
    }

    const labelTemplateId = this.extractFieldValue(
      input.label_template_id as FieldValue
    );
    const name = this.extractFieldValue(input.name as FieldValue);
    const lastName = this.extractFieldValue(input.last_name as FieldValue);
    const nickname = this.extractFieldValue(input.nickname as FieldValue);
    const birthday = this.extractFieldValue(input.birthday as FieldValue);
    const notes = this.extractFieldValue(input.notes as FieldValue);

    const payload: IUpdateContact = {
      label_template_id: labelTemplateId,
      name,
      last_name: lastName,
      email: emailCEncrypted,
      email_partial: emailPartialEncrypted,
      email_c: emailC,
      phone_ddi: phoneDdiField,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      phone_c: phoneC,
      nickname,
      photo: photoUrl,
      birthday: nullIfEmpty(birthday),
      notes,
      is_valided: isValided,
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
    accountId: string,
    emailC: string,
    contactId?: string | null
  ): Promise<boolean> => {
    return this.contactExistsByEmailAndPhoneRepository.existsContactByEmail(
      accountId,
      emailC,
      contactId
    );
  };

  existsContactByPhone = async (
    accountId: string,
    phonesC: string[],
    contactId?: string | null
  ): Promise<boolean> => {
    return this.contactExistsByEmailAndPhoneRepository.existsContactByPhone(
      accountId,
      phonesC,
      contactId
    );
  };

  deleteContactPhoto = async (
    contactId: string,
    accountId: string
  ): Promise<boolean> => {
    const currentContact = await this.viewContactById(contactId, accountId);

    if (!currentContact?.photo) {
      return true;
    }

    const photoDeleted = await this.storageService.deleteImage(
      currentContact.photo
    );

    if (!photoDeleted) {
      return false;
    }

    const payload: IUpdateContact = {
      photo: null,
      is_valided: currentContact.is_valided ?? false,
    };

    return this.contactUpdaterRepository.updateContactById(contactId, payload);
  };
}
