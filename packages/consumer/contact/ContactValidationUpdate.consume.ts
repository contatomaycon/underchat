import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import {
  CONTACT_VALIDATION_SCHEDULE_SOURCE,
  CONTACT_VALIDATION_WEBHOOK_INTEGRATION_SOURCE,
  IContactValidationUpdate,
} from '@core/common/interfaces/IContactValidationUpdate';
import { ContactService } from '@core/services/contact.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
} from '@core/common/exceptions/PlanEntitlementError';
import { InboundMessageSpoolService } from '@core/services/inboundMessageSpool.service';
import type {
  KafkaConsumerRunnerContext,
  KafkaConsumerRunnerDiscardReason,
  KafkaConsumerRunnerErrorDecision,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import {
  createPlanEntitlementAuditContext,
  getPlanEntitlementAuditSource,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import {
  StaleWhatsappRuntimeDatabaseFenceError,
  type WhatsappRuntimeDatabaseFence,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';
import { CONTACT_VALIDATION_ORIGINS } from '@core/common/types/ContactValidationOrigin';

class ContactValidationEntitlementMissingError extends Error {
  public readonly reason = 'integration_entitlement_missing' as const;

  constructor(public readonly cause?: unknown) {
    super('Integration entitlement is missing for contact validation update');
    this.name = 'ContactValidationEntitlementMissingError';
  }
}

class ContactValidationEntitlementUnavailableError extends Error {
  public readonly reason = 'plan_entitlement_unavailable' as const;

  constructor(public readonly cause: unknown) {
    super('Integration entitlement verification is unavailable');
    this.name = 'ContactValidationEntitlementUnavailableError';
  }
}

class ContactValidationRuntimeStaleError extends Error {
  public readonly reason = 'contact_validation_runtime_stale' as const;

  constructor() {
    super('Contact validation runtime is stale');
    this.name = 'ContactValidationRuntimeStaleError';
  }
}

@singleton()
export class ContactValidationUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IContactValidationUpdate> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService,
    @inject(InboundMessageSpoolService)
    private readonly inboundMessageSpoolService: InboundMessageSpoolService,
    @inject(WhatsappRuntimeFenceService)
    private readonly runtimeFence: WhatsappRuntimeFenceService
  ) {}

  private parseMessage(value: Buffer | null): IContactValidationUpdate | null {
    if (!value) return null;

    try {
      return JSON.parse(value.toString()) as IContactValidationUpdate;
    } catch {
      return null;
    }
  }

  private async processValidationUpdate(
    data: IContactValidationUpdate,
    assertActive: () => void = () => undefined
  ): Promise<void> {
    assertActive();
    await this.assertCurrentIntegrationEntitlement(data);
    assertActive();
    await this.assertCurrentRuntime(data);
    assertActive();

    const mutation = {
      source: data.source?.trim() || 'contact_validation_consumer',
      idempotencyKey: data.operation_id?.trim()
        ? `contact-validation-consumer:${data.operation_id}`
        : `contact-validation-consumer:${data.contact_id}`,
      actor: { type: 'system' as const },
      changes: { validation_origin: 'async_worker' },
      runtimeFence: this.runtimeDatabaseFence(data),
    };

    if (typeof data.phone !== 'string' || data.phone.trim() === '') {
      if (!data.is_validated) {
        await this.assertValidationMutationActive(data, assertActive);
        const updated = await this.contactService.updateContactIsValided(
          data.contact_id,
          false,
          data.account_id,
          mutation
        );
        if (!updated) throw new Error('contact_validation_update_not_applied');
      }
      return;
    }

    await this.assertValidationMutationActive(data, assertActive);
    const updated = await this.contactService.updateContactValidation(
      data.contact_id,
      data.phone,
      data.is_validated,
      data.account_id,
      mutation,
      data.is_validated ? CONTACT_VALIDATION_ORIGINS.whatsappLookup : null
    );
    if (!updated) throw new Error('contact_validation_update_not_applied');
  }

  private isWebhookIntegrationUpdate(data: IContactValidationUpdate): boolean {
    return (
      data.source?.trim() === CONTACT_VALIDATION_WEBHOOK_INTEGRATION_SOURCE
    );
  }

  private isScheduleUpdate(data: IContactValidationUpdate): boolean {
    return data.source?.trim() === CONTACT_VALIDATION_SCHEDULE_SOURCE;
  }

  private isRuntimeScopedUpdate(data: IContactValidationUpdate): boolean {
    return this.isScheduleUpdate(data) || this.isWebhookIntegrationUpdate(data);
  }

  private async assertCurrentRuntime(
    data: IContactValidationUpdate
  ): Promise<void> {
    if (!this.isRuntimeScopedUpdate(data)) {
      return;
    }

    if (
      (this.isScheduleUpdate(data) &&
        !WhatsappRuntimeFenceService.requiresFence(data.source_provider)) ||
      !(await this.runtimeFence.isCurrent(data))
    ) {
      throw new ContactValidationRuntimeStaleError();
    }
  }

  private async assertValidationMutationActive(
    data: IContactValidationUpdate,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    await this.assertCurrentRuntime(data);
    assertActive();
  }

  private runtimeDatabaseFence(
    data: IContactValidationUpdate
  ): WhatsappRuntimeDatabaseFence {
    const accountId = data.account_id?.trim();
    const workerId = data.worker_id?.trim();
    const sourceProvider = data.source_provider?.trim();
    const runtimeGeneration = Number(data.runtime_generation);
    const connectionEpoch = data.connection_epoch?.trim();
    if (
      !accountId ||
      !workerId ||
      !sourceProvider ||
      !connectionEpoch ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      throw new ContactValidationRuntimeStaleError();
    }

    return {
      account_id: accountId,
      worker_id: workerId,
      source_provider: sourceProvider,
      runtime_generation: runtimeGeneration,
      connection_epoch: connectionEpoch,
    };
  }

  private async assertCurrentIntegrationEntitlement(
    data: IContactValidationUpdate
  ): Promise<void> {
    // This topic predates source tagging and legacy records are ambiguous.
    // Rollout is intentionally fail-closed; every current producer emits an
    // explicit source, while untagged backlog is terminally discarded.
    if (!data.source?.trim()) {
      throw new ContactValidationEntitlementMissingError();
    }

    if (!this.isWebhookIntegrationUpdate(data)) {
      return;
    }

    const accountId = data.account_id?.trim();
    const revision = data.integration_entitlement_revision?.trim();
    if (!accountId || !revision) {
      planEntitlementTelemetryStore.recordDecision(
        'contact_consumer',
        'denied'
      );
      planEntitlementTelemetryStore.recordSuppression(
        'contact_consumer',
        'legacy_revision_missing'
      );
      console.warn(
        '[PlanEntitlementAudit] Contact validation event suppressed',
        createPlanEntitlementAuditContext({
          surface: 'contact_consumer',
          outcome: 'denied',
          accountId: accountId ?? '',
          planProductId: EPlanProduct.integration,
          source: null,
          eventId: data.operation_id,
          reason: 'integration_entitlement_missing',
        })
      );
      throw new ContactValidationEntitlementMissingError();
    }

    try {
      const entitlement = await this.planEntitlementService.assertEntitled(
        accountId,
        EPlanProduct.integration,
        { expectedRevision: revision }
      );
      planEntitlementTelemetryStore.recordDecision(
        'contact_consumer',
        'allowed'
      );
      console.info(
        '[PlanEntitlementAudit] Contact validation event admitted',
        createPlanEntitlementAuditContext({
          surface: 'contact_consumer',
          outcome: 'allowed',
          accountId,
          planProductId: EPlanProduct.integration,
          revision: entitlement?.revision ?? revision,
          source: entitlement?.source,
          eventId: data.operation_id,
        })
      );
    } catch (error) {
      if (
        error instanceof PlanEntitlementDeniedError ||
        error instanceof PlanEntitlementRevisionMismatchError
      ) {
        planEntitlementTelemetryStore.recordDecision(
          'contact_consumer',
          'denied'
        );
        planEntitlementTelemetryStore.recordSuppression(
          'contact_consumer',
          error instanceof PlanEntitlementRevisionMismatchError
            ? 'revision_mismatch'
            : 'integration_entitlement_missing'
        );
        console.warn(
          '[PlanEntitlementAudit] Contact validation event suppressed',
          createPlanEntitlementAuditContext({
            surface: 'contact_consumer',
            outcome: 'denied',
            accountId,
            planProductId: EPlanProduct.integration,
            revision: error.entitlement.revision,
            source: getPlanEntitlementAuditSource(error.entitlement),
            eventId: data.operation_id,
            reason: 'integration_entitlement_missing',
          })
        );
        throw new ContactValidationEntitlementMissingError(error);
      }

      planEntitlementTelemetryStore.recordDecision(
        'contact_consumer',
        'unavailable'
      );
      throw new ContactValidationEntitlementUnavailableError(error);
    }
  }

  private classifyConsumerError(
    error: unknown
  ): KafkaConsumerRunnerErrorDecision {
    return error instanceof ContactValidationEntitlementMissingError ||
      error instanceof ContactValidationRuntimeStaleError ||
      error instanceof StaleWhatsappRuntimeDatabaseFenceError
      ? 'terminal'
      : 'retryable';
  }

  private async parkExhaustedEntitlementFailure(
    data: IContactValidationUpdate,
    context: KafkaConsumerRunnerContext<IContactValidationUpdate>,
    error: unknown,
    reason: KafkaConsumerRunnerDiscardReason
  ): Promise<void> {
    if (
      reason !== 'retry_exhausted' ||
      !(error instanceof ContactValidationEntitlementUnavailableError)
    ) {
      return;
    }

    const cause = error.cause;
    await this.inboundMessageSpoolService.parkConsumerMessage({
      provider: 'message_upsert_consumer',
      account_id: data.account_id,
      worker_id: 'contact-validation',
      event_source: CONTACT_VALIDATION_WEBHOOK_INTEGRATION_SOURCE,
      reason: error.reason,
      stage: 'contact_validation.entitlement',
      parked_at: new Date().toISOString(),
      kafka_topic: context.topic,
      kafka_key: context.kafkaKey,
      partition: context.partition,
      offset: context.offset,
      retry_count: context.attempt,
      error: cause instanceof Error ? cause.message : String(cause),
      raw_payload: JSON.stringify(data),
      raw_meta: {
        source: data.source,
        integration_entitlement_revision: data.integration_entitlement_revision,
      },
    });
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.contactValidationUpdate();
    this.runner = new KafkaConsumerRunner<IContactValidationUpdate>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.contactValidationUpdate,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) =>
        `${data.account_id?.trim() || 'unknown-account'}:${data.contact_id}`,
      preserveEntityOrder: true,
      acquireEffectLease: (data) => this.runtimeFence.acquireEffectLease(data),
      classifyEffectLeaseRejection: async (data) =>
        (await this.runtimeFence.isCurrent(data)) ? 'retry' : 'terminal',
      handle: async (data, context) =>
        this.processValidationUpdate(data, context.assertActive),
      maxRetries: 3,
      retryDelaysMs: [250, 1_000],
      classifyError: (_data, _context, error) =>
        this.classifyConsumerError(error),
      onDiscarded: (data, context, error, reason) =>
        this.parkExhaustedEntitlementFailure(data, context, error, reason),
      failOnDiscardedHookError: true,
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }
}
