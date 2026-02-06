import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { EncryptService } from '@core/services/encrypt.service';
import moment from 'moment';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';
import { normalizeContactRequest } from '@core/common/functions/normalizeContactRequest';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';
import type { FieldValue } from '@core/common/interfaces/IFieldValue';

@injectable()
export class ContactUpdaterUseCase {
  constructor(
    private readonly contactService: ContactService,
    private readonly labelTemplateService: LabelTemplateService,
    private readonly encryptService: EncryptService,
    private readonly phoneValidationService: PhoneValidationService,
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService
  ) {}

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

  private async validatePhone(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    phone?: string | null,
    phoneDdi?: string | null
  ): Promise<
    { phone: string; phoneDdi: string | null; isValidated: boolean } | undefined
  > {
    if (!phone && !phoneDdi) return;

    if (!phoneDdi) {
      throw new Error(t('phone_ddi_required'));
    }

    const currentContact = await this.contactService.viewContactById(
      contactId,
      accountId
    );

    const currentDdi = currentContact?.phone_ddi ?? null;
    const newDdi = phoneDdi ?? null;
    const ddiChanged = String(currentDdi) !== String(newDdi);

    let currentPhoneDecrypted: string | null = null;

    if (currentContact?.phone) {
      currentPhoneDecrypted = this.contactService.getContactPhoneDecrypted(
        currentContact.phone
      );
    }

    const phoneChanged =
      phone && currentPhoneDecrypted && phone !== currentPhoneDecrypted;

    const hasPhoneChange = phoneChanged || ddiChanged;

    if (!hasPhoneChange) {
      if (!currentPhoneDecrypted) {
        return;
      }

      return {
        phone: currentPhoneDecrypted,
        phoneDdi: phoneDdi,
        isValidated: currentContact?.is_valided ?? false,
      };
    }

    let phoneToValidate = phone;

    if (!phoneToValidate) {
      if (!currentPhoneDecrypted) {
        throw new Error(t('phone_required_when_ddi_provided'));
      }

      phoneToValidate = currentPhoneDecrypted;
    }

    const phones = buildCandidatesWithDdi(phoneToValidate, phoneDdi);
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    await this.validatePhoneDuplicateContact(t, phonesC, accountId, contactId);

    try {
      const normalized = await this.validateAndNormalizePhone(
        t,
        accountId,
        phoneToValidate,
        phoneDdi
      );

      return {
        ...normalized,
        isValidated: true,
      };
    } catch (error) {
      const validationResult = this.handlePhoneValidationError(t, error);
      if (validationResult.shouldSkipValidation) {
        return {
          phone: phoneToValidate,
          phoneDdi: phoneDdi,
          isValidated: false,
        };
      }

      throw error;
    }
  }

  private async validateEmail(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    email?: string | null
  ) {
    if (!email) return;

    const emailC = this.encryptService.encrypt(email);

    await this.validateEmailDuplicateContact(t, emailC, accountId, contactId);
  }

