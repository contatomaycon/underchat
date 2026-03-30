import { injectable, inject } from 'tsyringe';
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
import { ContactBulkDeleterRepository } from '@core/repositories/contact/ContactBulkDeleter.repository';
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
import { ContactChannelChannelsListerRepository } from '@core/repositories/contact/ContactChannelChannelsLister.repository';
import { ContactChannelsUpdaterTransactionRepository } from '@core/repositories/contact/ContactChannelsUpdaterTransaction.repository';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';
import { truncateContactName } from '@core/common/functions/truncateContactName';
import { ContactGroupAssignmentCreatorRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentCreator.repository';
import { ContactGroupAssignmentViewerExistsRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentViewerExists.repository';
import type { FieldValue } from '@core/common/interfaces/IFieldValue';
import { repairMojibakeIfSafe } from '@core/common/functions/repairMojibake';
import { onlyDigits } from '@core/common/functions/onlyDigits';

@injectable()
export class ContactService {
  constructor(
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(ContactListerRepository)
    private readonly contactListerRepository: ContactListerRepository,
    @inject(ContactViewerExistsRepository)
    private readonly contactViewerExistsRepository: ContactViewerExistsRepository,
    @inject(ContactCreatorRepository)
    private readonly contactCreatorRepository: ContactCreatorRepository,
    @inject(ContactViewerRepository)
    private readonly contactViewerRepository: ContactViewerRepository,
    @inject(ContactDeleterRepository)
    private readonly contactDeleterRepository: ContactDeleterRepository,
    @inject(ContactBulkDeleterRepository)
    private readonly contactBulkDeleterRepository: ContactBulkDeleterRepository,
    @inject(ContactUpdaterRepository)
    private readonly contactUpdaterRepository: ContactUpdaterRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(ContactSensitiveDataRepository)
    private readonly contactSensitiveDataRepository: ContactSensitiveDataRepository,
    @inject(ContactExistsByEmailAndPhoneRepository)
    private readonly contactExistsByEmailAndPhoneRepository: ContactExistsByEmailAndPhoneRepository,
    @inject(ContactUsersListerRepository)
    private readonly contactUsersListerRepository: ContactUsersListerRepository,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(ContactLabelTemplateViewerExistsRepository)
    private readonly contactLabelTemplateViewerExistsRepository: ContactLabelTemplateViewerExistsRepository,
    @inject(ContactLabelTemplateCreatorRepository)
    private readonly contactLabelTemplateCreatorRepository: ContactLabelTemplateCreatorRepository,
    @inject(ContactLabelTemplateDeleterRepository)
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository,
    @inject(ContactChannelChannelsListerRepository)
    private readonly contactChannelChannelsListerRepository: ContactChannelChannelsListerRepository,
    @inject(ContactChannelsUpdaterTransactionRepository)
    private readonly contactChannelsUpdaterTransactionRepository: ContactChannelsUpdaterTransactionRepository,
    @inject(ContactGroupAssignmentCreatorRepository)
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository,
    @inject(ContactGroupAssignmentViewerExistsRepository)
    private readonly contactGroupAssignmentViewerExistsRepository: ContactGroupAssignmentViewerExistsRepository
  ) {}

  listContactChannelsByContactId = async (
    accountId: string,
    contactId: string
  ): Promise<string[]> => {
    return this.contactChannelChannelsListerRepository.listChannelIdsByContactAndAccount(
      contactId,
      accountId
    );
  };

  updateContactChannels = async (
    contactId: string,
    accountId: string,
    channelIds: string[]
  ): Promise<boolean> => {
    return this.contactChannelsUpdaterTransactionRepository.updateContactChannels(
      contactId,
      accountId,
      channelIds
    );
  };

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

  private extractChannelIds(
    field:
      | string[]
      | Array<{ value: string }>
      | { value: string[] | null }
      | null
      | undefined
  ): string[] {
    return extractArrayFieldValue(field);
  }

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

  private normalizeContactText(
    value: string | null | undefined
  ): string | null | undefined {
    if (typeof value !== 'string') {
      return value;
    }

    return repairMojibakeIfSafe(value);
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
      const encryptedInput = input as ICreateContact;
      const normalizedName =
        this.normalizeContactText(encryptedInput.name) ?? '';
      const normalizedLastName = this.normalizeContactText(
        encryptedInput.last_name
      );
      const normalizedNickname = this.normalizeContactText(
        encryptedInput.nickname
      );
      const normalizedNotes = this.normalizeContactText(encryptedInput.notes);

      return {
        ...encryptedInput,
        name: normalizedName,
        last_name: normalizedLastName,
        nickname: normalizedNickname,
        notes: normalizedNotes,
        photo: photoUrl ?? input.photo,
      };
    }

    const createInput = input as CreateContactRequest;
    const labelTemplateIds = extractArrayFieldValue(
      createInput.label_template_ids
    );
    const channelIds = this.extractChannelIds(createInput.channel_ids);
    const name =
      this.normalizeContactText(
        extractFieldValue(createInput.name as FieldValue)
      ) ?? '';
    const lastName =
      this.normalizeContactText(
        extractFieldValue(createInput.last_name as FieldValue)
      ) ?? '';
    const phoneDdi = extractFieldValue(createInput.phone_ddi as FieldValue);
    const nickname =
      this.normalizeContactText(
        extractFieldValue(createInput.nickname as FieldValue)
      ) ?? '';
    const birthday = extractFieldValue(createInput.birthday as FieldValue);
    const notes =
      this.normalizeContactText(
        extractFieldValue(createInput.notes as FieldValue)
      ) ?? '';
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
      channel_ids: channelIds.length > 0 ? channelIds : undefined,
      label_template_ids: labelTemplateIds,
      contact_document_type_id: contactDocumentTypeId,
      is_valided: isValidated,
      name,
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

  deleteContactsByIds = async (contactIds: string[]): Promise<number> => {
    return this.contactBulkDeleterRepository.deleteContactsByIds(contactIds);
  };

  private determineIsValided(
    currentContact: (ViewContactResponse & { phone: string }) | null,
    newPhoneEncrypted: string | null,
    newPhoneDdi: string | null | undefined,
    newPhone: string | null | undefined
  ): boolean {
    const normalizePhoneDdi = (
      value: string | null | undefined
    ): string | null => {
      if (!value) {
        return null;
      }
      const digits = onlyDigits(value);
      return digits || null;
    };

    const hasValue = (value: string | null | undefined): boolean =>
      typeof value === 'string' && value.trim() !== '';

    if (!currentContact) return hasValue(newPhone) && hasValue(newPhoneDdi);

    const currentIsValided = currentContact.is_valided ?? false;
    const hasIncomingPhone = hasValue(newPhone);
    const hasIncomingPhoneDdi = hasValue(newPhoneDdi);

    if (!hasIncomingPhone && !hasIncomingPhoneDdi) {
      return currentIsValided;
    }

    const currentPhoneDdiNormalized = normalizePhoneDdi(
      currentContact.phone_ddi
    );
    const incomingPhoneDdiNormalized = normalizePhoneDdi(newPhoneDdi);

    const ddiChanged =
      hasIncomingPhoneDdi &&
      incomingPhoneDdiNormalized !== currentPhoneDdiNormalized;
    const phoneChanged =
      hasIncomingPhone && newPhoneEncrypted !== currentContact.phone;

    if (!phoneChanged && !ddiChanged) {
      return currentIsValided;
    }

    // Keep current validation state when only DDI was sent without phone update.
    if (!hasIncomingPhone && ddiChanged) {
      return currentIsValided;
    }

    const effectivePhoneEncrypted =
      newPhoneEncrypted ?? currentContact.phone ?? null;
    const effectivePhoneDdi = hasIncomingPhoneDdi
      ? incomingPhoneDdiNormalized
      : currentPhoneDdiNormalized;

    return !!(effectivePhoneEncrypted && effectivePhoneDdi);
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

    const normalizePhoneDdi = (
      value: string | null | undefined
    ): string | null => {
      if (!value) {
        return null;
      }
      const digits = onlyDigits(value);
      return digits || null;
    };

    const rawPhoneField = extractFieldValue(input.phone as FieldValue);
    const phoneField = rawPhoneField ? onlyDigits(rawPhoneField) || null : null;
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

    const phoneDdiField = normalizePhoneDdi(
      extractFieldValue(input.phone_ddi as FieldValue)
    );
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
    const hasChannelIds = input.channel_ids !== undefined;
    const channelIds = hasChannelIds
      ? this.extractChannelIds(input.channel_ids)
      : null;
    const name = this.normalizeContactText(
      extractFieldValue(input.name as FieldValue)
    );
    const lastName = this.normalizeContactText(
      extractFieldValue(input.last_name as FieldValue)
    );
    const nickname = this.normalizeContactText(
      extractFieldValue(input.nickname as FieldValue)
    );
    const birthday = extractFieldValue(input.birthday as FieldValue);
    const notes = this.normalizeContactText(
      extractFieldValue(input.notes as FieldValue)
    );
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
      name: name ?? '',
      last_name: lastName ?? '',
      email: emailCEncrypted,
      email_partial: emailPartialEncrypted,
      email_c: emailC,
      phone_ddi: phoneDdiField,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      phone_c: phoneC,
      nickname: nickname ?? '',
      photo: photoUrl,
      birthday: nullIfEmpty(birthday),
      notes: notes ?? '',
      is_valided: isValided,
    };

    if (hasLabelTemplateIds) {
      payload.label_template_ids = labelTemplateIds;
    }

    if (hasChannelIds) {
      payload.channel_ids = channelIds;
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

    return this.contactUpdaterRepository.updateContactById(
      contactId,
      payload,
      accountId
    );
  };

  updateContactFromImport = async (
    contactId: string,
    accountId: string,
    csvContact: ICreateContact
  ): Promise<boolean> => {
    const currentContact = await this.viewContactById(contactId, accountId);
    if (!currentContact) {
      return false;
    }

    const payload: IUpdateContact = {
      is_valided: currentContact.is_valided ?? false,
    };

    const normalizedCsvName = this.normalizeContactText(csvContact.name);
    const nameValue =
      truncateContactName(normalizedCsvName) ?? normalizedCsvName?.trim();
    if (nameValue) {
      payload.name = nameValue;
    }

    const normalizedCsvLastName = this.normalizeContactText(
      csvContact.last_name
    );
    const lastNameValue =
      truncateContactName(normalizedCsvLastName) ??
      normalizedCsvLastName?.trim();
    if (lastNameValue) {
      payload.last_name = lastNameValue;
    }

    const normalizedCsvNickname = this.normalizeContactText(
      csvContact.nickname
    );
    const nicknameValue =
      truncateContactName(normalizedCsvNickname) ??
      normalizedCsvNickname?.trim();
    if (nicknameValue) {
      payload.nickname = nicknameValue;
    }

    const emailValue = csvContact.email ?? csvContact.email_partial ?? null;
    if (emailValue && typeof emailValue === 'string' && emailValue.trim()) {
      const emailFields = this.processEmailFields(
        { ...csvContact, email: emailValue },
        !!csvContact.email_c
      );
      payload.email = emailFields.emailCEncrypted;
      payload.email_partial = emailFields.emailPartialEncrypted;
      payload.email_c = emailFields.emailC;
    }

    const notesValue = this.normalizeContactText(csvContact.notes);
    if (notesValue && typeof notesValue === 'string' && notesValue.trim()) {
      payload.notes = notesValue.trim();
    }

    const birthdayValue = csvContact.birthday;
    if (
      birthdayValue &&
      typeof birthdayValue === 'string' &&
      birthdayValue.trim()
    ) {
      payload.birthday = birthdayValue.trim();
    }

    if (
      csvContact.document !== undefined &&
      csvContact.document !== null &&
      typeof csvContact.document === 'string' &&
      csvContact.document.trim()
    ) {
      const documentFields = this.processDocumentFields(
        { ...csvContact, document: csvContact.document },
        !!csvContact.document_c
      );
      payload.contact_document_type_id =
        csvContact.contact_document_type_id ?? null;
      payload.document = documentFields.documentCEncrypted;
      payload.document_partial = documentFields.documentPartialEncrypted;
      payload.document_c = documentFields.documentC;
    }

    const result = await this.contactUpdaterRepository.updateContactById(
      contactId,
      payload,
      accountId
    );

    return result === true;
  };

  addContactToGroupIfNotExists = async (
    contactId: string,
    contactGroupId: string
  ): Promise<boolean> => {
    if (!contactGroupId?.trim()) {
      return true;
    }

    const exists =
      await this.contactGroupAssignmentViewerExistsRepository.existsContactGroupAssignmentByContactAndGroup(
        contactGroupId,
        contactId
      );

    if (exists) {
      return true;
    }

    const assignmentId =
      await this.contactGroupAssignmentCreatorRepository.createContactGroupAssignmentDirectly(
        contactGroupId,
        contactId
      );

    return assignmentId !== null;
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
