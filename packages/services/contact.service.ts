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
import { ContactUsersListerRepository } from '@core/repositories/contact/ContactUsersLister.repository';
import { ListContactUsersResponse } from '@core/schema/contact/listUsers/response.schema';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';
import { StorageService } from './storage.service';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { ContactLabelTemplateViewerExistsRepository } from '@core/repositories/contact/ContactLabelTemplateViewerExists.repository';
import { ContactLabelTemplateCreatorRepository } from '@core/repositories/contact/ContactLabelTemplateCreator.repository';
import { ContactLabelTemplateDeleterRepository } from '@core/repositories/contact/ContactLabelTemplateDeleter.repository';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';

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
    private readonly contactUsersListerRepository: ContactUsersListerRepository,
    private readonly storageService: StorageService,
    private readonly contactLabelTemplateViewerExistsRepository: ContactLabelTemplateViewerExistsRepository,
    private readonly contactLabelTemplateCreatorRepository: ContactLabelTemplateCreatorRepository,
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository
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

  private normalizeUserId(rawUserId: string | null): string | null {
    if (!rawUserId || typeof rawUserId !== 'string') {
      return null;
    }

    const trimmedUserId = rawUserId.trim();

    if (trimmedUserId === '' || trimmedUserId === 'null') {
      return null;
    }

    return trimmedUserId;
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
    const plainEmail = extractFieldValue(emailField as FieldValue);
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
    const plainPhone = extractFieldValue(phoneField as FieldValue);
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

  private processDocumentFields(
    input: CreateContactRequest | ICreateContact,
    isAlreadyEncrypted: boolean
  ): {
    documentCEncrypted: string | null;
    documentPartialEncrypted: string | null;
    documentC: string | null;
  } {
    if (isAlreadyEncrypted) {
      const encryptedInput = input as ICreateContact;

      return {
        documentCEncrypted: encryptedInput.document ?? null,
        documentPartialEncrypted: encryptedInput.document_partial ?? null,
        documentC: encryptedInput.document_c ?? null,
      };
    }

    const documentField = 'document' in input ? input.document : null;
    const plainDocument = extractFieldValue(documentField as FieldValue);
    if (!plainDocument) {
      return {
        documentCEncrypted: null,
        documentPartialEncrypted: null,
        documentC: null,
      };
    }

    return {
      documentCEncrypted: this.passwordEncryptorService.encrypt(plainDocument),
      documentPartialEncrypted: (
        this.encryptService.sanitize(plainDocument, ETypeSanetize.document) ??
        ''
      ).slice(0, 20),
      documentC: this.encryptService.encrypt(plainDocument),
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
    const documentFields = this.processDocumentFields(
      input,
      isAlreadyEncrypted
    );

    if (isAlreadyEncrypted) {
      return {
        ...input,
        photo: photoUrl ?? input.photo,
      };
    }

    const createInput = input as CreateContactRequest;
    const labelTemplateIds = extractArrayFieldValue(
      createInput.label_template_ids
    );
    const name = extractFieldValue(createInput.name as FieldValue);
    const lastName = extractFieldValue(createInput.last_name as FieldValue);
    const phoneDdi = extractFieldValue(createInput.phone_ddi as FieldValue);
    const nickname = extractFieldValue(createInput.nickname as FieldValue);
    const birthday = extractFieldValue(createInput.birthday as FieldValue);
    const notes = extractFieldValue(createInput.notes as FieldValue);
    const rawContactDocumentTypeId = extractFieldValue(
      createInput.contact_document_type_id as FieldValue
    );
    const contactDocumentTypeId =
      rawContactDocumentTypeId && rawContactDocumentTypeId.trim() !== ''
        ? rawContactDocumentTypeId
        : null;

    const finalDocumentCEncrypted = contactDocumentTypeId
      ? documentFields.documentCEncrypted
      : null;
    const finalDocumentPartialEncrypted = contactDocumentTypeId
      ? documentFields.documentPartialEncrypted
      : null;
    const finalDocumentC = contactDocumentTypeId
      ? documentFields.documentC
      : null;

    const rawUserId = extractFieldValue(createInput.user_id as FieldValue);
    const userId = rawUserId && rawUserId.trim() !== '' ? rawUserId : null;

    const rawIgnore = extractFieldValue(createInput.ignore as FieldValue);
    const ignore = rawIgnore && rawIgnore.trim() !== '' ? rawIgnore : null;

    return {
      account_id: accountId,
      label_template_ids: labelTemplateIds,
      contact_document_type_id: contactDocumentTypeId,
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
      document: finalDocumentCEncrypted,
      document_partial: finalDocumentPartialEncrypted,
      document_c: finalDocumentC,
      user_id: userId,
      ignore,
    };
  }

  createContact = async (
    input: CreateContactRequest,
    accountId: string,
    isValidated: boolean = true
  ): Promise<string | null> => {
    let photoUrl: string | null = null;

    const imageUrl = extractFieldValue(input.image_url as FieldValue);

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
    contactGroupId: string | null,
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

  updateContactIsValided = async (
    contactId: string,
    isValided: boolean
  ): Promise<boolean> => {
    return this.contactUpdaterRepository.updateContactIsValided(
      contactId,
      isValided
    );
  };

  updateContactValidation = async (
    contactId: string,
    phoneWithDdi: string,
    isValided: boolean
  ): Promise<boolean> => {
    const normalizedPhone = extractPhoneAndDdi(phoneWithDdi);
    if (!normalizedPhone) return false;

    const { phone, phone_ddi } = normalizedPhone;

    const phoneCEncrypted = phone
      ? this.passwordEncryptorService.encrypt(phone)
      : null;

    const phonePartialEncrypted = phone
      ? this.encryptService.sanitize(phone, ETypeSanetize.phone)
      : null;

    const phoneC = phone ? this.encryptService.encrypt(phone) : null;

    const payload: IUpdateContact = {
      phone_ddi,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      phone_c: phoneC,
      is_valided: isValided,
    };

    return this.contactUpdaterRepository.updateContactById(contactId, payload);
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

    const emailField = extractFieldValue(input.email as FieldValue);
    const emailCEncrypted = emailField
      ? this.passwordEncryptorService.encrypt(emailField)
      : null;

    const emailPartialEncrypted = emailField
      ? (
          this.encryptService.sanitize(emailField, ETypeSanetize.email) ?? ''
        ).slice(0, 50)
      : null;

    const emailC = emailField ? this.encryptService.encrypt(emailField) : null;

    const phoneField = extractFieldValue(input.phone as FieldValue);
    const phoneCEncrypted = phoneField
      ? this.passwordEncryptorService.encrypt(phoneField)
      : null;

    const phonePartialEncrypted = phoneField
      ? this.encryptService.sanitize(phoneField, ETypeSanetize.phone)
      : null;

    const phoneC = phoneField ? this.encryptService.encrypt(phoneField) : null;

    const documentField = extractFieldValue(input.document as FieldValue);
    const normalizedDocumentField =
      documentField && documentField.trim() !== '' ? documentField : null;

    const documentCEncrypted = normalizedDocumentField
      ? this.passwordEncryptorService.encrypt(normalizedDocumentField)
      : null;

    const documentPartialEncrypted = normalizedDocumentField
      ? (
          this.encryptService.sanitize(
            normalizedDocumentField,
            ETypeSanetize.document
          ) ?? ''
        ).slice(0, 20)
      : null;

    const documentC = normalizedDocumentField
      ? this.encryptService.encrypt(normalizedDocumentField)
      : null;

    const phoneDdiField = extractFieldValue(input.phone_ddi as FieldValue);
    const isValided = this.determineIsValided(
      currentContact,
      phoneCEncrypted,
      phoneDdiField,
      phoneField
    );

    let photoUrl: string | null | undefined = undefined;

    const imageUrl = extractFieldValue(input.image_url as FieldValue);

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

    const hasLabelTemplateIds = input.label_template_ids !== undefined;
    const labelTemplateIds = hasLabelTemplateIds
      ? extractArrayFieldValue(input.label_template_ids)
      : null;
    const name = extractFieldValue(input.name as FieldValue);
    const lastName = extractFieldValue(input.last_name as FieldValue);
    const nickname = extractFieldValue(input.nickname as FieldValue);
    const birthday = extractFieldValue(input.birthday as FieldValue);
    const notes = extractFieldValue(input.notes as FieldValue);
    const rawContactDocumentTypeId = extractFieldValue(
      input.contact_document_type_id as FieldValue
    );
    const contactDocumentTypeId =
      rawContactDocumentTypeId && rawContactDocumentTypeId.trim() !== ''
        ? rawContactDocumentTypeId
        : null;

    const hasContactDocumentTypeId =
      input.contact_document_type_id !== undefined;
    const hasDocumentField = input.document !== undefined;
    const shouldClearDocument =
      hasContactDocumentTypeId && !contactDocumentTypeId;
    const shouldUpdateDocument =
      shouldClearDocument ||
      (hasDocumentField && normalizedDocumentField !== null);

    const rawUserId = extractFieldValue(input.user_id as FieldValue);
    const userId = this.normalizeUserId(rawUserId);

    const rawIgnore = extractFieldValue(input.ignore as FieldValue);
    const ignore =
      rawIgnore && rawIgnore.trim() !== '' && rawIgnore !== 'null'
        ? rawIgnore
        : null;

    const payload: IUpdateContact = {
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

    if (hasLabelTemplateIds) {
      payload.label_template_ids = labelTemplateIds;
    }

    if (input.user_id !== undefined) {
      payload.user_id = userId;
    }

    if (input.ignore !== undefined) {
      payload.ignore = ignore;
    }

    if (hasContactDocumentTypeId) {
      payload.contact_document_type_id = contactDocumentTypeId;
    }

    if (shouldUpdateDocument) {
      payload.document = shouldClearDocument ? null : documentCEncrypted;
      payload.document_partial = shouldClearDocument
        ? null
        : documentPartialEncrypted;
      payload.document_c = shouldClearDocument ? null : documentC;
    }

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

  getContactDocumentDecrypted = (
    encryptedDocument: string | null | undefined
  ): string | null => {
    if (!encryptedDocument) return null;

    if (typeof encryptedDocument !== 'string') {
      return null;
    }

    if (encryptedDocument.includes('*')) {
      return null;
    }

    const isAESFormat =
      encryptedDocument.includes(':') &&
      encryptedDocument.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedDocument =
        this.passwordEncryptorService.decrypt(encryptedDocument);

      return decryptedDocument;
    } catch {
      return null;
    }
  };

  getContactSensitiveDataDecrypted = async (
    contactId: string
  ): Promise<{
    phone: string | null;
    email: string | null;
    document: string | null;
  } | null> => {
    const sensitiveData =
      await this.contactSensitiveDataRepository.getContactSensitiveDataById(
        contactId
      );
    if (!sensitiveData) return null;

    return {
      phone: this.getContactPhoneDecrypted(sensitiveData.phone),
      email: this.getContactEmailDecrypted(sensitiveData.email),
      document: this.getContactDocumentDecrypted(sensitiveData.document),
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

  listContactUsers = async (
    accountId: string
  ): Promise<ListContactUsersResponse[]> => {
    return this.contactUsersListerRepository.listContactUsers(accountId);
  };

  addContactLabelTemplateIfNotExists = async (
    contactId: string,
    labelTemplateId: string
  ): Promise<boolean> => {
    const exists =
      await this.contactLabelTemplateViewerExistsRepository.existsContactLabelTemplate(
        contactId,
        labelTemplateId
      );

    if (exists) {
      return true;
    }

    const result =
      await this.contactLabelTemplateCreatorRepository.createContactLabelTemplateWithoutTransaction(
        contactId,
        labelTemplateId
      );

    return result !== null;
  };

  removeContactLabelTemplate = async (
    contactId: string,
    labelTemplateId: string
  ): Promise<boolean> => {
    return this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplateByContactIdAndLabelTemplateId(
      contactId,
      labelTemplateId
    );
  };
}
