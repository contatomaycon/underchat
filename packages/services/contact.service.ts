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
import { ContactLabelTemplateCreatorRepository } from '@core/repositories/contact/ContactLabelTemplateCreator.repository';
import { ContactLabelTemplateDeleterRepository } from '@core/repositories/contact/ContactLabelTemplateDeleter.repository';
import { ContactChannelChannelsListerRepository } from '@core/repositories/contact/ContactChannelChannelsLister.repository';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';
import { truncateContactName } from '@core/common/functions/truncateContactName';
import { ContactGroupAssignmentCreatorRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentCreator.repository';
import type { FieldValue } from '@core/common/interfaces/IFieldValue';
import { repairMojibakeIfSafe } from '@core/common/functions/repairMojibake';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { EContactDocumentType } from '@core/common/enums/EContactDocumentType';
import {
  isCnpjFormat,
  normalizeCnpj,
} from '@core/common/functions/validateCnpj';
import { v7 as uuidv7 } from 'uuid';
import {
  normalizeOutboundWebhookChannelIds,
  serializePublicContact,
  sanitizeOutboundWebhookContactChanges,
  type OutboundWebhookActor,
  type OutboundWebhookJsonValue,
} from '@core/common/functions/outboundWebhookPayload';
import {
  buildOutboundWebhookIdempotencyKey,
  OutboundWebhookEventService,
  type PreparedOutboundWebhookEvent,
} from '@core/services/outboundWebhookEvent.service';
import type { ContactOutboundWebhookMarker } from '@core/repositories/contact/contactOutboundWebhookOutbox';
import {
  StaleWhatsappRuntimeDatabaseFenceError,
  type WhatsappRuntimeDatabaseFence,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';
import type { ContactValidationOrigin } from '@core/common/types/ContactValidationOrigin';

export interface ContactValidationStateMutation {
  isValidated: boolean;
  origin: ContactValidationOrigin | null;
}

export interface ContactOutboundWebhookMutation {
  source: string;
  idempotencyKey: string;
  originChannelId?: string;
  actor?: OutboundWebhookActor | null;
  changes?: Record<string, unknown>;
  runtimeFence?: WhatsappRuntimeDatabaseFence;
}

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
    @inject(ContactLabelTemplateCreatorRepository)
    private readonly contactLabelTemplateCreatorRepository: ContactLabelTemplateCreatorRepository,
    @inject(ContactLabelTemplateDeleterRepository)
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository,
    @inject(ContactChannelChannelsListerRepository)
    private readonly contactChannelChannelsListerRepository: ContactChannelChannelsListerRepository,
    @inject(ContactGroupAssignmentCreatorRepository)
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository,
    @inject(OutboundWebhookEventService)
    private readonly outboundWebhookEventService: OutboundWebhookEventService | null = null
  ) {}

  private scopeContactWebhookMutation(
    mutation: ContactOutboundWebhookMutation | undefined,
    durableOperationId: string
  ): ContactOutboundWebhookMutation | undefined {
    if (!mutation) return undefined;
    return {
      ...mutation,
      idempotencyKey: `${mutation.idempotencyKey}:${durableOperationId}`,
    };
  }

  private buildContactWebhookMarker(
    prepared: PreparedOutboundWebhookEvent | null,
    accountId: string
  ): ContactOutboundWebhookMarker | null {
    if (!prepared || prepared.state !== 'preparing') return null;
    return {
      eventId: prepared.eventId,
      accountId,
      envelope: prepared.envelope,
    };
  }

  private resolveContactWebhookChannelIds(
    previousContact?: Record<string, unknown> | null,
    intendedContact?: Record<string, unknown> | null,
    originChannelId?: string
  ): string[] {
    const channelIds: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        channelIds.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collect);
        return;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        collect((value as { value?: unknown }).value);
      }
    };

    collect(previousContact?.channel_ids);
    collect(intendedContact?.channel_ids);
    collect(originChannelId);
    return channelIds.length > 0
      ? normalizeOutboundWebhookChannelIds(channelIds)
      : [];
  }

  private executeContactMutation = async <T>(input: {
    prepared: PreparedOutboundWebhookEvent | null;
    accountId: string;
    replayValue: T;
    operation: () => Promise<T>;
  }): Promise<T> => {
    if (
      input.prepared?.state === 'ready' ||
      input.prepared?.state === 'discarded'
    ) {
      return input.replayValue;
    }

    try {
      return await input.operation();
    } catch (error: unknown) {
      if (
        input.prepared &&
        error instanceof StaleWhatsappRuntimeDatabaseFenceError
      ) {
        await this.outboundWebhookEventService?.cancel(input.prepared.eventId);
      }
      if (
        input.prepared &&
        error instanceof Error &&
        error.message === 'outbound_webhook_event_domain_already_applied'
      ) {
        await this.outboundWebhookEventService?.completePersistedBestEffort({
          eventId: input.prepared.eventId,
          accountId: input.accountId,
        });
        return input.replayValue;
      }
      throw error;
    }
  };

  private resolveRuntimeScopedContactAccountId(
    accountId: string | undefined,
    mutation: ContactOutboundWebhookMutation | undefined
  ): string | undefined {
    const normalizedAccountId = accountId?.trim() || undefined;
    if (!mutation?.runtimeFence) {
      return normalizedAccountId;
    }

    const runtimeAccountId =
      mutation.runtimeFence.account_id?.trim() || undefined;
    if (
      !runtimeAccountId ||
      (normalizedAccountId && normalizedAccountId !== runtimeAccountId)
    ) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }

    return runtimeAccountId;
  }

  private prepareContactWebhookEvent = async (input: {
    accountId: string;
    contactId: string;
    eventType: 'contact.created' | 'contact.updated';
    previousContact?: Record<string, unknown> | null;
    intendedContact?: Record<string, unknown> | null;
    mutation?: ContactOutboundWebhookMutation;
  }): Promise<PreparedOutboundWebhookEvent | null> => {
    if (!this.outboundWebhookEventService || !input.mutation) return null;
    const channelIds = this.resolveContactWebhookChannelIds(
      input.previousContact,
      input.intendedContact,
      input.mutation.originChannelId
    );
    if (channelIds.length === 0) return null;
    const changes = sanitizeOutboundWebhookContactChanges(
      input.mutation.changes ?? {}
    );
    return this.outboundWebhookEventService.prepareBestEffort({
      accountId: input.accountId,
      eventType: input.eventType,
      aggregate: { type: 'contact', id: input.contactId },
      data: {
        contact: serializePublicContact(
          input.intendedContact ?? { contact_id: input.contactId }
        ),
        changes:
          changes && !Array.isArray(changes) && typeof changes === 'object'
            ? changes
            : ({} as Record<string, OutboundWebhookJsonValue>),
      },
      previous: input.previousContact
        ? { contact: serializePublicContact(input.previousContact) }
        : null,
      source: input.mutation.source,
      channelIds,
      actor: input.mutation.actor,
      idempotencyKey: input.mutation.idempotencyKey,
    });
  };

  private completeContactWebhookEvent = async (input: {
    prepared: PreparedOutboundWebhookEvent | null;
    accountId: string;
    contactId: string;
    eventType: 'contact.created' | 'contact.updated';
    previousContact?: Record<string, unknown> | null;
    requiredCanonicalFields?: Record<string, unknown>;
    allowPreparedFallback?: boolean;
    mutation?: ContactOutboundWebhookMutation;
  }): Promise<void> => {
    if (
      !input.prepared ||
      !input.mutation ||
      !this.outboundWebhookEventService
    ) {
      return;
    }
    await this.outboundWebhookEventService.completePersistedBestEffort({
      eventId: input.prepared.eventId,
      accountId: input.accountId,
    });
  };

  private prepareContactValidationWebhookEvent = async (input: {
    contactId: string;
    accountId?: string;
    intendedFields: {
      phone_ddi?: string | null;
      phone_partial?: string | null;
      /** Private deterministic fingerprint. It is used only for comparison
       * and idempotency and is never serialized into a webhook payload. */
      phone_c?: string | null;
      is_valided: boolean;
    };
    mutation?: ContactOutboundWebhookMutation;
    defaultSource: string;
    defaultIdempotencyKey: string;
  }): Promise<{
    accountId: string;
    previousContact: Record<string, unknown>;
    mutation: ContactOutboundWebhookMutation;
    prepared: PreparedOutboundWebhookEvent | null;
    unchanged: boolean;
  } | null> => {
    const hasPhoneFingerprint = Object.prototype.hasOwnProperty.call(
      input.intendedFields,
      'phone_c'
    );
    const previousContact = await this.contactUpdaterRepository
      .viewContactOutboundWebhookSnapshot(input.contactId, input.accountId)
      .catch((error: unknown) => {
        console.warn(
          '[OutboundWebhook] Contact pre-write snapshot unavailable',
          {
            account_id: input.accountId ?? null,
            contact_id: input.contactId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        return null;
      });
    const accountId =
      input.accountId ??
      (typeof previousContact?.account_id === 'string'
        ? previousContact.account_id
        : undefined);
    if (!previousContact || !accountId) return null;

    const mutationRevision = previousContact.mutation_revision;
    if (typeof mutationRevision !== 'string' || !mutationRevision) {
      console.warn('[OutboundWebhook] Contact revision unavailable', {
        account_id: accountId,
        contact_id: input.contactId,
      });
      return null;
    }

    const baseMutation = input.mutation ?? {
      source: input.defaultSource,
      idempotencyKey: input.defaultIdempotencyKey,
      actor: { type: 'system' as const },
    };
    const durableOperationId = buildOutboundWebhookIdempotencyKey(
      mutationRevision,
      input.intendedFields.phone_ddi,
      input.intendedFields.phone_partial,
      hasPhoneFingerprint ? input.intendedFields.phone_c : undefined,
      input.intendedFields.is_valided
    );
    const mutation = this.scopeContactWebhookMutation(
      {
        ...baseMutation,
        changes: {
          ...(baseMutation.changes ?? {}),
          phone_ddi: input.intendedFields.phone_ddi ?? null,
          phone: input.intendedFields.phone_partial ?? null,
          is_valided: input.intendedFields.is_valided,
        },
      },
      durableOperationId
    );
    if (!mutation) return null;

    const unchanged =
      !hasPhoneFingerprint &&
      previousContact.is_valided === input.intendedFields.is_valided &&
      (!Object.prototype.hasOwnProperty.call(
        input.intendedFields,
        'phone_ddi'
      ) ||
        previousContact.phone_ddi === input.intendedFields.phone_ddi) &&
      (!Object.prototype.hasOwnProperty.call(
        input.intendedFields,
        'phone_partial'
      ) ||
        previousContact.phone_partial === input.intendedFields.phone_partial);

    const intendedContact = {
      ...previousContact,
      phone_ddi:
        input.intendedFields.phone_ddi ?? previousContact.phone_ddi ?? null,
      phone_partial:
        input.intendedFields.phone_partial ??
        previousContact.phone_partial ??
        null,
      is_valided: input.intendedFields.is_valided,
    };
    const prepared = unchanged
      ? null
      : await this.prepareContactWebhookEvent({
          accountId,
          contactId: input.contactId,
          eventType: 'contact.updated',
          previousContact,
          intendedContact,
          mutation,
        });

    return { accountId, previousContact, mutation, prepared, unchanged };
  };

  private completeContactValidationWebhookEvent = async (
    context: Awaited<
      ReturnType<ContactService['prepareContactValidationWebhookEvent']>
    >,
    contactId: string,
    requiredCanonicalFields: Record<string, unknown>
  ): Promise<void> => {
    if (!context) return;
    await this.completeContactWebhookEvent({
      prepared: context.prepared,
      accountId: context.accountId,
      contactId,
      eventType: 'contact.updated',
      previousContact: context.previousContact,
      requiredCanonicalFields,
      allowPreparedFallback: true,
      mutation: context.mutation,
    });
  };

  listContactChannelsByContactId = async (
    accountId: string,
    contactId: string
  ): Promise<string[]> => {
    return this.contactChannelChannelsListerRepository.listChannelIdsByContactAndAccount(
      contactId,
      accountId
    );
  };

  listContacts = async (
    perPage: number,
    currentPage: number,
    query: ListContactRequest,
    accountId: string
  ): Promise<[ListContactResponse[], number]> => {
    const searchTerm = query.search
      ? isCnpjFormat(query.search)
        ? normalizeCnpj(query.search)
        : query.search
      : null;
    const searchHashes = searchTerm
      ? this.encryptService.encrypt(searchTerm)
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

  existsContactById = async (
    contactId: string,
    accountId?: string
  ): Promise<boolean> => {
    return this.contactViewerExistsRepository.existsContactById(
      contactId,
      accountId
    );
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
    const rawContactDocumentTypeId =
      'contact_document_type_id' in input
        ? input.contact_document_type_id
        : null;
    const contactDocumentTypeId = extractFieldValue(
      rawContactDocumentTypeId as FieldValue
    );
    const normalizedDocument =
      contactDocumentTypeId === EContactDocumentType.cnpj
        ? normalizeCnpj(plainDocument)
        : plainDocument;

    return {
      documentCEncrypted:
        this.passwordEncryptorService.encrypt(normalizedDocument),
      documentPartialEncrypted: (
        this.encryptService.sanitize(
          normalizedDocument,
          ETypeSanetize.document
        ) ?? ''
      ).slice(0, 20),
      documentC: this.encryptService.encrypt(normalizedDocument),
    };
  }

  private prepareContactPayload(
    input: CreateContactRequest | ICreateContact,
    accountId: string,
    isValidated: boolean,
    photoUrl?: string | null,
    validationOrigin?: ContactValidationOrigin | null
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
        is_valided: isValidated,
        validation_origin: isValidated ? validationOrigin : null,
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
      validation_origin: isValidated ? validationOrigin : null,
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

  private buildIntendedContactWebhookSnapshot(
    contactId: string,
    payload: ICreateContact,
    contactGroupId?: string | null
  ): Record<string, unknown> {
    const labelTemplates = (payload.label_template_ids ?? []).map(
      (labelTemplateId) => ({
        label_template_id: labelTemplateId,
      })
    );

    return {
      contact_id: contactId,
      name: payload.name,
      last_name: payload.last_name ?? null,
      email_partial: payload.email_partial ?? null,
      phone_ddi: payload.phone_ddi ?? null,
      phone_partial: payload.phone_partial ?? null,
      nickname: payload.nickname ?? null,
      photo: payload.photo ?? null,
      birthday: payload.birthday ?? null,
      notes: payload.notes ?? null,
      document_partial: payload.document_partial ?? null,
      contact_document_type_id: payload.contact_document_type_id ?? null,
      user_id: payload.user_id ?? null,
      ignore: payload.ignore ?? null,
      is_valided: payload.is_valided ?? false,
      label_templates: labelTemplates,
      channel_ids: payload.channel_ids ?? [],
      contact_groups: contactGroupId
        ? [{ contact_group_id: contactGroupId }]
        : [],
    };
  }

  private buildIntendedContactUpdateWebhookSnapshot(
    currentContact: Record<string, unknown>,
    payload: IUpdateContact
  ): Record<string, unknown> {
    return {
      ...currentContact,
      ...payload,
      ...(payload.label_template_ids !== undefined
        ? {
            label_templates: (payload.label_template_ids ?? []).map(
              (labelTemplateId) => ({
                label_template_id: labelTemplateId,
              })
            ),
          }
        : {}),
      ...(payload.channel_ids !== undefined
        ? { channel_ids: payload.channel_ids ?? [] }
        : {}),
    };
  }

  createContact = async (
    input: CreateContactRequest,
    accountId: string,
    isValidated: boolean = true,
    contactId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation,
    validationOrigin?: ContactValidationOrigin | null
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
      photoUrl,
      validationOrigin
    );
    const requestedContactId = contactId ?? uuidv7();
    const webhookMutation = this.scopeContactWebhookMutation(
      outboundWebhook,
      requestedContactId
    );
    const prepared = await this.prepareContactWebhookEvent({
      accountId,
      contactId: requestedContactId,
      eventType: 'contact.created',
      intendedContact: this.buildIntendedContactWebhookSnapshot(
        requestedContactId,
        payload
      ),
      mutation: webhookMutation,
    });
    const createdContactId = await this.executeContactMutation({
      prepared,
      accountId,
      replayValue: requestedContactId,
      operation: () =>
        this.contactCreatorRepository.createContact(
          payload,
          undefined,
          requestedContactId,
          this.buildContactWebhookMarker(prepared, accountId)
        ),
    });
    if (!createdContactId) {
      return null;
    }
    await this.completeContactWebhookEvent({
      prepared,
      accountId,
      contactId: createdContactId,
      eventType: 'contact.created',
      allowPreparedFallback: true,
      mutation: webhookMutation,
    });
    return createdContactId;
  };

  createContactWithGroup = async (
    t: TFunction<'translation', undefined>,
    input: ICreateContact,
    contactGroupId: string | null,
    accountId: string,
    isValidated: boolean = false,
    outboundWebhook?: ContactOutboundWebhookMutation,
    validationOrigin?: ContactValidationOrigin | null
  ): Promise<boolean | null> => {
    const payload = this.prepareContactPayload(
      input,
      accountId,
      isValidated,
      input.photo,
      validationOrigin
    );

    const requestedContactId = uuidv7();
    const webhookMutation = this.scopeContactWebhookMutation(
      outboundWebhook,
      requestedContactId
    );
    const prepared = await this.prepareContactWebhookEvent({
      accountId,
      contactId: requestedContactId,
      eventType: 'contact.created',
      intendedContact: this.buildIntendedContactWebhookSnapshot(
        requestedContactId,
        payload,
        contactGroupId
      ),
      mutation: webhookMutation,
    });
    const createdContactId = await this.executeContactMutation({
      prepared,
      accountId,
      replayValue: requestedContactId,
      operation: () =>
        this.contactCreatorRepository.createContactWithGroup(
          t,
          payload,
          contactGroupId,
          requestedContactId,
          this.buildContactWebhookMarker(prepared, accountId)
        ),
    });
    if (!createdContactId) {
      return null;
    }
    await this.completeContactWebhookEvent({
      prepared,
      accountId,
      contactId: createdContactId,
      eventType: 'contact.created',
      allowPreparedFallback: true,
      mutation: webhookMutation,
    });
    return true;
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

  /**
   * Reads the public contact projection from the writer database so callers
   * that run immediately after a mutation do not depend on replica freshness.
   */
  viewContactOutboundWebhookSnapshot = async (
    contactId: string,
    accountId?: string
  ): Promise<Record<string, unknown> | null> => {
    return this.contactUpdaterRepository.viewContactOutboundWebhookSnapshot(
      contactId,
      accountId
    );
  };

  getContactByPhone = async (
    accountId: string,
    phone: string,
    phoneDdi: string | null
  ): Promise<
    | (ViewContactResponse & {
        validation_origin: ContactValidationOrigin | null;
      })
    | null
  > => {
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
    phoneDdi: string | null,
    accountId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation,
    validationOrigin?: ContactValidationOrigin | null
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
      validation_origin: validationOrigin,
    };

    const webhookContext = await this.prepareContactValidationWebhookEvent({
      contactId,
      accountId,
      intendedFields: {
        phone_ddi: phoneDdi,
        phone_partial: phonePartialEncrypted,
        phone_c: phoneC,
        is_valided: true,
      },
      mutation: outboundWebhook,
      defaultSource: 'contact_validation',
      defaultIdempotencyKey: `contact-validated:${contactId}`,
    });
    const resolvedAccountId = webhookContext?.accountId ?? accountId;
    const updated = resolvedAccountId
      ? await this.executeContactMutation({
          prepared: webhookContext?.prepared ?? null,
          accountId: resolvedAccountId,
          replayValue: true,
          operation: () =>
            this.contactUpdaterRepository.validateContact(
              contactId,
              payload,
              resolvedAccountId,
              webhookContext
                ? this.buildContactWebhookMarker(
                    webhookContext.prepared,
                    webhookContext.accountId
                  )
                : null
            ),
        })
      : await this.contactUpdaterRepository.validateContact(contactId, payload);
    if (!updated) return false;

    await this.completeContactValidationWebhookEvent(
      webhookContext,
      contactId,
      {
        phone_ddi: phoneDdi,
        phone_partial: phonePartialEncrypted,
        is_valided: true,
      }
    );
    return true;
  };

  updateContactIsValided = async (
    contactId: string,
    isValided: boolean,
    accountId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation,
    validationOrigin?: ContactValidationOrigin | null
  ): Promise<boolean> => {
    const mutationAccountId = this.resolveRuntimeScopedContactAccountId(
      accountId,
      outboundWebhook
    );
    const webhookContext = await this.prepareContactValidationWebhookEvent({
      contactId,
      accountId: mutationAccountId,
      intendedFields: { is_valided: isValided },
      mutation: outboundWebhook,
      defaultSource: 'contact_service',
      defaultIdempotencyKey: `contact-validation-status:${contactId}`,
    });
    const resolvedAccountId = webhookContext?.accountId ?? mutationAccountId;
    const updated = resolvedAccountId
      ? await this.executeContactMutation({
          prepared: webhookContext?.prepared ?? null,
          accountId: resolvedAccountId,
          replayValue: true,
          operation: () =>
            this.contactUpdaterRepository.updateContactIsValided(
              contactId,
              isValided,
              resolvedAccountId,
              webhookContext
                ? this.buildContactWebhookMarker(
                    webhookContext.prepared,
                    webhookContext.accountId
                  )
                : null,
              outboundWebhook?.runtimeFence,
              validationOrigin
            ),
        })
      : await this.contactUpdaterRepository.updateContactIsValided(
          contactId,
          isValided,
          undefined,
          undefined,
          undefined,
          validationOrigin
        );
    if (!updated) return false;

    await this.completeContactValidationWebhookEvent(
      webhookContext,
      contactId,
      { is_valided: isValided }
    );
    return true;
  };

  updateContactValidation = async (
    contactId: string,
    phoneWithDdi: string,
    isValided: boolean,
    accountId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation,
    validationOrigin?: ContactValidationOrigin | null
  ): Promise<boolean> => {
    const mutationAccountId = this.resolveRuntimeScopedContactAccountId(
      accountId,
      outboundWebhook
    );
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
      validation_origin: isValided ? validationOrigin : null,
    };

    const webhookContext = await this.prepareContactValidationWebhookEvent({
      contactId,
      accountId: mutationAccountId,
      intendedFields: {
        phone_ddi,
        phone_partial: phonePartialEncrypted,
        phone_c: phoneC,
        is_valided: isValided,
      },
      mutation: outboundWebhook,
      defaultSource: 'contact_validation',
      defaultIdempotencyKey: `contact-validation-synced:${contactId}`,
    });
    const resolvedAccountId = mutationAccountId ?? webhookContext?.accountId;
    const updated = resolvedAccountId
      ? await this.executeContactMutation({
          prepared: webhookContext?.prepared ?? null,
          accountId: resolvedAccountId,
          replayValue: true,
          operation: () =>
            this.contactUpdaterRepository.updateContactById(
              contactId,
              payload,
              resolvedAccountId,
              webhookContext
                ? this.buildContactWebhookMarker(
                    webhookContext.prepared,
                    webhookContext.accountId
                  )
                : null,
              outboundWebhook?.runtimeFence
            ),
        })
      : await this.contactUpdaterRepository.updateContactById(
          contactId,
          payload
        );
    if (!updated) return false;

    await this.completeContactValidationWebhookEvent(
      webhookContext,
      contactId,
      {
        phone_ddi,
        phone_partial: phonePartialEncrypted,
        is_valided: isValided,
      }
    );
    return true;
  };

  deleteContactById = async (
    contactId: string,
    accountId?: string,
    prepared?: PreparedOutboundWebhookEvent | null
  ): Promise<boolean> => {
    if (!accountId) {
      return this.contactDeleterRepository.deleteContactById(contactId);
    }
    return this.executeContactMutation({
      prepared: prepared ?? null,
      accountId,
      replayValue: true,
      operation: () =>
        this.contactDeleterRepository.deleteContactById(
          contactId,
          accountId,
          this.buildContactWebhookMarker(prepared ?? null, accountId)
        ),
    });
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
    accountId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation,
    validationState?: ContactValidationStateMutation
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
    const isValided =
      validationState?.isValidated ??
      this.determineIsValided(
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
    const hasNickname = input.nickname !== undefined;
    const name = this.normalizeContactText(
      extractFieldValue(input.name as FieldValue)
    );
    const lastName = this.normalizeContactText(
      extractFieldValue(input.last_name as FieldValue)
    );
    const nickname = hasNickname
      ? this.normalizeContactText(
          extractFieldValue(input.nickname as FieldValue)
        )
      : undefined;
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
      photo: photoUrl,
      birthday: nullIfEmpty(birthday),
      notes: notes ?? '',
      is_valided: isValided,
      validation_origin: validationState
        ? validationState.isValidated
          ? validationState.origin
          : null
        : undefined,
    };

    if (hasNickname) {
      payload.nickname = nickname ?? '';
    }

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

    const webhookPreviousContact =
      accountId && outboundWebhook
        ? await this.viewContactOutboundWebhookSnapshot(
            contactId,
            accountId
          ).catch(() => currentContact)
        : currentContact;
    const prepared = accountId
      ? await this.prepareContactWebhookEvent({
          accountId,
          contactId,
          eventType: 'contact.updated',
          previousContact: webhookPreviousContact,
          intendedContact: this.buildIntendedContactUpdateWebhookSnapshot(
            webhookPreviousContact ?? {},
            payload
          ),
          mutation: outboundWebhook,
        })
      : null;
    const updated = accountId
      ? await this.executeContactMutation({
          prepared,
          accountId,
          replayValue: true,
          operation: () =>
            this.contactUpdaterRepository.updateContactById(
              contactId,
              payload,
              accountId,
              this.buildContactWebhookMarker(prepared, accountId)
            ),
        })
      : await this.contactUpdaterRepository.updateContactById(
          contactId,
          payload
        );
    if (!updated) {
      return updated;
    }
    if (accountId) {
      await this.completeContactWebhookEvent({
        prepared,
        accountId,
        contactId,
        eventType: 'contact.updated',
        previousContact: webhookPreviousContact,
        allowPreparedFallback: true,
        mutation: outboundWebhook,
      });
    }
    return updated;
  };

  updateContactFromImport = async (
    contactId: string,
    accountId: string,
    csvContact: ICreateContact,
    outboundWebhook?: ContactOutboundWebhookMutation
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

    const webhookPreviousContact = outboundWebhook
      ? await this.viewContactOutboundWebhookSnapshot(
          contactId,
          accountId
        ).catch(() => currentContact)
      : currentContact;
    const prepared = await this.prepareContactWebhookEvent({
      accountId,
      contactId,
      eventType: 'contact.updated',
      previousContact: webhookPreviousContact,
      intendedContact: this.buildIntendedContactUpdateWebhookSnapshot(
        webhookPreviousContact ?? {},
        payload
      ),
      mutation: outboundWebhook,
    });
    const result = await this.executeContactMutation({
      prepared,
      accountId,
      replayValue: true,
      operation: () =>
        this.contactUpdaterRepository.updateContactById(
          contactId,
          payload,
          accountId,
          this.buildContactWebhookMarker(prepared, accountId)
        ),
    });
    if (!result) {
      return false;
    }
    await this.completeContactWebhookEvent({
      prepared,
      accountId,
      contactId,
      eventType: 'contact.updated',
      previousContact: webhookPreviousContact,
      allowPreparedFallback: true,
      mutation: outboundWebhook,
    });

    return true;
  };

  addContactToGroupIfNotExists = async (
    contactId: string,
    contactGroupId: string,
    accountId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation
  ): Promise<boolean> => {
    if (!contactGroupId?.trim()) {
      return true;
    }
    if (!accountId) return false;

    const previousContact = accountId
      ? await this.viewContactOutboundWebhookSnapshot(
          contactId,
          accountId
        ).catch(() => null)
      : null;
    if (accountId && !previousContact) return false;
    const assignmentId = uuidv7();
    const mutation = this.scopeContactWebhookMutation(
      outboundWebhook,
      assignmentId
    );
    const prepared = accountId
      ? await this.prepareContactWebhookEvent({
          accountId,
          contactId,
          eventType: 'contact.updated',
          previousContact,
          intendedContact: {
            ...(previousContact ?? { contact_id: contactId }),
            contact_groups: [
              ...(((previousContact as { contact_groups?: unknown[] } | null)
                ?.contact_groups ?? []) as unknown[]),
              { contact_group_id: contactGroupId },
            ],
          },
          mutation,
        })
      : null;
    const createdAssignmentId = await this.executeContactMutation({
      prepared,
      accountId,
      replayValue: assignmentId,
      operation: () =>
        this.contactGroupAssignmentCreatorRepository.createContactGroupAssignmentDirectly(
          contactGroupId,
          contactId,
          accountId,
          assignmentId,
          this.buildContactWebhookMarker(prepared, accountId)
        ),
    });

    if (!createdAssignmentId) {
      if (prepared?.state === 'preparing') {
        await this.outboundWebhookEventService?.cancel(prepared.eventId);
      }
      // The account-scoped repository validation succeeded; a null insert is
      // therefore the unique-index no-op for an assignment already present.
      return true;
    }

    if (accountId) {
      await this.completeContactWebhookEvent({
        prepared,
        accountId,
        contactId,
        eventType: 'contact.updated',
        previousContact,
        allowPreparedFallback: true,
        mutation,
      });
    }

    return true;
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
    accountId: string,
    outboundWebhook?: ContactOutboundWebhookMutation
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
    const webhookPreviousContact = outboundWebhook
      ? await this.viewContactOutboundWebhookSnapshot(
          contactId,
          accountId
        ).catch(() => currentContact)
      : currentContact;
    const prepared = await this.prepareContactWebhookEvent({
      accountId,
      contactId,
      eventType: 'contact.updated',
      previousContact: webhookPreviousContact,
      intendedContact: this.buildIntendedContactUpdateWebhookSnapshot(
        webhookPreviousContact ?? {},
        payload
      ),
      mutation: outboundWebhook,
    });
    const updated = await this.executeContactMutation({
      prepared,
      accountId,
      replayValue: true,
      operation: () =>
        this.contactUpdaterRepository.updateContactById(
          contactId,
          payload,
          accountId,
          this.buildContactWebhookMarker(prepared, accountId)
        ),
    });
    if (!updated) {
      return false;
    }
    await this.completeContactWebhookEvent({
      prepared,
      accountId,
      contactId,
      eventType: 'contact.updated',
      previousContact: webhookPreviousContact,
      allowPreparedFallback: true,
      mutation: outboundWebhook,
    });
    return true;
  };

  listContactUsers = async (
    accountId: string
  ): Promise<ListContactUsersResponse[]> => {
    return this.contactUsersListerRepository.listContactUsers(accountId);
  };

  addContactLabelTemplateIfNotExists = async (
    contactId: string,
    labelTemplateId: string,
    accountId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation
  ): Promise<boolean> => {
    if (!accountId) return false;

    const previousContact = accountId
      ? await this.viewContactOutboundWebhookSnapshot(
          contactId,
          accountId
        ).catch(() => null)
      : null;
    if (accountId && !previousContact) return false;
    const assignmentId = uuidv7();
    const mutation = this.scopeContactWebhookMutation(
      outboundWebhook,
      assignmentId
    );
    const prepared = accountId
      ? await this.prepareContactWebhookEvent({
          accountId,
          contactId,
          eventType: 'contact.updated',
          previousContact,
          intendedContact: {
            ...(previousContact ?? { contact_id: contactId }),
            label_templates: [
              ...(((previousContact as { label_templates?: unknown[] } | null)
                ?.label_templates ?? []) as unknown[]),
              { label_template_id: labelTemplateId },
            ],
          },
          mutation,
        })
      : null;
    const result = await this.executeContactMutation({
      prepared,
      accountId,
      replayValue: assignmentId,
      operation: () =>
        this.contactLabelTemplateCreatorRepository.createContactLabelTemplateWithoutTransaction(
          contactId,
          labelTemplateId,
          accountId,
          assignmentId,
          this.buildContactWebhookMarker(prepared, accountId)
        ),
    });

    if (result === null) {
      if (prepared?.state === 'preparing') {
        await this.outboundWebhookEventService?.cancel(prepared.eventId);
      }
      return true;
    }
    if (accountId) {
      await this.completeContactWebhookEvent({
        prepared,
        accountId,
        contactId,
        eventType: 'contact.updated',
        previousContact,
        allowPreparedFallback: true,
        mutation,
      });
    }
    return true;
  };

  removeContactLabelTemplate = async (
    contactId: string,
    labelTemplateId: string,
    accountId?: string,
    outboundWebhook?: ContactOutboundWebhookMutation
  ): Promise<boolean> => {
    if (!accountId) return false;
    const previousContact = accountId
      ? await this.viewContactOutboundWebhookSnapshot(contactId, accountId)
      : null;
    if (accountId && !previousContact) return false;
    const prepared = accountId
      ? await this.prepareContactWebhookEvent({
          accountId,
          contactId,
          eventType: 'contact.updated',
          previousContact,
          intendedContact: {
            ...(previousContact ?? { contact_id: contactId }),
            label_templates: (
              (
                previousContact as {
                  label_templates?: Array<Record<string, unknown>>;
                } | null
              )?.label_templates ?? []
            ).filter((label) => label.label_template_id !== labelTemplateId),
          },
          mutation: outboundWebhook,
        })
      : null;
    const removed = await this.executeContactMutation({
      prepared,
      accountId,
      replayValue: true,
      operation: () =>
        this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplateByContactIdAndLabelTemplateId(
          contactId,
          labelTemplateId,
          accountId,
          this.buildContactWebhookMarker(prepared, accountId)
        ),
    });
    if (!removed) {
      if (prepared?.state === 'preparing') {
        await this.outboundWebhookEventService?.cancel(prepared.eventId);
      }
      return true;
    }
    if (accountId) {
      await this.completeContactWebhookEvent({
        prepared,
        accountId,
        contactId,
        eventType: 'contact.updated',
        previousContact,
        allowPreparedFallback: true,
        mutation: outboundWebhook,
      });
    }
    return true;
  };
}
