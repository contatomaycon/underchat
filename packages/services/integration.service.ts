import { IntegrationListerRepository } from '@core/repositories/integration/IntegrationLister.repository';
import { IntegrationCreatorRepository } from '@core/repositories/integration/IntegrationCreator.repository';
import { IntegrationUpdaterRepository } from '@core/repositories/integration/IntegrationUpdater.repository';
import { IntegrationDeleterRepository } from '@core/repositories/integration/IntegrationDeleter.repository';
import { IntegrationViewerByIdRepository } from '@core/repositories/integration/IntegrationViewerById.repository';
import { IntegrationStatusUpdaterRepository } from '@core/repositories/integration/IntegrationStatusUpdater.repository';
import { IntegrationKeyGeneratorRepository } from '@core/repositories/integration/IntegrationKeyGenerator.repository';
import { IntegrationAvailableChannelsListerRepository } from '@core/repositories/integration/IntegrationAvailableChannelsLister.repository';
import { WebhookMappingViewerRepository } from '@core/repositories/webhookMapping/WebhookMappingViewer.repository';
import { WebhookMappingSaverRepository } from '@core/repositories/webhookMapping/WebhookMappingSaver.repository';
import { WebhookDataViewerRepository } from '@core/repositories/webhook/WebhookDataViewer.repository';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { webhookMappings } from '@core/mappings/webhook.mappings';
import { injectable, inject } from 'tsyringe';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { ListIntegrationsRequest } from '@core/schema/integration/listIntegrations/request.schema';
import { ListIntegrationsResponse } from '@core/schema/integration/listIntegrations/response.schema';
import { CreateIntegrationRequest } from '@core/schema/integration/createIntegration/request.schema';
import { CreateIntegrationResponse } from '@core/schema/integration/createIntegration/response.schema';
import { UpdateIntegrationRequest } from '@core/schema/integration/updateIntegration/request.schema';
import { ViewIntegrationByIdResponse } from '@core/schema/integration/viewIntegrationById/response.schema';
import { ListAvailableChannelsResponse } from '@core/schema/integration/listAvailableChannels/response.schema';
import { UserService } from './user.service';
import { SectorService } from './sector.service';
import { ChatbotService } from './chatbot.service';
import { WorkerService } from './worker.service';
import { ContactService } from './contact.service';
import { PhoneValidationService } from './phoneValidation.service';
import { PlanAccountService } from './planAccount.service';
import { LabelTemplateViewerByNameRepository } from '@core/repositories/labelTemplate/LabelTemplateViewerByName.repository';
import { ListIntegrationUsersResponse } from '@core/schema/integration/listUsers/response.schema';
import { ListIntegrationSectorsResponse } from '@core/schema/integration/listSectors/response.schema';
import { ListIntegrationSectorUsersResponse } from '@core/schema/integration/listSectorUsers/response.schema';
import { ListIntegrationInputChatbotsResponse } from '@core/schema/integration/listInputChatbots/response.schema';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { ELabelStatus } from '@core/common/enums/ELabelStatus';
import { TFunction } from 'i18next';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ContactCreatorRepository } from '@core/repositories/contact/ContactCreator.repository';
import { LabelTemplateCreatorRepository } from '@core/repositories/labelTemplate/LabelTemplateCreator.repository';
import { EncryptService } from './encrypt.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';
import { IMappedWebhookData } from '@core/common/interfaces/IMappedWebhookData';
import { Transaction } from '@core/common/types/Transaction.type';
import { IWebhookIntegrationRequest } from '@core/common/interfaces/IWebhookIntegrationRequest';
import Redis from 'ioredis';
import { createKeyApiCacheKey } from '@core/common/functions/createCacheKey';
import { v7 as uuidv7 } from 'uuid';
import { serializePublicContact } from '@core/common/functions/outboundWebhookPayload';
import type { ContactOutboundWebhookMarker } from '@core/repositories/contact/contactOutboundWebhookOutbox';
import {
  OutboundWebhookEventService,
  type PreparedOutboundWebhookEvent,
} from './outboundWebhookEvent.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementService } from './planEntitlement.service';
import { buildWebhookIntegrationEntityKey } from '@core/common/functions/webhookIntegrationIdentity';
import { WorkerCommandAdmissionService } from './workerCommandAdmission.service';
import { ContactPhoneValidationPolicyService } from './contactPhoneValidationPolicy.service';
import {
  CONTACT_VALIDATION_ORIGINS,
  type ContactValidationOrigin,
} from '@core/common/types/ContactValidationOrigin';

interface WebhookPhoneValidationResult {
  phone: string;
  phone_ddi: string;
  is_valided: boolean;
  validation_origin: ContactValidationOrigin | null;
}