  private validateBirthDate(
    t: TFunction<'translation', undefined>,
    birthDate?: string | null
  ) {
    if (!birthDate) return;
    if (typeof birthDate !== 'string' || birthDate.trim() === '') return;

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

  private async validatePhoneDuplicateContact(
    t: TFunction<'translation', undefined>,
    phonesC: string[],
    accountId: string,
    contactId: string
  ): Promise<void> {
    const phoneExists = await this.contactService.existsContactByPhone(
      accountId,
      phonesC,
      contactId
    );

    if (phoneExists) {
      throw new Error(t('contact_already_exists_phone'));
    }
  }

  private async validateEmailDuplicateContact(
    t: TFunction<'translation', undefined>,
    emailC: string,
    accountId: string,
    contactId: string
  ): Promise<void> {
    const emailExists = await this.contactService.existsContactByEmail(
      accountId,
      emailC,
      contactId
    );

    if (emailExists) {
      throw new Error(t('contact_already_exists_email'));
    }
  }

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

  private async validateLabelTemplates(
    t: TFunction<'translation', undefined>,
    labelTemplateIds?: string[] | null
  ): Promise<void> {
    if (!labelTemplateIds || labelTemplateIds.length === 0) {
      return;
    }

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

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    body: UpdateContactRequest,
    allowedChannelIds: string[] = []
  ): Promise<boolean> {
    const normalizedBody = normalizeContactRequest(body);

    const contactExists =
      await this.contactService.existsContactById(contactId);

    if (!contactExists) {
      throw new Error(t('contact_not_found'));
    }

    const hasLabelTemplateIds = normalizedBody.label_template_ids !== undefined;
    const extractedLabelTemplateIds = hasLabelTemplateIds
      ? extractArrayFieldValue(normalizedBody.label_template_ids)
      : null;
    const labelTemplateIds = hasLabelTemplateIds
      ? (extractedLabelTemplateIds ?? [])
      : null;
    const hasChannelIds = normalizedBody.channel_ids !== undefined;
    const channelIds = hasChannelIds
      ? this.extractChannelIds(normalizedBody.channel_ids)
      : null;
    this.validateChannelIds(t, channelIds ?? [], allowedChannelIds);
    const name = extractFieldValue(normalizedBody.name as FieldValue);
    const lastName = extractFieldValue(normalizedBody.last_name as FieldValue);
    const email = extractFieldValue(normalizedBody.email as FieldValue);
    const phoneDdi = extractFieldValue(normalizedBody.phone_ddi as FieldValue);
    const phone = extractFieldValue(normalizedBody.phone as FieldValue);
    const nickname = extractFieldValue(normalizedBody.nickname as FieldValue);
    const birthday = extractFieldValue(normalizedBody.birthday as FieldValue);
    const notes = extractFieldValue(normalizedBody.notes as FieldValue);
    const hasContactDocumentTypeId =
      normalizedBody.contact_document_type_id !== undefined;
    const rawContactDocumentTypeId = extractFieldValue(
      normalizedBody.contact_document_type_id as FieldValue
    );
    const contactDocumentTypeId =
      rawContactDocumentTypeId && rawContactDocumentTypeId.trim() !== ''
        ? rawContactDocumentTypeId
        : null;
    const hasDocument = normalizedBody.document !== undefined;
    const rawDocument = extractFieldValue(
      normalizedBody.document as FieldValue
    );
    const document =
      rawDocument && rawDocument.trim() !== '' ? rawDocument : null;
    const shouldClearDocument =
      hasContactDocumentTypeId && !contactDocumentTypeId;
    const shouldUpdateDocument =
      shouldClearDocument || (hasDocument && document !== null);

    await this.validateLabelTemplates(t, labelTemplateIds);

    this.validateBirthDate(t, birthday);

    const [normalizedPhone] = await Promise.all([
      this.validatePhone(t, accountId, contactId, phone, phoneDdi),
      this.validateEmail(t, accountId, contactId, email),
    ]);

    const bodyToUpdate: UpdateContactRequest = {
      label_template_ids:
        hasLabelTemplateIds && labelTemplateIds !== null
          ? labelTemplateIds.map((id) => ({ value: id }))
          : undefined,
      channel_ids:
        hasChannelIds && channelIds !== null ? channelIds : undefined,
      name,
      last_name: lastName,
      email,
      phone_ddi: normalizedPhone?.phoneDdi ?? phoneDdi,
      phone: normalizedPhone?.phone ?? phone,
      nickname,
      birthday,
      notes,
      photo: normalizedBody.photo,
      image_url: normalizedBody.image_url,
      user_id: normalizedBody.user_id,
      ignore: normalizedBody.ignore,
    };

    if (hasContactDocumentTypeId) {
      bodyToUpdate.contact_document_type_id = contactDocumentTypeId;
    }

    if (shouldUpdateDocument) {
      bodyToUpdate.document = shouldClearDocument ? null : document;
    }

    const contactUpdater = await this.contactService.updateContactById(
      bodyToUpdate,
      contactId,
      accountId
    );

    if (!contactUpdater) {
      throw new Error(t('contact_update_error'));
    }

    if (normalizedPhone && normalizedPhone.isValidated === false) {
      await this.contactService.updateContactIsValided(contactId, false);
    }

    const chatId = extractFieldValue(normalizedBody.chat_id as FieldValue);

    if (chatId) {
      await this.updateSpecificChatWithContactData(
        accountId,
        chatId,
        contactId
      );
      return true;
    }

    await this.updateChatsWithContactData(accountId, contactId);

    return true;
  }

  private async updateSpecificChatWithContactData(
    accountId: string,
    chatId: string,
    contactId: string
  ): Promise<void> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);

    if (!chat) {
      return;
    }

    const contact = await this.contactService.getContactById(
      contactId,
      accountId
    );

    if (!contact) {
      return;
    }

    const updatedChat: IChat = {
      ...chat,
      contact: {
        id: contact.contact_id,
        name: contact.name,
        phone: contact.phone_partial ?? chat.phone ?? '',
        phone_ddi: contact.phone_ddi ?? chat.contact?.phone_ddi ?? null,
        photo: contact.photo ?? null,
      },
    };

    const saved = await this.chatService.saveChat(updatedChat);

    if (!saved) {
      return;
    }

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

  private async updateChatsWithContactData(
    accountId: string,
    contactId: string
  ): Promise<void> {
    const updatedContact = await this.contactService.getContactById(
      contactId,
      accountId
    );

    if (!updatedContact) {
      return;
    }

    const chats = await this.chatService.findChatsByContactId(
      accountId,
      contactId
    );

    if (chats.length === 0) {
      return;
    }

    const contactLabels =
      updatedContact.label_templates?.map((label) => ({
        label_template_id: label.label_template_id,
        label: label.label,
        color: label.color,
      })) ?? null;

    const updatePromises = chats.map(async (chat) => {
      const responsibleAttendant = updatedContact.user
        ? {
            id: updatedContact.user.user_id,
            name: updatedContact.user.name ?? '',
            photo: updatedContact.user.photo ?? null,
          }
        : (chat.contact?.responsible_attendant ?? null);

      const updatedChat: IChat = {
        ...chat,
        contact: {
          id: updatedContact.contact_id,
          name: updatedContact.name,
          phone: updatedContact.phone_partial ?? chat.phone ?? '',
          phone_ddi:
            updatedContact.phone_ddi ?? chat.contact?.phone_ddi ?? null,
          photo: updatedContact?.photo ?? undefined,
          responsible_attendant: responsibleAttendant,
          ignore: updatedContact.ignore ?? chat.contact?.ignore ?? null,
        },
        label: contactLabels,
      };

      const saved = await this.chatService.saveChat(updatedChat);

      if (!saved) {
        return null;
      }

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

      return updatedChat;
    });

    await Promise.all(updatePromises);
  }
}
