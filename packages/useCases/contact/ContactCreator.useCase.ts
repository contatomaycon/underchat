import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import { EncryptService } from '@core/services/encrypt.service';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import moment from 'moment';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';
import { PlanAccountService } from '@core/services/planAccount.service';
import { normalizeContactRequest } from '@core/common/functions/normalizeContactRequest';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';
import type { FieldValue } from '@core/common/interfaces/IFieldValue';

@injectable()
export class ContactCreatorUseCase {
  constructor(
    @inject(LabelTemplateService)
    private readonly labelTemplateService: LabelTemplateService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PhoneValidationService)
    private readonly phoneValidationService: PhoneValidationService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService
  ) {}

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

  private validateChannelIds(
    t: TFunction<'translation', undefined>,
    channelIds: string[],
    allowedChannelIds: string[]
  ): void {
    if (channelIds.length === 0 || allowedChannelIds.length === 0) {
      return;
    }

    const allowedSet = new Set(allowedChannelIds);
    for (const channelId of channelIds) {
      if (!allowedSet.has(channelId)) {
        throw new Error(t('contact_channel_not_allowed'));
      }
    }
  }

  private validateBirthDate(
    t: TFunction<'translation', undefined>,
    birthDate: string
  ) {
    if (!moment(birthDate, 'YYYY-MM-DD', true).isValid()) {
      throw new Error(t('date_must_be_in_the_format_yyyy_mm_dd'));
    }

    const birth = moment(birthDate, 'YYYY-MM-DD');
    const minDate = moment('1900-01-01', 'YYYY-MM-DD');
    const today = moment().startOf('day');

    if (birth.isBefore(minDate)) {
      throw new Error(t('date_must_be_greater_than_1900_01_01'));
    }

    if (!birth.isBefore(today)) {
      throw new Error(t('date_must_be_less_than_today'));
    }
  }

  private async validateAccountAndLabelTemplates(
    t: TFunction<'translation', undefined>,
    accountId: string,
    labelTemplateIds?: string[] | null
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    if (labelTemplateIds && labelTemplateIds.length > 0) {
      const existingLabelTemplateIds =
        await this.labelTemplateService.existsLabelTemplatesByIds(
          labelTemplateIds
        );

      for (const id of labelTemplateIds) {
        if (!existingLabelTemplateIds.has(id)) {
          throw new Error(t('label_template_not_found'));
        }
      }
    }
  }

  private validateBirthdayIfPresent(
    t: TFunction<'translation', undefined>,
    birthday?: string | null
  ): void {
    if (!birthday || typeof birthday !== 'string' || birthday.trim() === '') {
      return;
    }

    this.validateBirthDate(t, birthday);
  }

  private encryptContactData(
    phone: string | null,
    phoneDdi: string | null,
    email: string | null
  ): {
    emailC: string | null;
    phonesC: string[];
  } {
    const phones =
      phone && phoneDdi ? buildCandidatesWithDdi(phone, phoneDdi) : [];
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    return {
      emailC: email ? this.encryptService.encrypt(email) : null,
      phonesC: phone ? phonesC : [],
    };
  }

  private async checkContactExistence(
    accountId: string,
    emailC: string | null,
    phonesC: string[]
  ): Promise<{ emailExists: boolean; phoneExists: boolean }> {
    const [emailExists, phoneExists] = await Promise.all([
      emailC
        ? this.contactService.existsContactByEmail(accountId, emailC)
        : Promise.resolve(false),
      phonesC && phonesC.length > 0
        ? this.contactService.existsContactByPhone(accountId, phonesC)
        : Promise.resolve(false),
    ]);

    return { emailExists, phoneExists };
  }

  private validateContactNotExists(
    t: TFunction<'translation', undefined>,
    emailExists: boolean,
    phoneExists: boolean
  ): void {
    if (emailExists) {
      throw new Error(t('contact_already_exists_email'));
    }

    if (phoneExists) {
      throw new Error(t('contact_already_exists_phone'));
    }
  }

  private handlePhoneValidationError(
    t: TFunction<'translation', undefined>,
    error: unknown
  ): { shouldSkipValidation: boolean } | never {
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes('timeout')) {
        throw new Error(t('phone_validation_timeout'));
      }
      if (
        errorMessage.includes('no active worker') ||
        errorMessage.includes('no active worker found')
      ) {
        return { shouldSkipValidation: true };
      }
    }

    throw error;
  }

  private async validateAndNormalizePhone(
    t: TFunction<'translation', undefined>,
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): Promise<{ phone: string; phoneDdi: string | null; isValidated: boolean }> {
    try {
      const validationResult = await this.phoneValidationService.validatePhone(
        accountId,
        phone,
        phoneDdi
      );

      if (!validationResult.valid) {
        throw new Error(t('phone_number_not_valid_on_whatsapp'));
      }

      if (!validationResult.phone) {
        return { phone, phoneDdi: phoneDdi ?? null, isValidated: true };
      }

      const normalizedPhone = extractPhoneAndDdi(validationResult.phone);
      if (normalizedPhone) {
        return {
          phone: normalizedPhone.phone,
          phoneDdi: normalizedPhone.phone_ddi,
          isValidated: true,
        };
      }

      return { phone, phoneDdi: phoneDdi ?? null, isValidated: true };
    } catch (error) {
      const validationResult = this.handlePhoneValidationError(t, error);
      if (validationResult.shouldSkipValidation) {
        return { phone, phoneDdi: phoneDdi ?? null, isValidated: false };
      }

      throw error;
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateContactRequest,
    accountId: string,
    allowedChannelIds: string[] = []
  ): Promise<boolean> {
    const normalizedInput = normalizeContactRequest(input);

    const labelTemplateIds = extractArrayFieldValue(
      normalizedInput.label_template_ids
    );
    const channelIds = this.extractChannelIds(normalizedInput.channel_ids);
    this.validateChannelIds(t, channelIds, allowedChannelIds);
    const name = extractFieldValue(normalizedInput.name as FieldValue);
    const lastName = extractFieldValue(normalizedInput.last_name as FieldValue);
    const email = extractFieldValue(normalizedInput.email as FieldValue);
    const phoneDdi = extractFieldValue(normalizedInput.phone_ddi as FieldValue);
    const phone = extractFieldValue(normalizedInput.phone as FieldValue);
    const nickname = extractFieldValue(normalizedInput.nickname as FieldValue);
    const birthday = extractFieldValue(normalizedInput.birthday as FieldValue);
    const notes = extractFieldValue(normalizedInput.notes as FieldValue);

    if (!name) {
      throw new Error(t('name_required'));
    }

    if (!phoneDdi) {
      throw new Error(t('phone_ddi_required'));
    }

    if (!phone) {
      throw new Error(t('phone_required'));
    }

    await this.validateAccountAndLabelTemplates(t, accountId, labelTemplateIds);
    await this.planAccountService.validateCanCreateContact(t, accountId);

    this.validateBirthdayIfPresent(t, birthday);

    const { emailC, phonesC } = this.encryptContactData(phone, phoneDdi, email);

    const { emailExists, phoneExists } = await this.checkContactExistence(
      accountId,
      emailC,
      phonesC
    );

    this.validateContactNotExists(t, emailExists, phoneExists);

    let phoneToSave = phone;
    let phoneDdiToSave = phoneDdi;
    let isValidated = true;

    if (phone) {
      const normalized = await this.validateAndNormalizePhone(
        t,
        accountId,
        phone,
        phoneDdi
      );

      phoneToSave = normalized.phone;
      phoneDdiToSave = normalized.phoneDdi ?? '55';
      isValidated = normalized.isValidated;
    }

    const rawContactDocumentTypeId = extractFieldValue(
      normalizedInput.contact_document_type_id as FieldValue
    );
    const contactDocumentTypeId =
      rawContactDocumentTypeId && rawContactDocumentTypeId.trim() !== ''
        ? rawContactDocumentTypeId
        : null;
    const rawDocument = extractFieldValue(
      normalizedInput.document as FieldValue
    );
    const document =
      contactDocumentTypeId && rawDocument && rawDocument.trim() !== ''
        ? rawDocument
        : null;

    const contactToCreate: CreateContactRequest = {
      label_template_ids: labelTemplateIds
        ? labelTemplateIds.map((id) => ({ value: id }))
        : undefined,
      channel_ids: channelIds.length > 0 ? channelIds : undefined,
      name,
      last_name: lastName,
      email,
      phone_ddi: phoneDdiToSave,
      phone: phoneToSave,
      nickname,
      birthday,
      notes,
      contact_document_type_id: contactDocumentTypeId,
      document,
      photo: normalizedInput.photo,
      image_url: normalizedInput.image_url,
      user_id: normalizedInput.user_id,
      ignore: normalizedInput.ignore,
    };

    const contactId = await this.contactService.createContact(
      contactToCreate,
      accountId,
      isValidated
    );

    if (!contactId) {
      throw new Error(t('contact_creation_failed'));
    }

    const chatId = extractFieldValue(normalizedInput.chat_id as FieldValue);

    if (chatId) {
      await this.updateChatWithContactData(
        accountId,
        chatId,
        contactId,
        phoneToSave,
        phoneDdiToSave
      );
    }

    return true;
  }

  private async updateChatWithContactData(
    accountId: string,
    chatId: string,
    contactId: string,
    phone: string,
    phoneDdi: string
  ): Promise<void> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) return;

    const contact = await this.contactService.getContactById(
      contactId,
      accountId
    );
    if (!contact) return;

    const contactLabels =
      contact.label_templates?.map((label) => ({
        label_template_id: label.label_template_id,
        label: label.label,
        color: label.color,
      })) ?? null;

    const responsibleAttendant = contact.user
      ? {
          id: contact.user.user_id,
          name: contact.user.name ?? '',
          photo: contact.user.photo ?? null,
        }
      : (chat.contact?.responsible_attendant ?? null);

    const updatedChat: IChat = {
      ...chat,
      contact: {
        id: contact.contact_id,
        name: contact.name,
        phone: contact.phone_partial ?? phone ?? chat.phone ?? '',
        phone_ddi:
          contact.phone_ddi ?? phoneDdi ?? chat.contact?.phone_ddi ?? null,
        photo: contact.photo ?? null,
        responsible_attendant: responsibleAttendant,
        ignore: contact.ignore ?? chat.contact?.ignore ?? null,
      },
      label: contactLabels,
    };

    const saved = await this.chatService.saveChat(updatedChat);
    if (!saved) return;

    const channelAccountId = updatedChat.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);
  }
}