@injectable()
export class IntegrationService {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(IntegrationListerRepository)
    private readonly integrationListerRepository: IntegrationListerRepository,
    @inject(IntegrationCreatorRepository)
    private readonly integrationCreatorRepository: IntegrationCreatorRepository,
    @inject(IntegrationUpdaterRepository)
    private readonly integrationUpdaterRepository: IntegrationUpdaterRepository,
    @inject(IntegrationDeleterRepository)
    private readonly integrationDeleterRepository: IntegrationDeleterRepository,
    @inject(IntegrationViewerByIdRepository)
    private readonly integrationViewerByIdRepository: IntegrationViewerByIdRepository,
    @inject(IntegrationStatusUpdaterRepository)
    private readonly integrationStatusUpdaterRepository: IntegrationStatusUpdaterRepository,
    @inject(IntegrationKeyGeneratorRepository)
    private readonly integrationKeyGeneratorRepository: IntegrationKeyGeneratorRepository,
    @inject(IntegrationAvailableChannelsListerRepository)
    private readonly integrationAvailableChannelsListerRepository: IntegrationAvailableChannelsListerRepository,
    @inject(WebhookMappingViewerRepository)
    private readonly webhookMappingViewerRepository: WebhookMappingViewerRepository,
    @inject(WebhookMappingSaverRepository)
    private readonly webhookMappingSaverRepository: WebhookMappingSaverRepository,
    @inject(WebhookDataViewerRepository)
    private readonly webhookDataViewerRepository: WebhookDataViewerRepository,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(PhoneValidationService)
    private readonly phoneValidationService: PhoneValidationService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(LabelTemplateViewerByNameRepository)
    private readonly labelTemplateViewerByNameRepository: LabelTemplateViewerByNameRepository,
    @inject(ContactCreatorRepository)
    private readonly contactCreatorRepository: ContactCreatorRepository,
    @inject(LabelTemplateCreatorRepository)
    private readonly labelTemplateCreatorRepository: LabelTemplateCreatorRepository,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerCommandAdmissionService)
    private readonly workerCommandAdmissionService: WorkerCommandAdmissionService,
    @inject('Redis') private readonly redis: Redis,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService,
    @inject(OutboundWebhookEventService)
    private readonly outboundWebhookEventService: OutboundWebhookEventService | null = null,
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

  private readonly invalidateWebhookKeyCache = async (key: string) => {
    await this.redis
      .del(createKeyApiCacheKey(key, 'public/webhook'))
      .catch(() => undefined);
  };

  listIntegrations = async (
    accountId: string,
    request: ListIntegrationsRequest
  ): Promise<ListIntegrationsResponse> => {
    const perPage = request.per_page ?? 10;
    const currentPage = request.current_page ?? 1;

    const [results, total] = await Promise.all([
      this.integrationListerRepository.listIntegrations(
        accountId,
        perPage,
        currentPage,
        request
      ),
      this.integrationListerRepository.listIntegrationsTotal(
        accountId,
        request
      ),
    ]);

    const totalPages = Math.ceil(total / perPage);

    return {
      results,
      pagings: {
        current_page: currentPage,
        total_pages: totalPages,
        per_page: perPage,
        count: results.length,
        total,
      },
    };
  };

  createIntegration = async (
    accountId: string,
    request: CreateIntegrationRequest
  ): Promise<CreateIntegrationResponse | null> => {
    const apiKeyId = await this.integrationCreatorRepository.createIntegration(
      accountId,
      request.name,
      request.worker_id
    );

    if (!apiKeyId) {
      return null;
    }

    const apiKey =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );
    if (!apiKey) {
      return null;
    }

    return {
      api_key_id: apiKeyId,
      key: apiKey.key,
    };
  };

  updateIntegration = async (
    accountId: string,
    apiKeyId: string,
    request: UpdateIntegrationRequest
  ): Promise<boolean> => {
    const current =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );

    if (!current) return false;

    const updated = await this.integrationUpdaterRepository.updateIntegration(
      accountId,
      apiKeyId,
      request.name,
      request.worker_id
    );

    if (updated) await this.invalidateWebhookKeyCache(current.key);
    return updated;
  };

  deleteIntegration = async (
    accountId: string,
    apiKeyId: string
  ): Promise<boolean> => {
    const current =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );

    if (!current) return false;

    const deleted = await this.integrationDeleterRepository.deleteIntegration(
      accountId,
      apiKeyId
    );

    if (deleted) await this.invalidateWebhookKeyCache(current.key);
    return deleted;
  };

  viewIntegrationById = async (
    accountId: string,
    apiKeyId: string
  ): Promise<ViewIntegrationByIdResponse | null> => {
    return this.integrationViewerByIdRepository.viewIntegrationById(
      accountId,
      apiKeyId
    );
  };

  updateIntegrationStatus = async (
    accountId: string,
    apiKeyId: string,
    status: EStatusApiKey
  ): Promise<boolean> => {
    const current =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );

    if (!current) return false;

    const updated =
      await this.integrationStatusUpdaterRepository.updateIntegrationStatus(
        accountId,
        apiKeyId,
        status
      );

    if (updated) await this.invalidateWebhookKeyCache(current.key);
    return updated;
  };

  generateNewKey = async (
    accountId: string,
    apiKeyId: string
  ): Promise<string | null> => {
    const current =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );

    if (!current) return null;

    const newKey = await this.integrationKeyGeneratorRepository.generateNewKey(
      accountId,
      apiKeyId
    );

    if (newKey) await this.invalidateWebhookKeyCache(current.key);
    return newKey;
  };

  viewWebhookMapping = async (
    accountId: string,
    apiKeyId: string
  ): Promise<{
    account_id: string;
    worker_id: string | null;
    mapping: Record<string, string | string[]>;
    created_at?: string;
    updated_at?: string;
  } | null> => {
    const apiKey =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );

    if (!apiKey || !apiKey.worker_id) {
      return null;
    }

    return this.webhookMappingViewerRepository.viewWebhookMapping(
      accountId,
      apiKey.worker_id
    );
  };

  saveWebhookMapping = async (
    accountId: string,
    apiKeyId: string,
    mapping: Record<string, string | string[]>
  ): Promise<boolean> => {
    const apiKey =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );

    if (!apiKey || !apiKey.worker_id) {
      return false;
    }

    return this.webhookMappingSaverRepository.saveWebhookMapping(
      accountId,
      apiKey.worker_id,
      mapping
    );
  };

  viewWebhookData = async (
    accountId: string,
    apiKeyId: string
  ): Promise<unknown | null> => {
    const apiKey =
      await this.integrationViewerByIdRepository.viewIntegrationById(
        accountId,
        apiKeyId
      );

    if (!apiKey || !apiKey.worker_id) {
      return null;
    }

    return this.webhookDataViewerRepository.viewWebhookData(
      accountId,
      apiKey.worker_id
    );
  };

  listAvailableChannels = async (
    accountId: string
  ): Promise<ListAvailableChannelsResponse> => {
    return this.integrationAvailableChannelsListerRepository.listAvailableChannels(
      accountId
    );
  };

  saveWebhookData = async (
    accountId: string,
    workerId: string,
    data: Record<string, unknown>
  ): Promise<boolean> => {
    const mappings = webhookMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.webhook,
      mappings
    );

    if (!result) {
      return false;
    }

    const documentId = `${accountId}_${workerId}`;
    const indexResult = await this.elasticDatabaseService.indexWithOCC(
      EElasticIndex.webhook,
      documentId,
      data,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return indexResult === 'updated' || indexResult === 'created';
  };

  processWebhook = async (
    _t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: Record<string, unknown>,
    integrationEntitlementRevision: string,
    operationId?: string
  ): Promise<boolean> => {
    const acceptedOperationId = operationId?.trim() || uuidv7();
    const assertCurrentEntitlement = () =>
      this.planEntitlementService.assertEntitled(
        accountId,
        EPlanProduct.integration,
        { expectedRevision: integrationEntitlementRevision }
      );

    let entitlement = await assertCurrentEntitlement();

    const saved = await this.saveWebhookData(accountId, workerId, body);
    if (!saved) {
      return false;
    }

    const webhookMapping = await this.getWebhookMapping(accountId, workerId);
    if (!webhookMapping) {
      return true;
    }

    const mappedData = this.mapWebhookData(body, webhookMapping.mapping);
    if (!mappedData.phone) {
      return true;
    }

    const phoneAndDdi = this.extractPhoneAndDdiFromMappedData(mappedData);
    if (!phoneAndDdi) {
      return true;
    }

    // Contact resolution may persist a new contact. Revalidate immediately
    // before crossing that side-effect boundary so a concurrent downgrade
    // cannot reuse the request's earlier preflight.
    entitlement = await assertCurrentEntitlement();
    const contact = await this.getOrCreateContact(
      accountId,
      workerId,
      phoneAndDdi,
      mappedData
    );

    const interactionPhoneAndDdi = this.resolveInteractionPhoneAndDdi(
      phoneAndDdi,
      contact
    );

    // Kafka publication is a separate side-effect boundary and therefore gets
    // its own epoch check. A B -> A transition also changes the revision, so
    // traffic admitted by the previous grant cannot leak into the new epoch.
    entitlement = await assertCurrentEntitlement();
    await this.sendToWebhookIntegrationConsumer(
      accountId,
      workerId,
      contact,
      mappedData,
      webhookMapping.mapping,
      body,
      interactionPhoneAndDdi,
      entitlement.revision,
      acceptedOperationId
    );

    return true;
  };

  private getWebhookMapping = async (
    accountId: string,
    workerId: string
  ): Promise<{
    account_id: string;
    worker_id: string | null;
    mapping: Record<string, string | string[]>;
    created_at?: string;
    updated_at?: string;
  } | null> => {
    const webhookMapping =
      await this.webhookMappingViewerRepository.viewWebhookMapping(
        accountId,
        workerId
      );

    if (!webhookMapping || !webhookMapping.mapping) {
      return null;
    }

    return webhookMapping;
  };

  private extractPhoneAndDdiFromMappedData = (
    mappedData: IMappedWebhookData
  ): { phone: string; phone_ddi: string | null } | null => {
    if (!mappedData.phone) return null;

    const phoneDigits = onlyDigits(mappedData.phone);
    if (!phoneDigits) return null;

    const phoneDdiDigits = onlyDigits(mappedData.phone_ddi ?? '');
    if (phoneDdiDigits) {
      const phoneWithoutDdi =
        phoneDigits.startsWith(phoneDdiDigits) &&
        phoneDigits.length > phoneDdiDigits.length
          ? phoneDigits.slice(phoneDdiDigits.length)
          : phoneDigits;
      if (phoneWithoutDdi.length < 8) return null;

      return {
        phone: phoneWithoutDdi,
        phone_ddi: phoneDdiDigits,
      };
    }

    const extracted = extractPhoneAndDdi(phoneDigits);

    return extracted;
  };

  private isTechnicalValidationError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return true;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('deadline exceeded') ||
      errorMessage.includes('no active worker') ||
      errorMessage.includes('unavailable') ||
      errorMessage.includes('disconnected') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('not connected')
    );
  };

  private isInvalidValidationError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('phone_number_not_valid_on_whatsapp') ||
      errorMessage.includes('phone number is not valid on whatsapp')
    );
  };

  private async validateWebhookPhoneForContactCreation(
    accountId: string,
    workerId: string,
    phoneAndDdi: { phone: string; phone_ddi: string | null }
  ): Promise<WebhookPhoneValidationResult> {
    const fallbackPhone = phoneAndDdi.phone;
    const fallbackPhoneDdi = phoneAndDdi.phone_ddi ?? '55';
    const validationPolicy =
      await this.contactPhoneValidationPolicyService.resolve({
        accountId,
        requestedChannelIds: [workerId],
      });

    if (validationPolicy.isOfficialOnly) {
      return {
        phone: fallbackPhone,
        phone_ddi: fallbackPhoneDdi,
        is_valided: true,
        validation_origin: CONTACT_VALIDATION_ORIGINS.officialInbound,
      };
    }

    try {
      const validationResult = await this.phoneValidationService.validatePhone(
        accountId,
        fallbackPhone,
        fallbackPhoneDdi,
        undefined,
        { bypassCache: true, preferredWorkerId: workerId }
      );

      if (!validationResult.valid) {
        return {
          phone: fallbackPhone,
          phone_ddi: fallbackPhoneDdi,
          is_valided: false,
          validation_origin: null,
        };
      }

      const validatedPhoneCandidate =
        validationResult.phone ??
        getPhoneFromJid(validationResult.jid ?? null, null);

      if (!validatedPhoneCandidate) {
        return {
          phone: fallbackPhone,
          phone_ddi: fallbackPhoneDdi,
          is_valided: true,
          validation_origin: CONTACT_VALIDATION_ORIGINS.whatsappLookup,
        };
      }

      const normalized = extractPhoneAndDdi(validatedPhoneCandidate);
      if (!normalized) {
        return {
          phone: fallbackPhone,
          phone_ddi: fallbackPhoneDdi,
          is_valided: true,
          validation_origin: CONTACT_VALIDATION_ORIGINS.whatsappLookup,
        };
      }

      return {
        phone: normalized.phone,
        phone_ddi: normalized.phone_ddi,
        is_valided: true,
        validation_origin: CONTACT_VALIDATION_ORIGINS.whatsappLookup,
      };
    } catch (error) {
      if (
        this.isInvalidValidationError(error) ||
        this.isTechnicalValidationError(error)
      ) {
        return {
          phone: fallbackPhone,
          phone_ddi: fallbackPhoneDdi,
          is_valided: false,
          validation_origin: null,
        };
      }

      return {
        phone: fallbackPhone,
        phone_ddi: fallbackPhoneDdi,
        is_valided: false,
        validation_origin: null,
      };
    }
  }

  private getOrCreateContact = async (
    accountId: string,
    workerId: string,
    phoneAndDdi: { phone: string; phone_ddi: string | null },
    mappedData: IMappedWebhookData
  ): Promise<{
    contactId: string;
    is_valided: boolean;
    phone_validated?: string;
    phone_ddi_validated?: string | null;
  }> => {
    const buildTransientValidationResult = (validation: {
      phone: string;
      phone_ddi: string;
      is_valided: boolean;
      validation_origin: ContactValidationOrigin | null;
    }): {
      contactId: string;
      is_valided: boolean;
      phone_validated?: string;
      phone_ddi_validated?: string | null;
    } => ({
      contactId: '',
      // Keep contact flag false when not persisted.
      is_valided: false,
      phone_validated: validation.phone,
      phone_ddi_validated: validation.phone_ddi,
    });

    const validation = await this.validateWebhookPhoneForContactCreation(
      accountId,
      workerId,
      phoneAndDdi
    );
    const validatedPhoneAndDdi = {
      phone: validation.phone,
      phone_ddi: validation.phone_ddi,
    };

    const existingContact = await this.contactService.getContactByPhone(
      accountId,
      validatedPhoneAndDdi.phone,
      validatedPhoneAndDdi.phone_ddi
    );

    if (existingContact) {
      return this.buildExistingContactResult(
        accountId,
        workerId,
        existingContact.contact_id,
        existingContact.is_valided === true,
        existingContact.validation_origin,
        existingContact.phone_ddi ?? null,
        validatedPhoneAndDdi,
        mappedData,
        validation
      );
    }

    const canCreateContact =
      await this.planAccountService.validateCanCreateContactReceived(accountId);
    if (!canCreateContact) {
      return buildTransientValidationResult(validation);
    }

    const shouldAutoSave = await this.shouldAutoSaveContact(workerId);
    if (!shouldAutoSave) {
      return buildTransientValidationResult(validation);
    }

    const mappedDataWithValidatedPhone: IMappedWebhookData = {
      ...mappedData,
      phone: validation.phone,
      phone_ddi: validation.phone_ddi,
    };

    const contactId = await this.createContactWithLabels(
      accountId,
      workerId,
      mappedDataWithValidatedPhone,
      validation.is_valided,
      validation.validation_origin
    );
    if (!contactId) {
      return buildTransientValidationResult(validation);
    }

    if (!validation.is_valided) {
      return {
        contactId,
        is_valided: false,
        phone_validated: validation.phone,
        phone_ddi_validated: validation.phone_ddi,
      };
    }

    return {
      contactId,
      is_valided: true,
      phone_validated: validation.phone,
      phone_ddi_validated: validation.phone_ddi,
    };
  };

  private resolveInteractionPhoneAndDdi = (
    fallbackPhoneAndDdi: { phone: string; phone_ddi: string | null },
    contact: {
      contactId: string;
      is_valided: boolean;
      phone_validated?: string;
      phone_ddi_validated?: string | null;
    }
  ): { phone: string; phone_ddi: string | null } => {
    if (!contact.phone_validated) {
      return fallbackPhoneAndDdi;
    }

    const fullPhoneCandidate = `${contact.phone_ddi_validated ?? ''}${contact.phone_validated}`;
    const extracted = extractPhoneAndDdi(fullPhoneCandidate);

    if (extracted) {
      return extracted;
    }

    return {
      phone: contact.phone_validated,
      phone_ddi: contact.phone_ddi_validated ?? fallbackPhoneAndDdi.phone_ddi,
    };
  };

  private shouldAutoSaveContact = async (
    workerId: string
  ): Promise<boolean> => {
    const workerConfig =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(workerId);

    return Boolean(workerConfig?.auto_save_contacts);
  };

  private async buildExistingContactResult(
    accountId: string,
    workerId: string,
    contactId: string,
    isValided: boolean,
    existingValidationOrigin: ContactValidationOrigin | null,
    contactPhoneDdi: string | null,
    phoneAndDdi: { phone: string; phone_ddi: string | null },
    mappedData: IMappedWebhookData,
    currentValidation: {
      phone: string;
      phone_ddi: string;
      is_valided: boolean;
      validation_origin: ContactValidationOrigin | null;
    }
  ): Promise<{
    contactId: string;
    is_valided: boolean;
    phone_validated?: string;
    phone_ddi_validated?: string | null;
  }> {
    await this.addLabelsToExistingContact(
      accountId,
      workerId,
      contactId,
      mappedData
    );

    if (currentValidation.is_valided) {
      const shouldSyncValidation =
        !isValided ||
        (currentValidation.validation_origin !== null &&
          existingValidationOrigin !== currentValidation.validation_origin);
      const synced = shouldSyncValidation
        ? await this.contactService.updateContactValidation(
            contactId,
            `${currentValidation.phone_ddi}${currentValidation.phone}`,
            true,
            accountId,
            undefined,
            currentValidation.validation_origin
          )
        : true;

      return {
        contactId,
        is_valided: synced ? true : isValided,
        phone_validated: currentValidation.phone,
        phone_ddi_validated: currentValidation.phone_ddi,
      };
    }

    if (!isValided) {
      return {
        contactId,
        is_valided: false,
        phone_validated: currentValidation.phone,
        phone_ddi_validated: currentValidation.phone_ddi,
      };
    }

    const sensitive =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);
    if (!sensitive?.phone) {
      return { contactId, is_valided: true };
    }

    return {
      contactId,
      is_valided: true,
      phone_validated: sensitive.phone,
      phone_ddi_validated: contactPhoneDdi ?? phoneAndDdi.phone_ddi ?? null,
    };
  }

  listUsersForWebhook = async (
    accountId: string
  ): Promise<ListIntegrationUsersResponse> => {
    const users = await this.userService.listUsersForTransfer(accountId);
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
      status: user.status ?? null,
    }));
  };

  listSectorsForWebhook = async (
    accountId: string
  ): Promise<ListIntegrationSectorsResponse> => {
    const sectors = await this.sectorService.listSectorsForTransfer(accountId);
    return sectors.map((sector) => ({
      id: sector.id,
      name: sector.name,
      color: sector.color ?? null,
    }));
  };

  listSectorUsersForWebhook = async (
    accountId: string,
    sectorId: string
  ): Promise<ListIntegrationSectorUsersResponse> => {
    const users = await this.sectorService.listSectorUsersForTransfer(
      accountId,
      sectorId
    );
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
      status: user.status ?? null,
    }));
  };

  listInputChatbotsForWebhook = async (
    accountId: string
  ): Promise<ListIntegrationInputChatbotsResponse> => {
    const chatbots = await this.chatbotService.listChatbots(accountId);
    const inputChatbots = chatbots.filter(
      (chatbot) => chatbot.type === EChatbotType.input
    );
    return inputChatbots.map((chatbot) => ({
      chatbot_id: chatbot.chatbot_id,
      name: chatbot.name,
      type: chatbot.type ?? null,
      created_at: chatbot.created_at,
    }));
  };

  private addLabelsToExistingContact = async (
    accountId: string,
    workerId: string,
    contactId: string,
    mappedData: IMappedWebhookData
  ): Promise<void> => {
    if (!mappedData.labels || mappedData.labels.length === 0) {
      return;
    }

    const labelTemplateIds = await this.dbRw.transaction(async (tx) => {
      return this.processLabelsInTransaction(tx, accountId, mappedData.labels);
    });

    const addLabelPromises: Promise<boolean>[] = [];
    for (let i = 0; i < labelTemplateIds.length; i++) {
      addLabelPromises.push(
        this.contactService.addContactLabelTemplateIfNotExists(
          contactId,
          labelTemplateIds[i],
          accountId,
          {
            source: 'integration_webhook',
            idempotencyKey: `integration-contact-label-added:${contactId}:${labelTemplateIds[i]}`,
            originChannelId: workerId,
            actor: { type: 'system' },
            changes: { added_label_template_id: labelTemplateIds[i] },
          }
        )
      );
    }
    await Promise.all(addLabelPromises);
  };

  private createContactWithLabels = async (
    accountId: string,
    workerId: string,
    mappedData: IMappedWebhookData,
    isValidated: boolean,
    validationOrigin: ContactValidationOrigin | null
  ): Promise<string | null> => {
    const requestedContactId = uuidv7();
    const preparedEvent = await this.prepareIntegrationContactCreatedEvent(
      accountId,
      workerId,
      requestedContactId,
      mappedData,
      isValidated
    );
    const contactId = await this.dbRw.transaction(async (tx) => {
      const labelTemplateIds = await this.processLabelsInTransaction(
        tx,
        accountId,
        mappedData.labels
      );

      return this.createContactFromWebhookInTransaction(
        tx,
        accountId,
        workerId,
        mappedData,
        labelTemplateIds,
        isValidated,
        validationOrigin,
        requestedContactId,
        preparedEvent?.state === 'preparing'
          ? {
              eventId: preparedEvent.eventId,
              accountId,
              envelope: preparedEvent.envelope,
            }
          : null
      );
    });

    if (contactId) {
      await this.completeIntegrationContactCreatedEvent(
        accountId,
        preparedEvent
      );
    }

    return contactId;
  };

  private prepareIntegrationContactCreatedEvent = async (
    accountId: string,
    workerId: string,
    contactId: string,
    mappedData: IMappedWebhookData,
    isValidated: boolean
  ): Promise<PreparedOutboundWebhookEvent | null> => {
    if (!this.outboundWebhookEventService) return null;
    const labelTemplates = (mappedData.labels ?? [])
      .filter((label): label is string => typeof label === 'string')
      .map((label) => label.trim())
      .filter(Boolean)
      .map((label) => ({ label: this.truncateLabelName(label, 255) }));

    return this.outboundWebhookEventService.prepareBestEffort({
      accountId,
      eventType: 'contact.created',
      aggregate: { type: 'contact', id: contactId },
      data: {
        contact: serializePublicContact({
          contact_id: contactId,
          name: mappedData.first_name ?? '',
          last_name: mappedData.last_name ?? null,
          nickname: mappedData.nickname ?? null,
          photo: null,
          birthday: nullIfEmpty(mappedData.birthday ?? null),
          email: mappedData.email ?? null,
          phone_ddi: mappedData.phone_ddi || '55',
          phone: mappedData.phone ?? null,
          notes: mappedData.notes ?? null,
          document_partial: null,
          contact_document_type_id: null,
          user_id: null,
          ignore: null,
          is_valided: isValidated,
          label_templates: labelTemplates,
          channel_ids: [workerId],
          contact_groups: [],
        }),
        changes: { origin: 'integration_webhook' },
      },
      previous: null,
      source: 'integration_webhook',
      channelIds: [workerId],
      actor: { type: 'system' },
      idempotencyKey: `integration-contact-created:${contactId}`,
    });
  };

  private completeIntegrationContactCreatedEvent = async (
    accountId: string,
    prepared: PreparedOutboundWebhookEvent | null
  ): Promise<void> => {
    if (!prepared || !this.outboundWebhookEventService) return;

    await this.outboundWebhookEventService.completePersistedBestEffort({
      eventId: prepared.eventId,
      accountId,
    });
  };

  private sendToWebhookIntegrationConsumer = async (
    accountId: string,
    workerId: string,
    contact: {
      contactId: string;
      is_valided: boolean;
      phone_validated?: string;
      phone_ddi_validated?: string | null;
    },
    mappedData: IMappedWebhookData,
    mapping: Record<string, string | string[]>,
    body: Record<string, unknown>,
    phoneAndDdi: { phone: string; phone_ddi: string | null },
    integrationEntitlementRevision: string,
    operationId: string
  ): Promise<void> => {
    const request: IWebhookIntegrationRequest = {
      operation_id: operationId,
      integration_entitlement_revision: integrationEntitlementRevision,
      account_id: accountId,
      worker_id: workerId,
      contact_id: contact.contactId,
      contact_is_valided: contact.is_valided,
      phone_validated: contact.phone_validated,
      phone_ddi_validated: contact.phone_ddi_validated,
      mapped_data: mappedData,
      mapping,
      body,
      phone: phoneAndDdi.phone,
      phone_ddi: phoneAndDdi.phone_ddi,
    };

    await this.workerCommandAdmissionService.admit({
      accountId,
      workerId,
      commandType: 'webhook_integration',
      entityKey: buildWebhookIntegrationEntityKey(request),
      operationId,
      payload: request as unknown as Record<string, never>,
      source: 'webhook_integration',
    });
  };

  private extractLabelValue = (value: unknown): string[] => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }
      return [trimmed];
    }

    if (Array.isArray(value)) {
      const result: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const v = value[i];
        if (typeof v !== 'string') {
          continue;
        }
        const trimmed = v.trim();
        if (trimmed.length > 0) {
          result.push(trimmed);
        }
      }
      return result;
    }

    return [];
  };

  private processLabelsMapping = (
    body: Record<string, unknown>,
    mappingKey: string | string[]
  ): string[] => {
    const labelValues: string[] = [];

    if (Array.isArray(mappingKey)) {
      for (let i = 0; i < mappingKey.length; i++) {
        const value = this.getNestedValue(body, mappingKey[i]);
        const extracted = this.extractLabelValue(value);
        labelValues.push(...extracted);
      }
      return this.removeDuplicateLabels(labelValues);
    }

    const value = this.getNestedValue(body, mappingKey);
    const extracted = this.extractLabelValue(value);
    labelValues.push(...extracted);
    return this.removeDuplicateLabels(labelValues);
  };

  private removeDuplicateLabels = (labels: string[]): string[] => {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const normalized = label.toLowerCase().trim();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        unique.push(label);
      }
    }

    return unique;
  };

  private mapWebhookData = (
    body: Record<string, unknown>,
    mapping: Record<string, string | string[]>
  ): IMappedWebhookData => {
    const mapped: IMappedWebhookData = {};
    const entries = Object.entries(mapping);

    for (let i = 0; i < entries.length; i++) {
      const [fieldKey, mappingKey] = entries[i];

      if (fieldKey === 'labels') {
        mapped.labels = this.processLabelsMapping(body, mappingKey);
        continue;
      }

      if (typeof mappingKey !== 'string') {
        continue;
      }

      const value = this.getNestedValueFromMapping(body, mappingKey);
      if (value === null || value === undefined) {
        continue;
      }

      this.assignMappedValue(mapped, fieldKey, value);
    }

    return mapped;
  };

  private getNestedValueFromMapping = (
    body: Record<string, unknown>,
    mappingKey: string
  ): unknown => {
    const isPath = mappingKey.includes('.') || mappingKey.includes('[');

    if (!isPath) {
      return mappingKey;
    }

    return this.getNestedValue(body, mappingKey);
  };

  private assignMappedValue = (
    mapped: IMappedWebhookData,
    fieldKey: string,
    value: unknown
  ): void => {
    const stringValue = String(value);

    if (fieldKey === 'message_type') {
      mapped.message_type = stringValue as 'message' | 'chatbot';
      return;
    }

    if (fieldKey === 'transfer_sector_id') {
      mapped.transfer_sector_id = stringValue;
      return;
    }

    if (fieldKey === 'transfer_sector_user_id') {
      mapped.transfer_sector_user_id = stringValue;
      return;
    }

    if (fieldKey === 'transfer_user_id') {
      mapped.transfer_user_id = stringValue;
      return;
    }

    if (fieldKey === 'chatbot_id') {
      mapped.chatbot_id = stringValue;
      return;
    }

    if (fieldKey === 'message') {
      mapped.message = stringValue;
      return;
    }

    if (fieldKey === 'first_name') {
      mapped.first_name = stringValue;
      return;
    }

    if (fieldKey === 'last_name') {
      mapped.last_name = stringValue;
      return;
    }

    if (fieldKey === 'nickname') {
      mapped.nickname = stringValue;
      return;
    }

    if (fieldKey === 'birthday') {
      mapped.birthday = stringValue;
      return;
    }

    if (fieldKey === 'email') {
      mapped.email = stringValue;
      return;
    }

    if (fieldKey === 'phone_ddi') {
      mapped.phone_ddi = stringValue;
      return;
    }

    if (fieldKey === 'phone') {
      mapped.phone = stringValue;
      return;
    }

    if (fieldKey === 'notes') {
      mapped.notes = stringValue;
      return;
    }
  };

  private getNestedValue = (
    obj: Record<string, unknown>,
    path: string
  ): unknown => {
    const keys = path.split('.');
    let current: unknown = obj;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof current !== 'object' || current === null) {
        return null;
      }

      const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const arrayKey = arrayMatch[1];
        const arrayIndex = Number.parseInt(arrayMatch[2], 10);

        if (!(arrayKey in current)) {
          return null;
        }

        const arrayValue = (current as Record<string, unknown>)[arrayKey];
        if (!Array.isArray(arrayValue)) {
          return null;
        }

        if (arrayIndex < 0 || arrayIndex >= arrayValue.length) {
          return null;
        }

        current = arrayValue[arrayIndex];
        continue;
      }

      if (!(key in current)) {
        return null;
      }

      current = (current as Record<string, unknown>)[key];
    }

    return current;
  };

  private generateRandomColor = (): string => {
    const colors = [
      '#1976D2',
      '#388E3C',
      '#F57C00',
      '#7B1FA2',
      '#C2185B',
      '#00796B',
      '#0288D1',
      '#5D4037',
      '#455A64',
      '#E64A19',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  private truncateLabelName = (name: string, maxLength: number): string => {
    if (name.length <= maxLength) {
      return name;
    }
    return name.substring(0, maxLength);
  };

  private processLabelsInTransaction = async (
    tx: Transaction,
    accountId: string,
    labels?: string[]
  ): Promise<string[]> => {
    if (!labels || labels.length === 0) {
      return [];
    }

    const promises: Promise<string | null>[] = [];
    for (let i = 0; i < labels.length; i++) {
      promises.push(
        this.resolveOrCreateLabelInTransaction(tx, accountId, labels[i])
      );
    }

    const results = await Promise.all(promises);
    const labelTemplateIds: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const id = results[i];
      if (id) {
        labelTemplateIds.push(id);
      }
    }
    return labelTemplateIds;
  };

  private resolveOrCreateLabelInTransaction = async (
    tx: Transaction,
    accountId: string,
    labelName: unknown
  ): Promise<string | null> => {
    try {
      if (!labelName || typeof labelName !== 'string') {
        return null;
      }

      const trimmedName = labelName.trim();
      if (!trimmedName) {
        return null;
      }

      const truncatedName = this.truncateLabelName(trimmedName, 255);

      const existingLabel =
        await this.labelTemplateViewerByNameRepository.viewLabelTemplateByNameInTransaction(
          tx,
          accountId,
          truncatedName
        );

      if (existingLabel) {
        return existingLabel.label_template_id;
      }

      return this.createLabelTemplateInTransaction(
        tx,
        accountId,
        truncatedName
      );
    } catch {
      return null;
    }
  };

  private createLabelTemplateInTransaction = async (
    tx: Transaction,
    accountId: string,
    labelName: string
  ): Promise<string | null> => {
    const color = this.generateRandomColor();

    return this.labelTemplateCreatorRepository.createLabelTemplateInTransaction(
      tx,
      {
        label: labelName,
        color,
        label_status: {
          label_status_id: ELabelStatus.active,
        },
      },
      accountId
    );
  };

  private processEmailFieldsForContact = (
    email?: string | null
  ): {
    emailCEncrypted: string | null;
    emailPartialEncrypted: string | null;
    emailC: string | null;
  } => {
    if (!email) {
      return {
        emailCEncrypted: null,
        emailPartialEncrypted: null,
        emailC: null,
      };
    }

    return {
      emailCEncrypted: this.passwordEncryptorService.encrypt(email),
      emailPartialEncrypted: (
        this.encryptService.sanitize(email, ETypeSanetize.email) ?? ''
      ).slice(0, 50),
      emailC: this.encryptService.encrypt(email),
    };
  };

  private processPhoneFieldsForContact = (
    phone?: string | null
  ): {
    phoneCEncrypted: string | null;
    phonePartialEncrypted: string | null;
    phoneC: string | null;
  } => {
    if (!phone) {
      return {
        phoneCEncrypted: null,
        phonePartialEncrypted: null,
        phoneC: null,
      };
    }

    return {
      phoneCEncrypted: this.passwordEncryptorService.encrypt(phone),
      phonePartialEncrypted: this.encryptService.sanitize(
        phone,
        ETypeSanetize.phone
      ),
      phoneC: this.encryptService.encrypt(phone),
    };
  };

  private createContactFromWebhookInTransaction = async (
    tx: Transaction,
    accountId: string,
    workerId: string,
    mappedData: IMappedWebhookData,
    labelTemplateIds: string[],
    isValidated: boolean,
    validationOrigin: ContactValidationOrigin | null,
    requestedContactId: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<string | null> => {
    if (!mappedData.phone) {
      return null;
    }

    const emailFields = this.processEmailFieldsForContact(mappedData.email);
    const phoneFields = this.processPhoneFieldsForContact(mappedData.phone);
    const contactPayload = this.buildContactPayload(
      accountId,
      workerId,
      mappedData,
      emailFields,
      phoneFields,
      labelTemplateIds,
      isValidated,
      validationOrigin
    );

    return this.contactCreatorRepository.createContact(
      contactPayload,
      tx,
      requestedContactId,
      webhookMarker
    );
  };

  private buildContactPayload = (
    accountId: string,
    workerId: string,
    mappedData: IMappedWebhookData,
    emailFields: {
      emailCEncrypted: string | null;
      emailPartialEncrypted: string | null;
      emailC: string | null;
    },
    phoneFields: {
      phoneCEncrypted: string | null;
      phonePartialEncrypted: string | null;
      phoneC: string | null;
    },
    labelTemplateIds: string[],
    isValidated: boolean,
    validationOrigin: ContactValidationOrigin | null
  ) => {
    return {
      account_id: accountId,
      channel_ids: [workerId],
      label_template_ids: labelTemplateIds.length > 0 ? labelTemplateIds : null,
      contact_document_type_id: null,
      is_valided: isValidated,
      validation_origin: isValidated ? validationOrigin : null,
      name: mappedData.first_name || '',
      last_name: mappedData.last_name || null,
      email: emailFields.emailCEncrypted,
      email_partial: emailFields.emailPartialEncrypted,
      email_c: emailFields.emailC,
      phone_ddi: mappedData.phone_ddi || '55',
      phone: phoneFields.phoneCEncrypted,
      phone_partial: phoneFields.phonePartialEncrypted,
      phone_c: phoneFields.phoneC,
      nickname: mappedData.nickname || null,
      photo: null,
      birthday: nullIfEmpty(mappedData.birthday || null),
      notes: mappedData.notes || null,
      document: null,
      document_partial: null,
      document_c: null,
      user_id: null,
      ignore: null,
    };
  };
}
