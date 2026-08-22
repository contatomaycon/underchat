import { injectable, inject } from 'tsyringe';
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
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { ContactUpdaterRepository } from '@core/repositories/contact/ContactUpdater.repository';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { ContactPhoneValidationPolicyService } from '@core/services/contactPhoneValidationPolicy.service';
import {
  CONTACT_VALIDATION_ORIGINS,
  type ContactValidationOrigin,
} from '@core/common/types/ContactValidationOrigin';

function stringifyContactUpdateMutationPayload(
  payload: Record<string, unknown>
): string {
  const visited = new WeakSet<object>();

  return JSON.stringify(payload, (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    if (!Array.isArray(value) && 'value' in value && 'fields' in value) {
      return (value as { value: unknown }).value;
    }

    if (visited.has(value)) {
      return undefined;
    }

    visited.add(value);
    return value;
  });
}

export function buildContactUpdateWebhookMutationId(
  contactId: string,
  revision: string,
  bodyToUpdate: UpdateContactRequest
): string {
  const {
    photo: photoUpload,
    image_url: rawImageUrl,
    ...scalarUpdate
  } = bodyToUpdate;
  return createHash('sha256')
    .update(
      [
        contactId,
        revision,
        stringifyContactUpdateMutationPayload({
          ...scalarUpdate,
          image_url: extractFieldValue(rawImageUrl as FieldValue),
          // Multipart streams may be circular and must never be traversed.
          // A unique token also separates uploads on the same row revision.
          photo_upload_operation: photoUpload ? uuidv7() : null,
        }),
      ].join('\u001f')
    )
    .digest('hex');
}

