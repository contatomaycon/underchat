import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
import { IWebhookIntegrationRequest } from '@core/common/interfaces/IWebhookIntegrationRequest';
import { WwebjsService } from '@core/services/wwebjs';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  CONTACT_VALIDATION_WEBHOOK_INTEGRATION_SOURCE,
  IWebhookIntegrationContactValidationUpdate,
} from '@core/common/interfaces/IContactValidationUpdate';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import {
  resolveWebhookInteractionJids,
  type IWebhookInteractionJids,
} from '@core/common/functions/resolveWebhookInteractionJids';
import { buildUpsertMessageKafkaKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
} from '@core/common/exceptions/PlanEntitlementError';
import { WorkerIntegrationEntitlementService } from '@core/services/workerIntegrationEntitlement.service';
import {
  isWebhookIntegrationEntitlementUnavailableError,
  WebhookIntegrationEntitlementUnavailableError,
} from './WebhookIntegrationEntitlementFailure';
import {
  createPlanEntitlementAuditContext,
  getPlanEntitlementAuditSource,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';
import { buildWebhookIntegrationStanzaId } from '@core/common/functions/webhookIntegrationIdentity';
import { ensureInboundEventId } from '@core/common/functions/inboundEventIdentity';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import type { IWhatsappRuntimeFence } from '@core/services/whatsappRuntimeFence.service';

class WebhookIntegrationRuntimeStaleError extends Error {
  constructor() {
    super('Webhook integration runtime is stale');
    this.name = 'WebhookIntegrationRuntimeStaleError';
  }
}

@singleton()
export class WebhookIntegrationWwebjsConsume {
  constructor(
    @inject(WwebjsService)
    private readonly wwebjsService: WwebjsService,
    @inject(WwebjsIncomingMessageService)
    private readonly wwebjsIncomingMessageService: WwebjsIncomingMessageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerIntegrationEntitlementService)
    private readonly workerIntegrationEntitlementService: WorkerIntegrationEntitlementService
  ) {}

  public async handleJetStreamCommand(
    commandId: string,
    payload: unknown,
    assertActive: () => void
  ): Promise<void> {
    const data = this.parseMessage(
      Buffer.from(JSON.stringify(payload), 'utf8')
    );
    if (!data || !data.account_id || !data.worker_id) {
      throw new Error('worker_command_webhook_payload_invalid');
    }
    data.operation_id = data.operation_id?.trim() || commandId;
    await this.processWebhookIntegration(data, assertActive);
  }

  private parseMessage(
    value: Buffer | null
  ): IWebhookIntegrationRequest | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value.toString()) as IWebhookIntegrationRequest;
    } catch {
      return null;
    }
  }

  private async processWebhookIntegration(
    data: IWebhookIntegrationRequest,
    assertActive: () => void = () => undefined
  ): Promise<void> {
    const connectionScope =
      await this.captureActiveConnectionScope(assertActive);
    if (
      !(await this.hasCurrentIntegrationEntitlement(
        data,
        'received',
        undefined,
        assertActive
      ))
    ) {
      return;
    }

    assertActive();
    const resolvedJids = await this.resolveRemoteJidForInteraction(
      data,
      assertActive,
      connectionScope
    );
    if (!resolvedJids) {
      return;
    }

    assertActive();
    const upsertMessage = this.buildUpsertMessage(data, resolvedJids);

    if (!upsertMessage) {
      throw new Error('webhook_integration_operation_identity_missing');
    }
    upsertMessage.worker_id = connectionScope.worker_id;
    upsertMessage.source_provider = connectionScope.source_provider;
    upsertMessage.runtime_generation = connectionScope.runtime_generation;
    upsertMessage.connection_epoch = connectionScope.connection_epoch;

    await this.assertConnectionScopeActive(connectionScope, assertActive);
    if (
      !(await this.hasCurrentIntegrationEntitlement(
        data,
        'publish',
        upsertMessage.message.key.id,
        assertActive
      ))
    ) {
      return;
    }

    await this.sendToMessageUpsert(
      upsertMessage,
      assertActive,
      connectionScope
    );
  }

  private async hasCurrentIntegrationEntitlement(
    data: IWebhookIntegrationRequest,
    stage: 'received' | 'publish',
    eventId?: string,
    assertActive: () => void = () => undefined
  ): Promise<boolean> {
    assertActive();
    if (!data.integration_entitlement_revision) {
      planEntitlementTelemetryStore.recordDecision('inbound_worker', 'denied');
      planEntitlementTelemetryStore.recordSuppression(
        'inbound_worker',
        'legacy_revision_missing'
      );
      console.warn(
        '[PlanEntitlementAudit] Dropping legacy inbound webhook event',
        {
          ...createPlanEntitlementAuditContext({
            surface: 'inbound_worker',
            outcome: 'denied',
            accountId: data.account_id,
            planProductId: EPlanProduct.integration,
            source: null,
            eventId,
            reason: 'integration_entitlement_missing',
          }),
          stage,
          worker_id: data.worker_id,
        }
      );
      return false;
    }

    try {
      const entitlement =
        await this.workerIntegrationEntitlementService.assertEntitled(
          data.account_id,
          EPlanProduct.integration,
          { expectedRevision: data.integration_entitlement_revision }
        );
      assertActive();
      planEntitlementTelemetryStore.recordDecision('inbound_worker', 'allowed');
      if (stage === 'publish') {
        console.info(
          '[PlanEntitlementAudit] Inbound webhook worker admitted event',
          createPlanEntitlementAuditContext({
            surface: 'inbound_worker',
            outcome: 'allowed',
            accountId: data.account_id,
            planProductId: EPlanProduct.integration,
            revision:
              entitlement?.revision ?? data.integration_entitlement_revision,
            source: entitlement?.source,
            eventId,
          })
        );
      }
      return true;
    } catch (error) {
      if (
        error instanceof PlanEntitlementDeniedError ||
        error instanceof PlanEntitlementRevisionMismatchError
      ) {
        assertActive();
        planEntitlementTelemetryStore.recordDecision(
          'inbound_worker',
          'denied'
        );
        planEntitlementTelemetryStore.recordSuppression(
          'inbound_worker',
          error instanceof PlanEntitlementRevisionMismatchError
            ? 'revision_mismatch'
            : 'integration_entitlement_missing'
        );
        console.warn(
          '[PlanEntitlementAudit] Dropping stale inbound webhook event',
          {
            ...createPlanEntitlementAuditContext({
              surface: 'inbound_worker',
              outcome: 'denied',
              accountId: data.account_id,
              planProductId: EPlanProduct.integration,
              revision: error.entitlement.revision,
              source: getPlanEntitlementAuditSource(error.entitlement),
              eventId,
              reason: 'integration_entitlement_missing',
            }),
            stage,
            worker_id: data.worker_id,
            expected_revision: data.integration_entitlement_revision,
          }
        );
        return false;
      }
      planEntitlementTelemetryStore.recordDecision(
        'inbound_worker',
        'unavailable'
      );
      assertActive();
      throw new WebhookIntegrationEntitlementUnavailableError(stage, error);
    }
  }

  private async validatePhone(
    phone: string,
    phoneDdi: string | null,
    assertActive: () => void = () => undefined,
    connectionScope?: IWhatsappRuntimeFence
  ): Promise<{ valid: boolean; jid?: string; phone?: string }> {
    const phoneDdiToUse = phoneDdi ?? '55';
    const activeScope =
      connectionScope ??
      (await this.captureActiveConnectionScope(assertActive));
    await this.assertConnectionScopeActive(activeScope, assertActive);
    const result = await this.wwebjsService.validatePhone(phoneDdiToUse, phone);
    await this.assertConnectionScopeActive(activeScope, assertActive);
    return result;
  }

  private isLidJid(jid?: string | null): boolean {
    return !!jid && jid.endsWith('@lid');
  }

  private normalizePhoneDigits(
    value: string | null | undefined
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = onlyDigits(value);
    return digits || undefined;
  }

  private isResolvedPhoneEquivalentToLid(
    lidJid: string,
    resolvedPhone: string | undefined
  ): boolean {
    const lidDigits = this.normalizePhoneDigits(lidJid.split('@')[0]);
    const resolvedDigits = this.normalizePhoneDigits(resolvedPhone);

    return !!lidDigits && !!resolvedDigits && lidDigits === resolvedDigits;
  }

  private shouldFallbackFromLidResolvedPhone(result: {
    jid?: string;
    phone?: string;
  }): boolean {
    if (!this.isLidJid(result.jid) || !result.jid) {
      return false;
    }

    return this.isResolvedPhoneEquivalentToLid(result.jid, result.phone);
  }

  private buildValidationCandidates(
    request: IWebhookIntegrationRequest
  ): Array<{ phone: string; phoneDdi: string; phoneWithDdi: string }> {
    const candidates: Array<{
      phone: string;
      phoneDdi: string;
      phoneWithDdi: string;
    }> = [];
    const seen = new Set<string>();

    const addCandidate = (
      phone: string | null | undefined,
      phoneDdi: string | null | undefined
    ) => {
      if (!phone) {
        return;
      }

      const normalizedPhone = onlyDigits(phone);
      if (!normalizedPhone) {
        return;
      }

      const normalizedDdi = onlyDigits(phoneDdi ?? '55') || '55';
      const phoneWithDdi = `${normalizedDdi}${normalizedPhone}`;
      if (seen.has(phoneWithDdi)) {
        return;
      }

      seen.add(phoneWithDdi);
      candidates.push({
        phone: normalizedPhone,
        phoneDdi: normalizedDdi,
        phoneWithDdi,
      });
    };

    addCandidate(request.phone, request.phone_ddi);
    addCandidate(request.phone_validated, request.phone_ddi_validated);

    return candidates;
  }

  private resolveValidatedPhoneWithDdi(
    result: { jid?: string; phone?: string },
    fallbackPhoneWithDdi: string
  ): string {
    const shouldFallbackFromLid =
      this.shouldFallbackFromLidResolvedPhone(result);

    if (shouldFallbackFromLid) {
      console.warn('[WebhookIntegrationWwebjs] lid_phone_fallback_applied', {
        lid_jid: result.jid ?? null,
        resolved_phone: result.phone ?? null,
        fallback_phone_with_ddi: fallbackPhoneWithDdi,
        reason: 'lid_equivalent',
      });
    }

    if (result.phone && !shouldFallbackFromLid) {
      const extracted = extractPhoneAndDdi(result.phone);
      if (extracted) {
        return `${extracted.phone_ddi}${extracted.phone}`;
      }
    }

    if (!this.isLidJid(result.jid)) {
      const phoneFromJid = getPhoneFromJid(result.jid, null);
      if (phoneFromJid) {
        const extracted = extractPhoneAndDdi(phoneFromJid);
        if (extracted) {
          return `${extracted.phone_ddi}${extracted.phone}`;
        }
      }
    }

    return fallbackPhoneWithDdi;
  }

  private getFallbackCandidate(
    request: IWebhookIntegrationRequest
  ): { phone: string; phoneDdi: string; phoneWithDdi: string } | null {
    const [firstCandidate] = this.buildValidationCandidates(request);
    return firstCandidate ?? null;
  }

  private buildPhoneWithDdi(
    phone: string | null | undefined,
    phoneDdi: string | null | undefined
  ): string {
    return `${phoneDdi ?? '55'}${phone ?? ''}`;
  }

  private isTechnicalValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('deadline exceeded') ||
      errorMessage.includes('no active worker') ||
      errorMessage.includes('disconnected') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('unavailable') ||
      errorMessage.includes('not connected')
    );
  }

  private isInvalidValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('phone_number_not_valid_on_whatsapp') ||
      errorMessage.includes('phone number is not valid on whatsapp')
    );
  }

  private shouldPublishSuccessContactUpdate(
    request: IWebhookIntegrationRequest,
    validatedPhoneWithDdi: string
  ): boolean {
    if (!request.contact_is_valided) {
      return true;
    }

    const currentPhoneWithDdi = request.phone_validated
      ? this.buildPhoneWithDdi(
          request.phone_validated,
          request.phone_ddi_validated
        )
      : this.buildPhoneWithDdi(request.phone, request.phone_ddi);

    return (
      onlyDigits(currentPhoneWithDdi) !== onlyDigits(validatedPhoneWithDdi)
    );
  }

  private async publishContactValidationUpdate(
    request: IWebhookIntegrationRequest,
    phoneWithDdi: string,
    isValidated: boolean,
    assertActive: () => void = () => undefined,
    connectionScope?: IWhatsappRuntimeFence
  ): Promise<boolean> {
    if (!request.contact_id?.trim()) {
      return true;
    }

    const activeScope =
      connectionScope ??
      (await this.captureActiveConnectionScope(assertActive));
    await this.assertConnectionScopeActive(activeScope, assertActive);
    if (
      !(await this.hasCurrentIntegrationEntitlement(
        request,
        'publish',
        undefined,
        assertActive
      ))
    ) {
      return false;
    }

    const payload: IWebhookIntegrationContactValidationUpdate = {
      contact_id: request.contact_id,
      phone: phoneWithDdi,
      is_validated: isValidated,
      account_id: request.account_id,
      integration_entitlement_revision:
        request.integration_entitlement_revision,
      operation_id: request.operation_id,
      source: CONTACT_VALIDATION_WEBHOOK_INTEGRATION_SOURCE,
      worker_id: activeScope.worker_id,
      source_provider: activeScope.source_provider,
      runtime_generation: activeScope.runtime_generation,
      connection_epoch: activeScope.connection_epoch,
    };

    const topic = this.kafkaServiceQueueService.contactValidationUpdate();
    await this.assertConnectionScopeActive(activeScope, assertActive);
    await this.streamProducerService.send(
      topic,
      payload,
      `${request.account_id}:${request.contact_id}`
    );
    await this.assertConnectionScopeActive(activeScope, assertActive);
    return true;
  }

  private async resolveRemoteJidForInteraction(
    request: IWebhookIntegrationRequest,
    assertActive: () => void = () => undefined,
    connectionScope?: IWhatsappRuntimeFence
  ): Promise<IWebhookInteractionJids | null> {
    assertActive();
    const candidates = this.buildValidationCandidates(request);
    if (!candidates.length) {
      return null;
    }

    let hasInvalidPhone = false;
    for (const candidate of candidates) {
      try {
        const result = await this.validatePhone(
          candidate.phone,
          candidate.phoneDdi,
          assertActive,
          connectionScope
        );

        if (!result.valid) {
          hasInvalidPhone = true;
          continue;
        }

        const validatedPhoneWithDdi = this.resolveValidatedPhoneWithDdi(
          result,
          candidate.phoneWithDdi
        );

        if (
          this.shouldPublishSuccessContactUpdate(request, validatedPhoneWithDdi)
        ) {
          if (
            !(await this.publishContactValidationUpdate(
              request,
              validatedPhoneWithDdi,
              true,
              assertActive,
              connectionScope
            ))
          ) {
            return null;
          }
        }

        const resolvedJids = resolveWebhookInteractionJids({
          validatedJid: result.jid ?? null,
          validatedPhoneWithDdi,
          fallbackPhone: candidate.phone,
          fallbackPhoneDdi: candidate.phoneDdi,
        });

        if (resolvedJids) {
          return resolvedJids;
        }
      } catch (error) {
        if (isWebhookIntegrationEntitlementUnavailableError(error)) {
          throw error;
        }

        if (this.isInvalidValidationError(error)) {
          hasInvalidPhone = true;
          continue;
        }

        if (this.isTechnicalValidationError(error)) {
          throw error instanceof Error ? error : new Error(String(error));
        }

        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    const fallbackCandidate = this.getFallbackCandidate(request);
    if (!fallbackCandidate) {
      return null;
    }

    if (hasInvalidPhone) {
      if (
        !(await this.publishContactValidationUpdate(
          request,
          fallbackCandidate.phoneWithDdi,
          false,
          assertActive,
          connectionScope
        ))
      ) {
        return null;
      }
    }

    return resolveWebhookInteractionJids({
      validatedPhoneWithDdi: fallbackCandidate.phoneWithDdi,
      fallbackPhone: fallbackCandidate.phone,
      fallbackPhoneDdi: fallbackCandidate.phoneDdi,
    });
  }

  private buildUpsertMessage(
    request: IWebhookIntegrationRequest,
    resolvedJids: IWebhookInteractionJids
  ): IUpsertMessage | null {
    const messageText = this.extractMessageText(request);
    const stanzaId = buildWebhookIntegrationStanzaId(request);
    if (!stanzaId) {
      return null;
    }
    const waMessage = this.buildWaMessage(
      resolvedJids.remoteJid,
      resolvedJids.remoteJidAlt,
      messageText ?? '',
      stanzaId
    );

    const upsert: IUpsertMessage = {
      integration_entitlement_revision:
        request.integration_entitlement_revision,
      account_id: request.account_id,
      worker_id: request.worker_id,
      source_provider: 'webhook',
      type: EMessageType.text,
      message: waMessage,
      has_quoted: false,
      is_call_event: false,
    };

    const webhookType = request.mapped_data.message_type;
    if (webhookType === 'message' || webhookType === 'chatbot') {
      upsert.webhook_message_type = webhookType;
    }

    if (request.mapped_data.chatbot_id) {
      upsert.webhook_chatbot_id = request.mapped_data.chatbot_id;
    }

    if (request.mapped_data.transfer_sector_id) {
      upsert.transfer_sector_id = request.mapped_data.transfer_sector_id;
    }

    if (request.mapped_data.transfer_sector_user_id) {
      upsert.transfer_sector_user_id =
        request.mapped_data.transfer_sector_user_id;
    }

    if (request.mapped_data.transfer_user_id) {
      upsert.transfer_user_id = request.mapped_data.transfer_user_id;
    }

    return upsert;
  }

  private buildWaMessage(
    remoteJid: string,
    remoteJidAlt: string | undefined,
    messageText: string,
    stanzaId: string
  ): IUpsertMessage['message'] {
    return {
      key: {
        remoteJid,
        remoteJidAlt,
        fromMe: false,
        id: stanzaId,
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: {
        conversation: messageText,
      },
    };
  }

  private extractMessageText(
    request: IWebhookIntegrationRequest
  ): string | undefined {
    if (request.mapped_data.message_type === 'message') {
      return request.mapped_data.message;
    }

    if (request.mapped_data.message_type === 'chatbot') {
      const messageFromMapping = this.extractChatbotMessageFromBody(request);
      if (messageFromMapping !== undefined) {
        return messageFromMapping;
      }

      return request.mapped_data.message;
    }

    return undefined;
  }

  private extractChatbotMessageFromBody(
    request: IWebhookIntegrationRequest
  ): string | undefined {
    const messageMappingKey = request.mapping.message;
    if (!messageMappingKey || typeof messageMappingKey !== 'string') {
      return undefined;
    }

    const messageValue = this.getNestedValue(request.body, messageMappingKey);

    if (
      messageValue !== null &&
      messageValue !== undefined &&
      typeof messageValue === 'string'
    ) {
      return messageValue;
    }

    return undefined;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
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
  }

  private async sendToMessageUpsert(
    upsertMessage: IUpsertMessage,
    assertActive: () => void = () => undefined,
    connectionScope?: IWhatsappRuntimeFence
  ): Promise<void> {
    const topic = this.kafkaServiceQueueService.upsertMessage();
    const stanzaId = upsertMessage.message.key?.id?.trim();
    if (!stanzaId || !ensureInboundEventId(upsertMessage)) {
      throw new Error('webhook_integration_upsert_identity_missing');
    }
    const messageKey = buildUpsertMessageKafkaKey(upsertMessage, stanzaId);
    const activeScope =
      connectionScope ??
      (await this.captureActiveConnectionScope(assertActive));
    await this.assertConnectionScopeActive(activeScope, assertActive);
    await this.streamProducerService.send(topic, upsertMessage, messageKey);
    await this.assertConnectionScopeActive(activeScope, assertActive);
  }

  private async captureActiveConnectionScope(
    assertActive: () => void
  ): Promise<IWhatsappRuntimeFence> {
    assertActive();
    const scope =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    assertActive();
    if (
      !scope ||
      scope.worker_id !== wwebjsEnvironment.wwebjsWorkerId ||
      scope.source_provider !== 'wwebjs'
    ) {
      throw new WebhookIntegrationRuntimeStaleError();
    }
    return scope;
  }

  private async assertConnectionScopeActive(
    expected: IWhatsappRuntimeFence,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    const current =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    assertActive();
    if (
      !current ||
      current.worker_id !== expected.worker_id ||
      current.source_provider !== expected.source_provider ||
      current.runtime_generation !== expected.runtime_generation ||
      current.connection_epoch !== expected.connection_epoch
    ) {
      throw new WebhookIntegrationRuntimeStaleError();
    }
  }
}