@injectable()
export class ContactUpdaterUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(LabelTemplateService)
    private readonly labelTemplateService: LabelTemplateService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PhoneValidationService)
    private readonly phoneValidationService: PhoneValidationService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ContactUpdaterRepository)
    private readonly contactUpdaterRepository: ContactUpdaterRepository,
    @inject(ContactPhoneValidationPolicyService)
    private readonly contactPhoneValidationPolicyService: Pick<
      ContactPhoneValidationPolicyService,
      'resolve'
    > = {
      resolve: async () => ({
        channelIds: [],
        isOfficialOnly: false,
        areAllChannelsResolved: true,
      }),
    }
  ) {}

  private handlePhoneValidationError(
    error: unknown
  ): { shouldSkipValidation: boolean } | never {
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (
        errorMessage.includes('timeout') ||
        errorMessage.includes('deadline exceeded') ||
        errorMessage.includes('no active worker') ||
        errorMessage.includes('no active worker found') ||
        errorMessage.includes('unavailable') ||
        errorMessage.includes('disconnected') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('not connected')
      ) {
        return { shouldSkipValidation: true };
      }
    }

    throw error;
  }

  private normalizePhoneDigits(
    value: string | null | undefined
  ): string | null {
    if (!value) {
      return null;
    }

    const digits = onlyDigits(value);
    return digits || null;
  }

  private normalizePhoneDdi(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const digits = onlyDigits(value);
    return digits || null;
  }

  private async validateAndNormalizePhone(
    t: TFunction<'translation', undefined>,
    accountId: string,
    phone: string,
    phoneDdi: string | null | undefined,
    isOfficialOnly: boolean
  ): Promise<{
    phone: string;
    phoneDdi: string | null;
    isValidated: boolean;
    validationOrigin: ContactValidationOrigin | null;
  }> {
    if (isOfficialOnly) {
      return {
        phone,
        phoneDdi: phoneDdi ?? null,
        isValidated: true,
        validationOrigin: CONTACT_VALIDATION_ORIGINS.officialAssumed,
      };
    }

    try {
      const validationResult = await this.phoneValidationService.validatePhone(
        accountId,
        phone,
        phoneDdi,
        undefined,
        { bypassCache: true }
      );

      if (!validationResult.valid) {
        throw new Error(t('phone_number_not_valid_on_whatsapp'));
      }

      if (!validationResult.phone) {
        return {
          phone,
          phoneDdi: phoneDdi ?? null,
          isValidated: true,
          validationOrigin: CONTACT_VALIDATION_ORIGINS.whatsappLookup,
        };
      }

      const normalizedPhone = extractPhoneAndDdi(validationResult.phone);
      if (normalizedPhone) {
        return {
          phone: normalizedPhone.phone,
          phoneDdi: normalizedPhone.phone_ddi,
          isValidated: true,
          validationOrigin: CONTACT_VALIDATION_ORIGINS.whatsappLookup,
        };
      }

      return {
        phone,
        phoneDdi: phoneDdi ?? null,
        isValidated: true,
        validationOrigin: CONTACT_VALIDATION_ORIGINS.whatsappLookup,
      };
    } catch (error) {
      const validationResult = this.handlePhoneValidationError(error);
      if (validationResult.shouldSkipValidation) {
        return {
          phone,
          phoneDdi: phoneDdi ?? null,
          isValidated: false,
          validationOrigin: null,
        };
      }

      throw error;
    }
  }

  private async validatePhone(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    phone?: string | null,
    phoneDdi?: string | null,
    isOfficialOnly: boolean = false
  ): Promise<
    | {
        phone: string;
        phoneDdi: string | null;
        isValidated: boolean;
        validationOrigin: ContactValidationOrigin | null;
      }
    | undefined
  > {
    const normalizedPhone = this.normalizePhoneDigits(phone);
    const normalizedPhoneDdi = this.normalizePhoneDdi(phoneDdi);

    if (!normalizedPhone && !normalizedPhoneDdi) return;

    if (!normalizedPhoneDdi) {
      throw new Error(t('phone_ddi_required'));
    }

    const currentContact = await this.contactService.viewContactById(
      contactId,
      accountId
    );

    const currentDdi = this.normalizePhoneDdi(currentContact?.phone_ddi);
    const ddiChanged = normalizedPhoneDdi !== currentDdi;

    let currentPhoneDecrypted: string | null = null;

    if (currentContact?.phone) {
      currentPhoneDecrypted = this.normalizePhoneDigits(
        this.contactService.getContactPhoneDecrypted(currentContact.phone)
      );
    }

    const phoneChanged =
      normalizedPhone !== null && normalizedPhone !== currentPhoneDecrypted;

    const hasPhoneChange = phoneChanged || ddiChanged;

    if (!hasPhoneChange) {
      return;
    }

    if (!normalizedPhone && ddiChanged) {
      return;
    }

    let phoneToValidate = normalizedPhone;

    if (!phoneToValidate) {
      if (!currentPhoneDecrypted) {
        throw new Error(t('phone_required_when_ddi_provided'));
      }

      phoneToValidate = currentPhoneDecrypted;
    }

    const phones = buildCandidatesWithDdi(phoneToValidate, normalizedPhoneDdi);
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    await this.validatePhoneDuplicateContact(t, phonesC, accountId, contactId);

    try {
      const normalized = await this.validateAndNormalizePhone(
        t,
        accountId,
        phoneToValidate,
        normalizedPhoneDdi,
        isOfficialOnly
      );

      return normalized;
    } catch (error) {
      const validationResult = this.handlePhoneValidationError(error);
      if (validationResult.shouldSkipValidation) {
        return {
          phone: phoneToValidate,
          phoneDdi: normalizedPhoneDdi,
          isValidated: false,
          validationOrigin: null,
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
    allowedChannelIds: string[] = [],
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    const normalizedBody = normalizeContactRequest(body);

    const previousContact = await this.contactService.getContactById(
      contactId,
      accountId
    );

    if (!previousContact) {
      throw new Error(t('contact_not_found'));
    }

    const contactMutationRevision =
      await this.contactUpdaterRepository.viewContactMutationRevision(
        contactId,
        accountId
      );
    if (!contactMutationRevision) {
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
    const phoneDdi = this.normalizePhoneDdi(
      extractFieldValue(normalizedBody.phone_ddi as FieldValue)
    );
    const phone = this.normalizePhoneDigits(
      extractFieldValue(normalizedBody.phone as FieldValue)
    );
    const hasNickname = normalizedBody.nickname !== undefined;
    const nickname = hasNickname
      ? extractFieldValue(normalizedBody.nickname as FieldValue)
      : undefined;
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

    const validationPolicy =
      await this.contactPhoneValidationPolicyService.resolve({
        accountId,
        contactId,
        requestedChannelIds: hasChannelIds ? (channelIds ?? []) : undefined,
      });

    const [normalizedPhone] = await Promise.all([
      this.validatePhone(
        t,
        accountId,
        contactId,
        phone,
        phoneDdi,
        validationPolicy.isOfficialOnly
      ),
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
      birthday,
      notes,
      photo: normalizedBody.photo,
      image_url: normalizedBody.image_url,
      user_id: normalizedBody.user_id,
      ignore: normalizedBody.ignore,
    };

    if (hasNickname) {
      bodyToUpdate.nickname = nickname;
    }

    if (hasContactDocumentTypeId) {
      bodyToUpdate.contact_document_type_id = contactDocumentTypeId;
    }

    if (shouldUpdateDocument) {
      bodyToUpdate.document = shouldClearDocument ? null : document;
    }

    const mutationId = buildContactUpdateWebhookMutationId(
      contactId,
      contactMutationRevision.revision,
      bodyToUpdate
    );

    const validationState = normalizedPhone
      ? {
          isValidated: normalizedPhone.isValidated,
          origin: normalizedPhone.validationOrigin,
        }
      : previousContact.is_valided !== true && validationPolicy.isOfficialOnly
        ? {
            isValidated: true,
            origin: CONTACT_VALIDATION_ORIGINS.officialAssumed,
          }
        : undefined;

    const contactUpdater = await this.contactService.updateContactById(
      bodyToUpdate,
      contactId,
      accountId,
      {
        source: webhookSource,
        idempotencyKey: `contact-updated:${contactId}:${mutationId}`,
        actor: actorUserId
          ? { type: 'user', id: actorUserId }
          : { type: 'system' },
        changes: { origin: webhookSource },
      },
      validationState
    );

    if (!contactUpdater) {
      throw new Error(t('contact_update_error'));
    }

    const chatId = extractFieldValue(normalizedBody.chat_id as FieldValue);

    if (chatId) {
      await this.updateSpecificChatWithContactData(
        accountId,
        chatId,
        contactId,
        mutationId
      );
    } else {
      await this.updateChatsWithContactData(accountId, contactId, mutationId);
    }

    return true;
  }

  private async updateSpecificChatWithContactData(
    accountId: string,
    chatId: string,
    contactId: string,
    mutationId: string
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

    const saved = await this.chatService.saveChat(updatedChat, {
      outboundWebhook: {
        eventTypes: ['chat.updated'],
        idempotencyKey: `chat-contact-updated:${chat.chat_id}:${contactId}:${mutationId}`,
        source: 'contact_service',
        previousChat: chat,
        actor: { type: 'system' },
        changes: { contact_id: contactId },
      },
    });

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
    contactId: string,
    mutationId: string
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

      const labelsChanged =
        JSON.stringify(chat.label ?? []) !==
        JSON.stringify(contactLabels ?? []);
      const saved = await this.chatService.saveChat(updatedChat, {
        outboundWebhook: {
          eventTypes: [
            'chat.updated',
            ...(labelsChanged ? (['chat.labels.changed'] as const) : []),
          ],
          idempotencyKey: `chat-contact-updated:${chat.chat_id}:${contactId}:${mutationId}`,
          source: 'contact_service',
          previousChat: chat,
          actor: { type: 'system' },
          changes: {
            contact_id: contactId,
            labels_changed: labelsChanged,
          },
        },
      });

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
