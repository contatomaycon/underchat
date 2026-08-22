import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import { StreamProducerService } from '@core/services/streamProducer.service';
import {
  MetaWhatsappContactMessage,
  MetaGraphApiError,
  MetaWhatsappEmbeddedService,
  MetaWhatsappMessageSendResult,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import {
  IMessageSendAcquiredClaim,
  MessageSendClaimResult,
  MessageSendIdempotencyService,
} from '@core/services/messageSendIdempotency.service';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import type {
  IChatMessage,
  IContactMessage,
} from '@core/common/interfaces/IChatMessage';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import {
  buildMessageSendQueueKey,
  buildScheduleSendQueueKey,
  resolveMessageSendIdentity,
  resolveMessageSendOperationId,
} from '@core/common/functions/messageIdentity';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type {
  KafkaConsumerRunnerContext,
  KafkaRunnerMessage,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import { IScheduleMessage } from '@core/common/interfaces/IScheduleMessage';
import { IScheduleStatusUpdate } from '@core/common/interfaces/IScheduleStatusUpdate';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';
import {
  MessageUpdatePublishFailedError,
  isMessageUpdatePublishFailedError,
} from '@core/common/exceptions/MessageUpdatePublishFailedError';
import { isKafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import {
  ScheduleMessageSendAmbiguousError,
  isScheduleMessageSendAmbiguousError,
} from '@core/common/exceptions/ScheduleMessageSendAmbiguousError';
import { buildOfficialWhatsappMessageStatusEventId } from '@core/common/functions/officialWhatsappEventIdentity';
import {
  buildMessageUpdateKafkaKey,
  ensureMessageUpdateIdentity,
} from '@core/common/functions/messageUpdateIdentity';
import {
  buildScheduleStatusKafkaKey,
  ensureScheduleStatusEventId,
} from '@core/common/functions/scheduleStatusIdentity';
import { buildMessageStatusEventId } from '@core/common/functions/messageStatusIdentity';
import {
  ScheduleMessageInFlightLeaseUnavailableError,
  ScheduleStatusCoordinationService,
} from '@core/services/scheduleStatusCoordination.service';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { assertOfficialWhatsappInteractivePayload } from '@core/common/functions/officialWhatsappInteractiveValidation';
import {
  buildScheduleSendAmbiguousRecovery,
  IScheduleSendAmbiguousRecovery,
  normalizeScheduleSendAmbiguousRecovery,
} from '@core/common/functions/outboundAuxiliarySendRecovery';

interface IQueuedEnvelope {
  sourceTopic: string;
  partition: number;
  offset: number;
  kafkaKey: string | null;
  payload: unknown;
  queueKey: string;
  chatId: string | null;
  assertDispatchActive: () => void;
}

type OfficialSchedulePreLeaseRecoveryResult =
  | { status: 'continue' }
  | { status: 'handled' }
  | {
      status: 'reserved_takeover';
      claim: IMessageSendAcquiredClaim;
    };

interface IOfficialSucceededRecovery {
  schema_version: 'official_whatsapp_send_recovery_v1';
  provider_result: MetaWhatsappMessageSendResult;
  update_message: IUpdateMessage | null;
  message_status_update: IMessageStatusUpdate | null;
  schedule_status_update: IScheduleStatusUpdate | null;
  annotation: {
    message_id: string;
    message: string;
    date: string;
  } | null;
}

interface IOfficialProviderRejectedRecovery {
  schema_version: 'official_whatsapp_provider_rejected_recovery_v1';
  failure_kind: 'meta_graph_api_rejection';
  schedule_id?: string;
  contact_id?: string;
  message_id?: string;
  attempt_id?: string;
  error: {
    message: string;
    code: number | null;
    error_subcode: number | null;
    type: string | null;
  };
}

interface IOfficialAmbiguousTerminalRecovery {
  schema_version: 'message_send_ambiguous_terminal_v1';
  provider: 'official';
  operation_id: string;
  outcome_digest: string;
  status_update: IMessageStatusUpdate;
}

@singleton()
export class OfficialWhatsappMessageSendConsume {
  private readonly PROVIDER = 'official-whatsapp';
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<unknown> | null = null;
  private isRunning = false;
  private readonly SYSTEM_QUEUE_KEY = 'system';
  private readonly META_MESSAGE_ID_PREFIX = 'wamid.';
  private readonly PROCESSING_WATCHDOG_MS = 180_000;
  private readonly persistedProviderRejections =
    new WeakSet<MetaGraphApiError>();
  private pendingProviderRejectionCompactions = new WeakMap<
    MetaGraphApiError,
    {
      claim: IMessageSendAcquiredClaim;
      recovery: IOfficialProviderRejectedRecovery;
    }
  >();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(MessageSendIdempotencyService)
    private readonly messageSendIdempotencyService: MessageSendIdempotencyService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(ScheduleStatusCoordinationService)
    private readonly scheduleStatusCoordinationService: ScheduleStatusCoordinationService,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly officialWindowService: OfficialWhatsappConversationWindowService = {
      recordProviderAcceptedMessage: async () => undefined,
      recordTemplateFailureForMessage: async () => undefined,
      markClosedByMetaReengagementForMessage: async () => undefined,
    } as unknown as OfficialWhatsappConversationWindowService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.officialWhatsappSendMessage();
    this.runner = new KafkaConsumerRunner<unknown>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.officialWhatsappSend,
      parse: (message) =>
        this.parseRawMessage(this.extractRawMessage(message.value)),
      resolveEntityKey: (payload, message) =>
        this.resolveQueueContext(payload, message).queueKey,
      preserveEntityOrder: true,
      maxRetries: 3,
      retryDelaysMs: [250, 1000],
      shouldContinueRetryWithoutCommit: (_payload, _context, error) =>
        isMessageUpdatePublishFailedError(error),
      processingTimeoutMs: this.PROCESSING_WATCHDOG_MS,
      handle: (payload, context) =>
        this.processRunnerPayload(topic, payload, context),
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

  public async restart(): Promise<void> {
    await this.close();
    await this.execute();
  }

  private extractRawMessage(value: Buffer | null): string | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    return raw || null;
  }

  private parseRawMessage(raw: string | null): unknown {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private isSendMessage(payload: unknown): payload is IChatMessage {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'message_id' in payload &&
      'chat_id' in payload
    );
  }

  private isScheduleMessage(payload: unknown): payload is IScheduleMessage {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'schedule_id' in payload &&
      'contact_id' in payload &&
      'message' in payload &&
      this.isSendMessage((payload as { message?: unknown }).message)
    );
  }

  private resolvePayloadMessage(payload: unknown): IChatMessage | null {
    if (this.isScheduleMessage(payload)) {
      return payload.message;
    }

    if (this.isSendMessage(payload)) {
      return payload;
    }

    return null;
  }

  private resolveChatId(data: IChatMessage): string | null {
    const chatId = data.chat_id ?? data.message_key?.remote_jid ?? data.phone;
    return chatId ? String(chatId) : null;
  }

  private resolveQueueContext(
    payload: unknown,
    message?: KafkaRunnerMessage
  ): {
    queueKey: string;
    chatId: string | null;
  } {
    if (this.isScheduleMessage(payload)) {
      const workerId = payload.message.worker.id;
      const accountId = payload.account_id ?? payload.message.account.id;

      return {
        queueKey:
          accountId && workerId
            ? buildScheduleSendQueueKey(accountId, workerId)
            : this.SYSTEM_QUEUE_KEY,
        chatId: this.resolveChatId(payload.message),
      };
    }

    if (this.isSendMessage(payload)) {
      const chatId = this.resolveChatId(payload);
      if (chatId) {
        return {
          queueKey: buildMessageSendQueueKey(payload.account.id, chatId),
          chatId,
        };
      }
    }

    return {
      queueKey: message
        ? `offset:${message.partition}:${message.offset}`
        : this.SYSTEM_QUEUE_KEY,
      chatId: null,
    };
  }

  private async processRunnerPayload(
    topic: string,
    payload: unknown,
    context: KafkaConsumerRunnerContext<unknown>
  ): Promise<void> {
    const { queueKey, chatId } = this.resolveQueueContext(payload);
    const envelope: IQueuedEnvelope = {
      sourceTopic: topic,
      partition: context.partition,
      offset: context.offset,
      kafkaKey: context.kafkaKey,
      payload,
      queueKey,
      chatId,
      assertDispatchActive: context.assertActive,
    };

    try {
      await this.processPayload(payload, envelope);
    } catch (error) {
      if (isScheduleMessageSendAmbiguousError(error)) {
        if (isKafkaConsumerDispatchRevokedError(error.originalCause)) {
          throw error.originalCause;
        }
        console.warn(
          '[OfficialWhatsappMessageSend] Provider result is ambiguous; suppressing not-sent state and automatic retry',
          {
            message_id: this.extractMessageId(payload),
            error:
              error.originalCause instanceof Error
                ? error.originalCause.message
                : String(error.originalCause),
          }
        );
        return;
      }
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error)
      ) {
        throw error;
      }
      try {
        await this.routeFailedMessage(envelope, error);
        await this.compactProviderRejectionIfPending(error);
      } catch (routeError) {
        if (
          isMessageUpdatePublishFailedError(routeError) ||
          isKafkaConsumerDispatchRevokedError(routeError)
        ) {
          throw routeError;
        }
        throw new MessageUpdatePublishFailedError(routeError);
      }
    }
  }

  private async processPayload(
    payload: unknown,
    envelope: IQueuedEnvelope
  ): Promise<void> {
    envelope.assertDispatchActive();

    if (this.isScheduleMessage(payload)) {
      await this.processSchedulePayload(payload, envelope);
      return;
    }

    if (!this.isSendMessage(payload)) {
      console.warn('[OfficialWhatsappMessageSend] Unsupported payload skipped');
      return;
    }

    const claim = await this.claimMessageSend(payload);
    if (!claim) {
      throw new Error('message_send_idempotency_error');
    }
    if (claim.status === 'error') {
      if (
        claim.reason === 'redis_unavailable' ||
        claim.reason === 'invalid_reply'
      ) {
        throw new MessageUpdatePublishFailedError(
          new Error(`message_send_idempotency_${claim.reason}`)
        );
      }
      throw new Error(`message_send_idempotency_${claim.reason}`);
    }
    if (claim.status === 'duplicate') {
      if (claim.compacted) {
        return;
      }
      if (claim.state === 'succeeded') {
        try {
          const projectionPublished = Boolean(
            this.normalizeSucceededRecovery(claim.result, payload, null)
          );
          await this.recoverSucceededEffects(
            claim.result,
            payload,
            null,
            envelope.assertDispatchActive
          );
          if (projectionPublished) {
            await this.compactTerminalRecovery(
              claim,
              'succeeded',
              claim.result
            );
          }
        } catch (error) {
          if (
            isMessageUpdatePublishFailedError(error) ||
            isKafkaConsumerDispatchRevokedError(error)
          ) {
            throw error;
          }
          throw new MessageUpdatePublishFailedError(error);
        }
      } else if (claim.state === 'failed') {
        try {
          const projectionPublished = await this.recoverProviderRejectedEffects(
            claim.result,
            envelope,
            envelope.assertDispatchActive
          );
          if (projectionPublished) {
            await this.compactTerminalRecovery(claim, 'failed', claim.result);
          }
        } catch (error) {
          if (
            isMessageUpdatePublishFailedError(error) ||
            isKafkaConsumerDispatchRevokedError(error)
          ) {
            throw error;
          }
          throw new MessageUpdatePublishFailedError(error);
        }
      } else if (claim.state === 'provider_invoked') {
        throw new MessageUpdatePublishFailedError(
          new Error('official_message_send_provider_attempt_in_flight')
        );
      } else if (claim.state === 'ambiguous') {
        await this.recoverDirectAmbiguousEffects(
          claim,
          payload,
          envelope.assertDispatchActive
        );
      } else if (claim.state === 'reserved') {
        throw new MessageUpdatePublishFailedError(
          new Error('official_message_send_idempotency_reserved')
        );
      }
      return;
    }

    let providerInvoked = false;
    let providerResultCommitted = false;
    const ambiguousRecovery = this.buildDirectAmbiguousRecovery(
      payload,
      claim.operationId
    );
    try {
      const result = await this.sendMessage(
        payload,
        async () => {
          envelope.assertDispatchActive();
          const invoked =
            await this.messageSendIdempotencyService.markProviderInvoked(
              claim,
              ambiguousRecovery
            );
          if (invoked !== 'transitioned') {
            throw new Error(`message_send_idempotency_${invoked}`);
          }
          providerInvoked = true;
        },
        envelope.assertDispatchActive
      );
      const recovery = this.buildSucceededRecovery(payload, result);
      const succeeded = await this.messageSendIdempotencyService.markSucceeded(
        claim,
        recovery
      );
      if (succeeded !== 'transitioned') {
        throw new Error(`message_send_idempotency_${succeeded}`);
      }
      providerResultCommitted = true;
      await this.applySucceededEffects(
        recovery,
        payload,
        envelope.assertDispatchActive,
        null
      );
      await this.compactTerminalRecovery(claim, 'succeeded', recovery);
    } catch (error) {
      if (providerInvoked && !providerResultCommitted) {
        if (this.isDefinitiveProviderRejection(error)) {
          const rejectionState = await this.persistProviderRejection({
            claim,
            error,
            context: { message_id: payload.message_id },
            ambiguousRecovery,
          });
          if (rejectionState === 'failed') {
            throw error;
          }
          await this.publishDirectAmbiguousTerminalStatus(
            ambiguousRecovery,
            envelope.assertDispatchActive
          );
          await this.compactTerminalRecovery(
            claim,
            'ambiguous',
            ambiguousRecovery
          );
          throw new ScheduleMessageSendAmbiguousError(error);
        }
        const ambiguous =
          await this.messageSendIdempotencyService.markAmbiguous(
            claim,
            error,
            ambiguousRecovery
          );
        if (ambiguous !== 'transitioned') {
          throw new MessageUpdatePublishFailedError(
            new Error(`message_send_idempotency_ambiguous_${ambiguous}`)
          );
        }
        await this.publishDirectAmbiguousTerminalStatus(
          ambiguousRecovery,
          envelope.assertDispatchActive
        );
        await this.compactTerminalRecovery(
          claim,
          'ambiguous',
          ambiguousRecovery
        );
        throw new ScheduleMessageSendAmbiguousError(error);
      } else if (!providerInvoked) {
        await this.messageSendIdempotencyService
          .releaseReservation(claim)
          .catch(() => undefined);
      }
      if (providerResultCommitted) {
        throw new MessageUpdatePublishFailedError(error);
      }
      throw error;
    }

    envelope.chatId = this.resolveChatId(payload);
  }

  private async processSchedulePayload(
    payload: IScheduleMessage,
    envelope: IQueuedEnvelope
  ): Promise<void> {
    payload.attempt_id = payload.attempt_id?.trim() || undefined;
    const preLeaseRecovery =
      await this.recoverOfficialScheduleBeforeAttemptLease(payload, envelope);
    if (preLeaseRecovery.status === 'handled') {
      return;
    }
    try {
      await this.scheduleStatusCoordinationService.withMessageInFlight(
        {
          scheduleId: payload.schedule_id,
          accountId: payload.account_id ?? payload.message.account.id,
          workerId: payload.message.worker.id,
          messageId: payload.message.message_id,
          attemptId: payload.attempt_id,
        },
        async (assertLeaseActive) => {
          await assertLeaseActive();
          try {
            await this.processSchedulePayloadWithLease(
              payload,
              envelope,
              assertLeaseActive,
              preLeaseRecovery.status === 'reserved_takeover'
                ? preLeaseRecovery.claim
                : null
            );
          } catch (error) {
            if (isScheduleMessageSendAmbiguousError(error)) {
              if (
                isKafkaConsumerDispatchRevokedError(error.originalCause) ||
                this.isScheduleMessageAttemptLeaseError(error.originalCause)
              ) {
                throw error.originalCause;
              }
              console.warn(
                '[OfficialWhatsappMessageSend] Official schedule provider result is ambiguous; suppressing failed status and automatic retry',
                {
                  schedule_id: payload.schedule_id,
                  contact_id: payload.contact_id,
                  message_id: payload.message.message_id,
                  attempt_id: payload.attempt_id,
                  error:
                    error.originalCause instanceof Error
                      ? error.originalCause.message
                      : String(error.originalCause),
                }
              );
              return;
            }
            if (
              isMessageUpdatePublishFailedError(error) ||
              isKafkaConsumerDispatchRevokedError(error) ||
              this.isScheduleMessageAttemptLeaseError(error)
            ) {
              throw error;
            }

            try {
              await assertLeaseActive();
              await this.routeFailedMessage(envelope, error, assertLeaseActive);
              await this.compactProviderRejectionIfPending(error);
            } catch (routeError) {
              if (
                isKafkaConsumerDispatchRevokedError(routeError) ||
                this.isScheduleMessageAttemptLeaseError(routeError)
              ) {
                throw routeError;
              }
              if (
                error instanceof MetaGraphApiError &&
                this.persistedProviderRejections.has(error)
              ) {
                throw new MessageUpdatePublishFailedError(routeError);
              }
              console.error(
                '[OfficialWhatsappMessageSend] Failed to route terminal schedule error:',
                routeError
              );
            }
          }
        }
      );
    } catch (error) {
      if (this.isScheduleMessageAttemptLeaseError(error)) {
        console.info(
          '[OfficialWhatsappMessageSend] Deferring schedule message without an active distributed attempt lease',
          {
            schedule_id: payload.schedule_id,
            message_id: payload.message.message_id,
            attempt_id: payload.attempt_id,
          }
        );
        throw new MessageUpdatePublishFailedError(error);
      }
      throw error;
    }
  }

  private buildOfficialScheduleAmbiguousRecovery(
    payload: IScheduleMessage,
    claim: Pick<
      Extract<MessageSendClaimResult, { status: 'acquired' | 'duplicate' }>,
      'accountId' | 'operationId'
    >
  ): IScheduleSendAmbiguousRecovery {
    const messageId = payload.message.message_id.trim();
    return buildScheduleSendAmbiguousRecovery({
      provider: 'official',
      operationId: claim.operationId,
      scheduleId: payload.schedule_id,
      contactId: payload.contact_id,
      messageId,
      attemptId: payload.attempt_id?.trim() || `legacy:${messageId}`,
      accountId: claim.accountId,
      workerId: payload.message.worker.id,
    });
  }

  private async recoverOfficialScheduleBeforeAttemptLease(
    payload: IScheduleMessage,
    envelope: IQueuedEnvelope
  ): Promise<OfficialSchedulePreLeaseRecoveryResult> {
    const identity = resolveMessageSendIdentity(payload.message);
    if (!identity) {
      return { status: 'continue' };
    }

    const idempotencyService = this.messageSendIdempotencyService;
    if (
      !idempotencyService ||
      typeof idempotencyService.inspectOperation !== 'function'
    ) {
      return { status: 'continue' };
    }

    const inspection = await idempotencyService.inspectOperation({
      accountId: identity.accountId,
      operationType: 'schedule',
      operationId: identity.messageId,
      meta: this.buildMessageSendClaimMeta(payload.message, identity, payload),
      compatibleLegacyMetaKeys: ['attempt_id'],
    });
    envelope.assertDispatchActive();

    if (inspection.status === 'error') {
      if (inspection.reason === 'identity_conflict') {
        console.error(
          '[OfficialWhatsappMessageSend] Conflicting immutable schedule recovery identity discarded before attempt lease',
          {
            schedule_id: payload.schedule_id,
            contact_id: payload.contact_id,
            message_id: payload.message.message_id,
            attempt_id: payload.attempt_id,
          }
        );
        return { status: 'handled' };
      }
      throw new MessageUpdatePublishFailedError(
        new Error(`message_send_inspection_${inspection.reason}`)
      );
    }
    if (inspection.status === 'duplicate' && inspection.compacted) {
      return { status: 'handled' };
    }
    if (inspection.status === 'not_found' || inspection.state === 'reserved') {
      const takeover = await this.claimMessageSend(payload.message, payload);
      if (!takeover) {
        throw new MessageUpdatePublishFailedError(
          new Error('official_schedule_reserved_takeover_identity_invalid')
        );
      }
      if (takeover.status === 'error') {
        if (takeover.reason === 'identity_conflict') {
          console.error(
            '[OfficialWhatsappMessageSend] Reserved takeover identity conflict discarded',
            {
              schedule_id: payload.schedule_id,
              contact_id: payload.contact_id,
              message_id: payload.message.message_id,
              attempt_id: payload.attempt_id,
            }
          );
          return { status: 'handled' };
        }
        throw new MessageUpdatePublishFailedError(
          new Error(`official_schedule_reserved_takeover_${takeover.reason}`)
        );
      }
      if (takeover.status === 'duplicate') {
        if (takeover.compacted) {
          return { status: 'handled' };
        }
        throw new MessageUpdatePublishFailedError(
          new Error(`official_schedule_reserved_takeover_${takeover.state}`)
        );
      }

      try {
        const adoption =
          await this.scheduleStatusCoordinationService.adoptMessageAttemptFromLedgerReservation(
            {
              scheduleId: payload.schedule_id,
              accountId: identity.accountId,
              workerId: payload.message.worker.id,
              messageId: identity.messageId,
              attemptId:
                payload.attempt_id?.trim() || `legacy:${identity.messageId}`,
              ledgerOperationId: takeover.operationId,
              ledgerReservationOwner: takeover.owner,
            }
          );
        if (adoption === 'stale' || adoption === 'terminal') {
          await idempotencyService
            .releaseReservation(takeover)
            .catch(() => undefined);
          console.error(
            '[OfficialWhatsappMessageSend] Reserved ledger takeover was not adopted by the operational identity',
            {
              schedule_id: payload.schedule_id,
              contact_id: payload.contact_id,
              message_id: payload.message.message_id,
              attempt_id: payload.attempt_id,
              adoption,
            }
          );
          return { status: 'handled' };
        }
        if (adoption === 'invalid') {
          throw new Error(
            'official_schedule_reserved_takeover_adoption_invalid'
          );
        }
        envelope.assertDispatchActive();
      } catch (error) {
        await idempotencyService
          .releaseReservation(takeover)
          .catch(() => undefined);
        if (isKafkaConsumerDispatchRevokedError(error)) {
          throw error;
        }
        throw new MessageUpdatePublishFailedError(error);
      }
      return {
        status: 'reserved_takeover',
        claim: takeover,
      };
    }
    if (inspection.state === 'provider_invoked') {
      throw new MessageUpdatePublishFailedError(
        new Error('official_schedule_provider_attempt_in_flight')
      );
    }
    if (inspection.state === 'ambiguous') {
      const expected = this.buildOfficialScheduleAmbiguousRecovery(
        payload,
        inspection
      );
      const recovery = normalizeScheduleSendAmbiguousRecovery(
        inspection.result,
        {
          provider: expected.provider,
          operationId: expected.operation_id,
          scheduleId: expected.schedule_id,
          contactId: expected.contact_id,
          messageId: expected.message_id,
          attemptId: expected.attempt_id,
          accountId: expected.account_id,
          workerId: expected.worker_id,
        }
      );
      if (!recovery) {
        const legacyRecovery =
          await this.messageSendIdempotencyService.recoverLegacyAmbiguous(
            inspection,
            expected,
            this.buildMessageSendClaimMeta(payload.message, identity, payload),
            ['attempt_id']
          );
        if (legacyRecovery === 'identity_conflict') {
          console.error(
            '[OfficialWhatsappMessageSend] Official legacy ledger identity changed before terminal CAS',
            {
              schedule_id: payload.schedule_id,
              contact_id: payload.contact_id,
              message_id: payload.message.message_id,
              attempt_id: payload.attempt_id,
            }
          );
          return { status: 'handled' };
        }
        if (legacyRecovery !== 'transitioned') {
          throw new MessageUpdatePublishFailedError(
            new Error(
              `official_schedule_${inspection.state}_recovery_${legacyRecovery}`
            )
          );
        }
      }
      await this.ensureOfficialScheduleOperationalStateFromLedger(
        inspection,
        payload,
        'ambiguous'
      );
      return { status: 'handled' };
    }
    if (inspection.state === 'succeeded') {
      await this.ensureOfficialScheduleOperationalStateFromLedger(
        inspection,
        payload,
        'succeeded'
      );
      const projectionPublished = Boolean(
        this.normalizeSucceededRecovery(
          inspection.result,
          payload.message,
          payload
        )
      );
      await this.recoverSucceededEffects(
        inspection.result,
        payload.message,
        payload,
        envelope.assertDispatchActive
      );
      if (projectionPublished) {
        await this.compactTerminalRecovery(
          inspection,
          'succeeded',
          inspection.result
        );
      }
      return { status: 'handled' };
    }
    if (inspection.state === 'failed') {
      await this.ensureOfficialScheduleOperationalStateFromLedger(
        inspection,
        payload,
        'provider_rejected'
      );
      try {
        const projectionPublished = await this.recoverProviderRejectedEffects(
          inspection.result,
          envelope,
          envelope.assertDispatchActive,
          async () => undefined,
          true
        );
        if (projectionPublished) {
          await this.compactTerminalRecovery(
            inspection,
            'failed',
            inspection.result
          );
        }
      } catch (error) {
        if (
          isMessageUpdatePublishFailedError(error) ||
          isKafkaConsumerDispatchRevokedError(error) ||
          this.isScheduleMessageAttemptLeaseError(error)
        ) {
          throw error;
        }
        throw new MessageUpdatePublishFailedError(error);
      }
      return { status: 'handled' };
    }
    return { status: 'continue' };
  }

  private async ensureOfficialScheduleOperationalStateFromLedger(
    claim: Pick<
      Extract<MessageSendClaimResult, { status: 'duplicate' }>,
      'operationId'
    >,
    payload: IScheduleMessage,
    state: 'provider_rejected' | 'ambiguous' | 'succeeded'
  ): Promise<void> {
    try {
      const messageId = payload.message.message_id;
      const result =
        await this.scheduleStatusCoordinationService.setMessageOperationalStateFromLedger(
          {
            scheduleId: payload.schedule_id,
            accountId: payload.account_id?.trim() || payload.message.account.id,
            workerId: payload.message.worker.id,
            messageId,
            attemptId: payload.attempt_id?.trim() || `legacy:${messageId}`,
            ledgerOperationId: claim.operationId,
          },
          state
        );
      if (result === 'stale') {
        console.error(
          '[OfficialWhatsappMessageSend] Ledger outcome matched but official schedule operational identity was stale; provider remains terminal and will not be retried',
          {
            schedule_id: payload.schedule_id,
            contact_id: payload.contact_id,
            message_id: payload.message.message_id,
            attempt_id: payload.attempt_id,
            state,
          }
        );
        return;
      }
      if (result === 'invalid') {
        throw new Error(
          `official_schedule_ledger_operational_state_${state}_${result}`
        );
      }
    } catch (error) {
      if (isMessageUpdatePublishFailedError(error)) {
        throw error;
      }
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async processSchedulePayloadWithLease(
    payload: IScheduleMessage,
    envelope: IQueuedEnvelope,
    assertLeaseActive: () => Promise<void>,
    reservedTakeoverClaim: IMessageSendAcquiredClaim | null = null
  ): Promise<void> {
    const message = payload.message;
    await assertLeaseActive();
    const claim =
      reservedTakeoverClaim ?? (await this.claimMessageSend(message, payload));
    if (!claim) {
      throw new Error('message_send_idempotency_error');
    }
    if (claim.status === 'error') {
      if (
        claim.reason === 'redis_unavailable' ||
        claim.reason === 'invalid_reply'
      ) {
        throw new MessageUpdatePublishFailedError(
          new Error(`message_send_idempotency_${claim.reason}`)
        );
      }
      throw new Error(`message_send_idempotency_${claim.reason}`);
    }
    if (claim.status === 'duplicate') {
      if (claim.compacted) {
        return;
      }
      if (claim.state === 'succeeded') {
        try {
          await assertLeaseActive();
          await this.transitionScheduleOperationalState(payload, 'succeeded');
          const projectionPublished = Boolean(
            this.normalizeSucceededRecovery(claim.result, message, payload)
          );
          await this.recoverSucceededEffects(
            claim.result,
            message,
            payload,
            envelope.assertDispatchActive,
            assertLeaseActive
          );
          if (projectionPublished) {
            await this.compactTerminalRecovery(
              claim,
              'succeeded',
              claim.result
            );
          }
        } catch (error) {
          if (
            isMessageUpdatePublishFailedError(error) ||
            isKafkaConsumerDispatchRevokedError(error)
          ) {
            throw error;
          }
          throw new MessageUpdatePublishFailedError(error);
        }
      } else if (claim.state === 'failed') {
        try {
          await assertLeaseActive();
          const projectionPublished = await this.recoverProviderRejectedEffects(
            claim.result,
            envelope,
            envelope.assertDispatchActive,
            assertLeaseActive
          );
          if (projectionPublished) {
            await this.compactTerminalRecovery(claim, 'failed', claim.result);
          }
        } catch (error) {
          if (
            isMessageUpdatePublishFailedError(error) ||
            isKafkaConsumerDispatchRevokedError(error) ||
            this.isScheduleMessageAttemptLeaseError(error)
          ) {
            throw error;
          }
          throw new MessageUpdatePublishFailedError(error);
        }
      } else if (claim.state === 'provider_invoked') {
        throw new MessageUpdatePublishFailedError(
          new Error('official_schedule_provider_attempt_in_flight')
        );
      } else if (claim.state === 'ambiguous') {
        await this.ensureOfficialScheduleOperationalStateFromLedger(
          claim,
          payload,
          'ambiguous'
        );
      } else if (claim.state === 'reserved') {
        throw new MessageUpdatePublishFailedError(
          new Error('official_schedule_send_idempotency_reserved')
        );
      }
      return;
    }

    let providerInvoked = false;
    let providerResultCommitted = false;
    const ambiguousRecovery = this.buildOfficialScheduleAmbiguousRecovery(
      payload,
      claim
    );
    try {
      const result = await this.sendMessage(
        message,
        async () => {
          envelope.assertDispatchActive();
          await assertLeaseActive();
          const invoked =
            await this.messageSendIdempotencyService.markProviderInvoked(
              claim,
              ambiguousRecovery
            );
          if (invoked !== 'transitioned') {
            throw new Error(`message_send_idempotency_${invoked}`);
          }
          providerInvoked = true;
        },
        envelope.assertDispatchActive
      );
      const recovery = this.buildSucceededRecovery(message, result, payload);
      const succeeded = await this.messageSendIdempotencyService.markSucceeded(
        claim,
        recovery
      );
      if (succeeded !== 'transitioned') {
        throw new Error(`message_send_idempotency_${succeeded}`);
      }
      providerResultCommitted = true;
      await assertLeaseActive();
      await this.transitionScheduleOperationalState(payload, 'succeeded');
      await this.applySucceededEffects(
        recovery,
        message,
        envelope.assertDispatchActive,
        payload,
        assertLeaseActive
      );
      await this.compactTerminalRecovery(claim, 'succeeded', recovery);
    } catch (error) {
      if (providerInvoked && !providerResultCommitted) {
        if (this.isDefinitiveProviderRejection(error)) {
          const rejectionState = await this.persistProviderRejection({
            claim,
            error,
            context: {
              schedule_id: payload.schedule_id,
              contact_id: payload.contact_id,
              message_id: message.message_id,
              attempt_id:
                payload.attempt_id?.trim() || `legacy:${message.message_id}`,
            },
            ambiguousRecovery,
          });
          if (rejectionState === 'failed') {
            throw error;
          }
          throw new ScheduleMessageSendAmbiguousError(error);
        }
        const ambiguous =
          await this.messageSendIdempotencyService.markAmbiguous(
            claim,
            error,
            ambiguousRecovery
          );
        if (ambiguous !== 'transitioned') {
          throw new MessageUpdatePublishFailedError(
            new Error(`message_send_idempotency_ambiguous_${ambiguous}`)
          );
        }
        try {
          await this.transitionScheduleOperationalState(payload, 'ambiguous');
        } catch (transitionError) {
          throw new MessageUpdatePublishFailedError(transitionError);
        }
        throw new ScheduleMessageSendAmbiguousError(error);
      } else if (!providerInvoked) {
        await this.messageSendIdempotencyService
          .releaseReservation(claim)
          .catch(() => undefined);
      }
      if (providerResultCommitted) {
        throw new MessageUpdatePublishFailedError(error);
      }
      throw error;
    }

    envelope.chatId = this.resolveChatId(message);
  }

  private async transitionScheduleOperationalState(
    payload: IScheduleMessage,
    state:
      'pre_provider_failed' | 'provider_rejected' | 'ambiguous' | 'succeeded'
  ): Promise<void> {
    const messageId = payload.message.message_id;
    const result =
      await this.scheduleStatusCoordinationService.setMessageOperationalState(
        {
          scheduleId: payload.schedule_id,
          accountId: payload.account_id?.trim() || payload.message.account.id,
          workerId: payload.message.worker.id,
          messageId,
          attemptId: payload.attempt_id?.trim() || `legacy:${messageId}`,
        },
        state
      );
    if (result === 'stale' || result === 'invalid') {
      throw new Error(`schedule_message_operational_state_${state}_${result}`);
    }
  }

  private async transitionSchedulePreProviderFailure(
    payload: IScheduleMessage
  ): Promise<boolean> {
    try {
      await this.transitionScheduleOperationalState(
        payload,
        'pre_provider_failed'
      );
      return true;
    } catch (error) {
      console.warn(
        '[OfficialWhatsappMessageSend] Suppressing failed state because the durable operational outcome rejected the transition',
        {
          schedule_id: payload.schedule_id,
          contact_id: payload.contact_id,
          message_id: payload.message.message_id,
          attempt_id: payload.attempt_id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  private async transitionScheduleProviderRejection(
    payload: IScheduleMessage
  ): Promise<boolean> {
    try {
      await this.transitionScheduleOperationalState(
        payload,
        'provider_rejected'
      );
      return true;
    } catch (error) {
      const isDurableConflict =
        error instanceof Error &&
        (error.message.endsWith('_stale') ||
          error.message.endsWith('_invalid'));
      if (!isDurableConflict) {
        throw error;
      }

      console.warn(
        '[OfficialWhatsappMessageSend] Suppressing provider-rejected failure because the durable operational outcome rejected the transition',
        {
          schedule_id: payload.schedule_id,
          contact_id: payload.contact_id,
          message_id: payload.message.message_id,
          attempt_id: payload.attempt_id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  private async claimMessageSend(
    payload: IChatMessage,
    schedule?: IScheduleMessage
  ): Promise<MessageSendClaimResult | null> {
    const identity = resolveMessageSendIdentity(payload);
    const operationId = schedule
      ? (identity?.messageId ?? null)
      : resolveMessageSendOperationId(payload);
    if (!identity || !operationId) {
      return null;
    }

    payload.hash = identity.hash;

    return this.messageSendIdempotencyService.claimOperation({
      accountId: identity.accountId,
      operationType: schedule ? 'schedule' : 'direct',
      operationId,
      meta: this.buildMessageSendClaimMeta(payload, identity, schedule),
      reservationLeaseMs:
        MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS,
    });
  }

  private buildMessageSendClaimMeta(
    payload: IChatMessage,
    identity: NonNullable<ReturnType<typeof resolveMessageSendIdentity>>,
    schedule?: IScheduleMessage
  ): Record<string, unknown> {
    return {
      provider: this.PROVIDER,
      account_id: identity.accountId,
      chat_id: identity.chatId,
      message_id: identity.messageId,
      worker_id: payload.worker.id,
      ...(schedule
        ? {
            schedule_id: schedule.schedule_id,
            contact_id: schedule.contact_id,
          }
        : {}),
    };
  }

  private async sendMessage(
    data: IChatMessage,
    beforeProviderSend: () => Promise<void>,
    assertActive: () => void
  ): Promise<MetaWhatsappMessageSendResult> {
    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        data.worker.id
      );

    if (!connection) {
      throw new Error('official_whatsapp_connection_not_found');
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const to = this.resolveRecipientPhone(data);

    if (!to) {
      throw new Error('official_whatsapp_recipient_required');
    }

    const content = data.content;
    if (!content) {
      throw new Error('official_whatsapp_content_required');
    }

    const contextMessageId = this.resolveContextMessageId(data);
    const messageType = content.type;

    if (messageType === EMessageType.official_interactive) {
      const interactive = this.resolveOfficialInteractivePayload(data);
      if (!interactive) {
        throw new Error('official_whatsapp_interactive_required');
      }

      assertOfficialWhatsappInteractivePayload(interactive);

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendInteractiveMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        interactive,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.official_template) {
      const template = content.official_template;
      if (!template?.name || !template.language) {
        throw new Error('official_whatsapp_template_required');
      }

      const components =
        this.officialWhatsappTemplateService.buildMetaComponents(
          template.variables,
          template.components
        );
      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendTemplateMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        templateName: template.name,
        language: template.language,
        components,
      });
    }

    if (
      messageType === EMessageType.text ||
      messageType === EMessageType.system
    ) {
      const message = content.message?.trim();
      if (!message) {
        throw new Error('official_whatsapp_text_required');
      }

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendTextMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        message,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.image) {
      const image = data.content?.image;
      const mediaId = await this.uploadOutboundMedia(
        {
          apiVersion: connection.api_version,
          accessToken,
          phoneNumberId: connection.phone_number_id,
          media: image,
          fallbackPrefix: 'image',
        },
        assertActive
      );

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendImageMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        caption: image?.caption ?? data.content?.message ?? null,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.video) {
      const video = data.content?.video;
      const mediaId = await this.uploadOutboundMedia(
        {
          apiVersion: connection.api_version,
          accessToken,
          phoneNumberId: connection.phone_number_id,
          media: video,
          fallbackPrefix: 'video',
        },
        assertActive
      );

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendVideoMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        caption: video?.caption ?? data.content?.message ?? null,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.audio) {
      const audio = data.content?.audio;
      if (audio?.view_once) {
        throw new Error('whatsapp_official_view_once_not_supported');
      }
      const mediaId = await this.uploadOutboundMedia(
        {
          apiVersion: connection.api_version,
          accessToken,
          phoneNumberId: connection.phone_number_id,
          media: audio,
          fallbackPrefix: 'audio',
        },
        assertActive
      );

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendAudioMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        voice: audio?.ptt === true,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.document) {
      const document = data.content?.document;
      const mediaId = await this.uploadOutboundMedia(
        {
          apiVersion: connection.api_version,
          accessToken,
          phoneNumberId: connection.phone_number_id,
          media: document,
          fallbackPrefix: 'document',
        },
        assertActive
      );

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendDocumentMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        caption: data.content?.message ?? null,
        filename: this.resolveMediaFilename(document, 'document'),
        contextMessageId,
      });
    }

    if (messageType === EMessageType.sticker) {
      const sticker = data.content?.sticker;
      const mediaId = await this.uploadOutboundMedia(
        {
          apiVersion: connection.api_version,
          accessToken,
          phoneNumberId: connection.phone_number_id,
          media: sticker,
          fallbackPrefix: 'sticker',
        },
        assertActive
      );

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendStickerMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.location) {
      const location = data.content?.location;
      if (
        typeof location?.latitude !== 'number' ||
        typeof location?.longitude !== 'number'
      ) {
        throw new Error('official_whatsapp_location_required');
      }

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendLocationMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name ?? null,
        address: location.address ?? null,
        contextMessageId,
      });
    }

    if (
      messageType === EMessageType.contact_card ||
      messageType === EMessageType.contacts
    ) {
      const contacts = this.resolveMetaContacts(data);
      if (contacts.length === 0) {
        throw new Error('official_whatsapp_contacts_required');
      }

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendContactsMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        contacts,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.react) {
      const messageId = this.resolveReactionTargetMessageId(data);
      const emoji = data.content?.message ?? '';
      if (!messageId) {
        throw new Error('official_whatsapp_reaction_target_required');
      }

      await beforeProviderSend();
      return this.metaWhatsappEmbeddedService.sendReactionMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        messageId,
        emoji,
      });
    }

    throw new Error(this.unsupportedOfficialTypeError(messageType));
  }

  private isDefinitiveProviderRejection(
    error: unknown
  ): error is MetaGraphApiError {
    return error instanceof MetaGraphApiError;
  }

  private buildDirectAmbiguousRecovery(
    payload: IChatMessage,
    operationId: string
  ): IOfficialAmbiguousTerminalRecovery {
    const statusUpdate: IMessageStatusUpdate = {
      account_id: payload.account.id,
      worker_id: payload.worker.id,
      source_provider: 'official_whatsapp',
      message_id: payload.message_id.trim(),
      internal_message_id: payload.message_id.trim(),
      terminal_failure_schema: 'message_send_ambiguous_terminal_v1',
      patch: {},
      failed: true,
      ambiguous: true,
      key: {
        id: payload.message_key?.id ?? undefined,
        remoteJid:
          payload.message_key?.remote_jid ?? payload.chat_id ?? undefined,
        fromMe: payload.message_key?.from_me ?? true,
        participant: payload.message_key?.participant ?? undefined,
      },
    };
    const eventId = buildMessageStatusEventId(statusUpdate);
    if (!eventId) {
      throw new Error('official_message_status_event_identity_missing');
    }
    statusUpdate.event_id = eventId;

    return {
      schema_version: 'message_send_ambiguous_terminal_v1',
      provider: 'official',
      operation_id: operationId.trim(),
      outcome_digest: this.directAmbiguousOutcomeDigest(
        operationId,
        statusUpdate
      ),
      status_update: statusUpdate,
    };
  }

  private directAmbiguousOutcomeDigest(
    operationId: string,
    statusUpdate: IMessageStatusUpdate
  ): string {
    return createHash('sha256')
      .update(
        [
          'message_send_ambiguous_terminal_v1',
          'official',
          operationId.trim(),
          statusUpdate.event_id?.trim() ?? '',
          statusUpdate.account_id.trim(),
          statusUpdate.worker_id?.trim() ?? '',
          statusUpdate.message_id.trim(),
          statusUpdate.internal_message_id?.trim() ?? '',
          statusUpdate.key?.id?.trim() ?? '',
          statusUpdate.key?.remoteJid?.trim() ?? '',
          statusUpdate.key?.participant?.trim() ?? '',
          statusUpdate.key?.fromMe === false ? 'false' : 'true',
        ].join('\0')
      )
      .digest('hex');
  }

  private normalizeDirectAmbiguousRecovery(
    result: unknown,
    payload: IChatMessage,
    operationId: string
  ): IOfficialAmbiguousTerminalRecovery | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const recovery = result as Partial<IOfficialAmbiguousTerminalRecovery>;
    const statusUpdate = recovery.status_update;
    const expected = this.buildDirectAmbiguousRecovery(payload, operationId);
    if (
      recovery.schema_version !== 'message_send_ambiguous_terminal_v1' ||
      recovery.provider !== 'official' ||
      recovery.operation_id !== expected.operation_id ||
      recovery.outcome_digest !== expected.outcome_digest ||
      !statusUpdate ||
      typeof statusUpdate !== 'object' ||
      statusUpdate.failed !== true ||
      statusUpdate.ambiguous !== true ||
      statusUpdate.terminal_failure_schema !==
        'message_send_ambiguous_terminal_v1' ||
      statusUpdate.account_id?.trim() !== payload.account.id.trim() ||
      statusUpdate.worker_id?.trim() !== payload.worker.id.trim() ||
      statusUpdate.source_provider !== 'official_whatsapp' ||
      statusUpdate.message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.internal_message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.event_id?.trim() !==
        expected.status_update.event_id?.trim() ||
      statusUpdate.key?.id !== expected.status_update.key?.id ||
      statusUpdate.key?.remoteJid !== expected.status_update.key?.remoteJid ||
      statusUpdate.key?.participant !==
        expected.status_update.key?.participant ||
      statusUpdate.key?.fromMe !== expected.status_update.key?.fromMe ||
      Object.keys(statusUpdate.patch ?? {}).length !== 0 ||
      this.directAmbiguousOutcomeDigest(operationId, statusUpdate) !==
        expected.outcome_digest
    ) {
      return null;
    }

    return recovery as IOfficialAmbiguousTerminalRecovery;
  }

  private async recoverDirectAmbiguousEffects(
    claim: Extract<MessageSendClaimResult, { status: 'duplicate' }>,
    payload: IChatMessage,
    assertActive: () => void
  ): Promise<void> {
    const expected = this.buildDirectAmbiguousRecovery(
      payload,
      claim.operationId
    );
    let recovery = this.normalizeDirectAmbiguousRecovery(
      claim.result,
      payload,
      claim.operationId
    );
    if (!recovery) {
      const identity = resolveMessageSendIdentity(payload);
      if (!identity) {
        throw new MessageUpdatePublishFailedError(
          new Error('official_ambiguous_recovery_identity_invalid')
        );
      }
      const migrated =
        await this.messageSendIdempotencyService.recoverLegacyAmbiguous(
          claim,
          expected,
          this.buildMessageSendClaimMeta(payload, identity)
        );
      if (migrated !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(`official_ambiguous_recovery_${migrated}`)
        );
      }
      recovery = expected;
    }

    await this.publishDirectAmbiguousTerminalStatus(recovery, assertActive);
    await this.compactTerminalRecovery(claim, 'ambiguous', recovery);
  }

  private async publishDirectAmbiguousTerminalStatus(
    recovery: IOfficialAmbiguousTerminalRecovery,
    assertActive: () => void
  ): Promise<void> {
    const statusUpdate = recovery.status_update;
    try {
      assertActive();
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessageStatus(),
        statusUpdate,
        MessageStatusService.statusKafkaKey(
          statusUpdate.account_id,
          statusUpdate.message_id,
          statusUpdate.worker_id
        ),
        undefined,
        async () => {
          assertActive();
        }
      );
      assertActive();
    } catch (error) {
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error)
      ) {
        throw error;
      }
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async compactTerminalRecovery(
    claim: Extract<
      MessageSendClaimResult,
      { status: 'acquired' | 'duplicate' }
    >,
    state: 'succeeded' | 'failed' | 'ambiguous',
    recovery: unknown
  ): Promise<void> {
    const idempotency = this.messageSendIdempotencyService;
    const compact = idempotency?.compactTerminalAfterRecoveryPubAck;
    if (typeof compact !== 'function') {
      return;
    }
    const compacted = await compact.call(idempotency, claim, state, recovery);
    if (compacted !== 'transitioned') {
      throw new MessageUpdatePublishFailedError(
        new Error(`message_send_idempotency_compaction_${compacted}`)
      );
    }
  }

  private async persistProviderRejection(input: {
    claim: IMessageSendAcquiredClaim;
    error: MetaGraphApiError;
    context: Record<string, unknown>;
    ambiguousRecovery: unknown;
  }): Promise<'failed' | 'ambiguous'> {
    const recovery = this.buildProviderRejectedRecovery(
      input.error,
      input.context
    );
    const rejected =
      await this.messageSendIdempotencyService.markProviderRejected(
        input.claim,
        input.error,
        recovery
      );
    if (rejected === 'transitioned') {
      this.persistedProviderRejections.add(input.error);
      this.providerRejectionCompactionMap().set(input.error, {
        claim: input.claim,
        recovery,
      });
      return 'failed';
    }

    const ambiguous = await this.messageSendIdempotencyService.markAmbiguous(
      input.claim,
      input.error,
      input.ambiguousRecovery
    );
    if (ambiguous !== 'transitioned') {
      throw new MessageUpdatePublishFailedError(
        new Error(`message_send_provider_rejection_ambiguous_${ambiguous}`)
      );
    }
    console.error(
      '[OfficialWhatsappMessageSend] Definitive provider rejection could not be persisted as failed; preserving fail-closed ambiguous state:',
      {
        ...input.context,
        failed_transition: rejected,
        ambiguous_transition: ambiguous,
        error: this.errorMessage(input.error),
      }
    );
    return 'ambiguous';
  }

  private async compactProviderRejectionIfPending(
    error: unknown
  ): Promise<void> {
    if (!(error instanceof MetaGraphApiError)) {
      return;
    }
    const pending = this.providerRejectionCompactionMap().get(error);
    if (!pending) {
      return;
    }
    await this.compactTerminalRecovery(
      pending.claim,
      'failed',
      pending.recovery
    );
    this.providerRejectionCompactionMap().delete(error);
  }

  private providerRejectionCompactionMap(): WeakMap<
    MetaGraphApiError,
    {
      claim: IMessageSendAcquiredClaim;
      recovery: IOfficialProviderRejectedRecovery;
    }
  > {
    this.pendingProviderRejectionCompactions ??= new WeakMap();
    return this.pendingProviderRejectionCompactions;
  }

  private buildProviderRejectedRecovery(
    error: MetaGraphApiError,
    context: Record<string, unknown> = {}
  ): IOfficialProviderRejectedRecovery {
    const scheduleId =
      typeof context.schedule_id === 'string' && context.schedule_id.trim()
        ? context.schedule_id.trim()
        : null;
    const contactId =
      typeof context.contact_id === 'string' && context.contact_id.trim()
        ? context.contact_id.trim()
        : null;
    const messageId =
      typeof context.message_id === 'string' && context.message_id.trim()
        ? context.message_id.trim()
        : null;
    const attemptId =
      typeof context.attempt_id === 'string' && context.attempt_id.trim()
        ? context.attempt_id.trim()
        : null;
    return {
      schema_version: 'official_whatsapp_provider_rejected_recovery_v1',
      failure_kind: 'meta_graph_api_rejection',
      ...(scheduleId && contactId && messageId && attemptId
        ? {
            schedule_id: scheduleId,
            contact_id: contactId,
            message_id: messageId,
            attempt_id: attemptId,
          }
        : {}),
      error: {
        message: error.message,
        code: error.code,
        error_subcode: error.errorSubcode,
        type: error.type,
      },
    };
  }

  private normalizeProviderRejectedRecovery(
    result: unknown
  ): MetaGraphApiError | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const candidate = result as Partial<IOfficialProviderRejectedRecovery>;
    if (
      candidate.schema_version !==
        'official_whatsapp_provider_rejected_recovery_v1' ||
      candidate.failure_kind !== 'meta_graph_api_rejection' ||
      !candidate.error ||
      typeof candidate.error !== 'object' ||
      typeof candidate.error.message !== 'string' ||
      !candidate.error.message.trim() ||
      !(
        candidate.error.code === null ||
        typeof candidate.error.code === 'number'
      )
    ) {
      return null;
    }

    return new MetaGraphApiError({
      message: candidate.error.message,
      code: candidate.error.code ?? undefined,
      error_subcode:
        candidate.error.error_subcode === null ||
        typeof candidate.error.error_subcode !== 'number'
          ? undefined
          : candidate.error.error_subcode,
      type:
        typeof candidate.error.type === 'string'
          ? candidate.error.type
          : undefined,
    });
  }

  private async recoverProviderRejectedEffects(
    result: unknown,
    envelope: IQueuedEnvelope,
    assertActive: () => void,
    assertLeaseActive: () => Promise<void> = async () => undefined,
    scheduleOperationalStateAlreadyDurable = false
  ): Promise<boolean> {
    const error = this.normalizeProviderRejectedRecovery(result);
    if (!error) {
      return false;
    }

    assertActive();
    await assertLeaseActive();
    await this.routeFailedMessage(
      envelope,
      error,
      assertLeaseActive,
      scheduleOperationalStateAlreadyDurable
    );
    return true;
  }

  private resolveOfficialInteractivePayload(
    data: IChatMessage
  ): Record<string, unknown> | null {
    const raw = data.content?.official?.raw;
    const interactive = raw?.interactive;

    if (!interactive || typeof interactive !== 'object') {
      return null;
    }

    return interactive as Record<string, unknown>;
  }

  private unsupportedOfficialTypeError(type?: EMessageType | null): string {
    if (type === EMessageType.edit_text) {
      return 'whatsapp_official_edit_message_not_supported';
    }
    if (type === EMessageType.delete_message) {
      return 'whatsapp_official_delete_message_not_supported';
    }
    if (type === EMessageType.view_once) {
      return 'whatsapp_official_view_once_not_supported';
    }
    if (type === EMessageType.video_note) {
      return 'whatsapp_official_video_note_not_supported';
    }
    if (type === EMessageType.set_disappearing_messages) {
      return 'whatsapp_official_disappearing_messages_not_supported';
    }

    return `official_whatsapp_unsupported_type:${type}`;
  }

  private resolveContextMessageId(data: IChatMessage): string | null {
    const messageId = data.content?.quoted?.key?.id?.trim();
    if (!messageId?.startsWith(this.META_MESSAGE_ID_PREFIX)) {
      return null;
    }

    return messageId;
  }

  private resolveReactionTargetMessageId(data: IChatMessage): string | null {
    const messageId = data.message_key?.id?.trim();
    if (!messageId?.startsWith(this.META_MESSAGE_ID_PREFIX)) {
      return null;
    }

    return messageId;
  }

  private async uploadOutboundMedia(
    input: {
      apiVersion: string;
      accessToken: string;
      phoneNumberId: string;
      media?: {
        url?: string | null;
        mimetype?: string | null;
        name?: string | null;
        extension?: string | null;
      } | null;
      fallbackPrefix: string;
    },
    assertActive: () => void
  ): Promise<string> {
    const url = input.media?.url?.trim();
    if (!url) {
      throw new Error('official_whatsapp_media_url_required');
    }

    assertActive();
    return this.metaWhatsappEmbeddedService.uploadMediaFromUrl({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      url,
      filename: this.resolveMediaFilename(input.media, input.fallbackPrefix),
      mimetype: input.media?.mimetype ?? null,
    });
  }

  private resolveMediaFilename(
    media:
      | {
          url?: string | null;
          mimetype?: string | null;
          name?: string | null;
          extension?: string | null;
        }
      | null
      | undefined,
    fallbackPrefix: string
  ): string {
    const name = media?.name?.trim();
    if (name) {
      return name;
    }

    const url = media?.url?.trim();
    if (url) {
      try {
        const filename = new URL(url).pathname.split('/').filter(Boolean).pop();
        if (filename) {
          return decodeURIComponent(filename);
        }
      } catch {
        // Ignore malformed URLs and use the fallback below.
      }
    }

    const extension =
      media?.extension?.replace(/^\./u, '').trim() ||
      this.extensionFromMime(media?.mimetype ?? null);

    return `${fallbackPrefix}.${extension}`;
  }

  private extensionFromMime(mimetype?: string | null): string {
    const normalized = mimetype?.split(';')[0]?.trim().toLowerCase();
    const extension = normalized?.split('/')[1]?.replace(/[^a-z0-9.+-]/gu, '');
    if (!extension) {
      return 'bin';
    }

    return extension === 'jpeg' ? 'jpg' : extension;
  }

  private resolveMetaContacts(
    data: IChatMessage
  ): MetaWhatsappContactMessage[] {
    const contacts = Array.isArray(data.content?.contacts)
      ? data.content.contacts
      : [];
    const allContacts =
      contacts.length > 0
        ? contacts
        : data.content?.contact
          ? [data.content.contact]
          : [];

    return allContacts
      .map((contact) => this.toMetaContact(contact))
      .filter((contact): contact is MetaWhatsappContactMessage =>
        Boolean(contact)
      );
  }

  private toMetaContact(
    contact: IContactMessage | null | undefined
  ): MetaWhatsappContactMessage | null {
    if (!contact) {
      return null;
    }

    const firstName = contact.name?.trim();
    const lastName = contact.last_name?.trim();
    const formattedName = [firstName, lastName].filter(Boolean).join(' ');
    if (!formattedName) {
      return null;
    }

    const metaContact: MetaWhatsappContactMessage = {
      name: {
        formatted_name: formattedName,
      },
    };

    if (firstName) {
      metaContact.name.first_name = firstName;
    }
    if (lastName) {
      metaContact.name.last_name = lastName;
    }

    const phone = this.resolveContactPhone(contact);
    if (phone) {
      metaContact.phones = [
        {
          phone: phone.display,
          type: 'CELL',
          wa_id: phone.waId,
        },
      ];
    }

    const email = contact.email?.trim() || contact.email_partial?.trim();
    if (email) {
      metaContact.emails = [
        {
          email,
          type: 'WORK',
        },
      ];
    }

    return metaContact;
  }

  private resolveContactPhone(
    contact: IContactMessage
  ): { display: string; waId: string } | null {
    const phoneDigits = (contact.phone ?? contact.phone_partial ?? '').replace(
      /\D/gu,
      ''
    );
    const ddiDigits = (contact.phone_ddi ?? '').replace(/\D/gu, '');

    if (!phoneDigits && !ddiDigits) {
      return null;
    }

    const waId =
      ddiDigits &&
      phoneDigits.startsWith(ddiDigits) &&
      phoneDigits.length > ddiDigits.length + 8
        ? phoneDigits
        : `${ddiDigits}${phoneDigits}`;
    const localDigits =
      ddiDigits && phoneDigits.startsWith(ddiDigits)
        ? phoneDigits.slice(ddiDigits.length)
        : phoneDigits;
    const display = ddiDigits ? `+${ddiDigits} ${localDigits}` : localDigits;

    return {
      display,
      waId,
    };
  }

  private resolveRecipientPhone(data: IChatMessage): string | null {
    const phoneFromJid = getPhoneFromJid(
      data.message_key?.remote_jid,
      data.message_key?.remote_jid_alt
    );
    if (phoneFromJid) {
      return phoneFromJid;
    }

    const phoneDigits = (data.phone ?? '').replace(/\D/gu, '');
    const ddiDigits = (data.phone_ddi ?? '').replace(/\D/gu, '');
    if (!phoneDigits) {
      return ddiDigits || null;
    }

    return ddiDigits && !phoneDigits.startsWith(ddiDigits)
      ? `${ddiDigits}${phoneDigits}`
      : phoneDigits;
  }

  private buildMessageUpdate(
    data: IChatMessage,
    result: MetaWhatsappMessageSendResult
  ): IUpdateMessage | null {
    if (!result.message_id) {
      return null;
    }

    const update: IUpdateMessage = {
      worker_id: data.worker.id,
      source_provider: 'official_whatsapp',
      message: {
        key: {
          id: result.message_id,
          remoteJid: result.contact_wa_id
            ? `${result.contact_wa_id}@s.whatsapp.net`
            : (data.message_key?.remote_jid ?? undefined),
          fromMe: true,
        },
      },
      data,
    };
    ensureMessageUpdateIdentity(update);
    return update;
  }

  private buildSucceededRecovery(
    data: IChatMessage,
    result: MetaWhatsappMessageSendResult,
    schedule: IScheduleMessage | null = null
  ): IOfficialSucceededRecovery {
    const annotationMessage = this.resolveWindowAnnotation(data, result.raw);
    return {
      schema_version: 'official_whatsapp_send_recovery_v1',
      provider_result: result,
      update_message: this.buildMessageUpdate(data, result),
      message_status_update: this.buildSentStatusUpdate(data, result),
      schedule_status_update: schedule
        ? this.buildScheduleStatusUpdate(schedule, EScheduleStatus.sent)
        : null,
      annotation: annotationMessage
        ? {
            message_id: this.buildAnnotationMessageId(data, result.message_id),
            message: annotationMessage,
            date: new Date().toISOString(),
          }
        : null,
    };
  }

  private normalizeSucceededRecovery(
    result: unknown,
    data: IChatMessage,
    schedule: IScheduleMessage | null
  ): IOfficialSucceededRecovery | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const candidate = result as Partial<IOfficialSucceededRecovery>;
    if (
      candidate.schema_version === 'official_whatsapp_send_recovery_v1' &&
      candidate.provider_result &&
      typeof candidate.provider_result === 'object'
    ) {
      return {
        schema_version: 'official_whatsapp_send_recovery_v1',
        provider_result: candidate.provider_result,
        update_message:
          candidate.update_message &&
          typeof candidate.update_message === 'object'
            ? candidate.update_message
            : null,
        message_status_update:
          candidate.message_status_update &&
          typeof candidate.message_status_update === 'object'
            ? candidate.message_status_update
            : null,
        schedule_status_update:
          candidate.schedule_status_update &&
          typeof candidate.schedule_status_update === 'object'
            ? candidate.schedule_status_update
            : null,
        annotation:
          candidate.annotation &&
          typeof candidate.annotation === 'object' &&
          typeof candidate.annotation.message_id === 'string' &&
          typeof candidate.annotation.message === 'string' &&
          typeof candidate.annotation.date === 'string'
            ? candidate.annotation
            : null,
      };
    }

    const update = (result as { update_message?: unknown }).update_message;
    if (!update || typeof update !== 'object') {
      return null;
    }

    const recoveredUpdate = update as IUpdateMessage;
    const workerId = recoveredUpdate.data?.worker?.id;
    const messageUpdate: IUpdateMessage = {
      ...recoveredUpdate,
      worker_id: recoveredUpdate.worker_id ?? workerId,
      source_provider: recoveredUpdate.source_provider ?? 'official_whatsapp',
    };
    ensureMessageUpdateIdentity(messageUpdate);
    const providerMessageId = messageUpdate.message?.key?.id?.trim() || null;
    const remoteJid = messageUpdate.message?.key?.remoteJid;
    const providerResult: MetaWhatsappMessageSendResult = {
      message_id: providerMessageId,
      contact_wa_id:
        typeof remoteJid === 'string' ? remoteJid.split('@')[0] || null : null,
      message_status: 'sent',
      raw: {} as MetaWhatsappMessageSendResult['raw'],
    };
    const recovery = this.buildSucceededRecovery(
      data,
      providerResult,
      schedule
    );
    recovery.update_message = messageUpdate;
    return recovery;
  }

  private async recoverSucceededEffects(
    result: unknown,
    data: IChatMessage,
    schedule: IScheduleMessage | null,
    assertActive: () => void,
    assertLeaseActive: () => Promise<void> = async () => undefined
  ): Promise<boolean> {
    const recovery = this.normalizeSucceededRecovery(result, data, schedule);
    if (!recovery) {
      return false;
    }
    await this.applySucceededEffects(
      recovery,
      data,
      assertActive,
      schedule,
      assertLeaseActive
    );
    return true;
  }

  private async applySucceededEffects(
    recovery: IOfficialSucceededRecovery,
    data: IChatMessage,
    assertActive: () => void,
    schedule: IScheduleMessage | null,
    assertLeaseActive: () => Promise<void> = async () => undefined
  ): Promise<void> {
    if (recovery.update_message) {
      const messageUpdate: IUpdateMessage = {
        ...recovery.update_message,
        worker_id: recovery.update_message.worker_id ?? data.worker.id,
        source_provider:
          recovery.update_message.source_provider ?? 'official_whatsapp',
      };
      ensureMessageUpdateIdentity(messageUpdate);
      assertActive();
      await assertLeaseActive();
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessage(),
        messageUpdate,
        buildMessageUpdateKafkaKey(messageUpdate),
        undefined,
        async () => {
          assertActive();
          await assertLeaseActive();
          assertActive();
        }
      );
    }

    if (recovery.message_status_update) {
      assertActive();
      await assertLeaseActive();
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessageStatus(),
        recovery.message_status_update,
        MessageStatusService.statusKafkaKey(
          recovery.message_status_update.account_id,
          recovery.message_status_update.message_id,
          recovery.message_status_update.worker_id
        ),
        undefined,
        async () => {
          assertActive();
          await assertLeaseActive();
          assertActive();
        }
      );
    }

    assertActive();
    await assertLeaseActive();
    await this.officialWindowService.recordProviderAcceptedMessage(
      data,
      recovery.provider_result.message_id
    );

    if (schedule) {
      const scheduleStatus =
        recovery.schedule_status_update ??
        this.buildScheduleStatusUpdate(schedule, EScheduleStatus.sent);
      await this.publishScheduleStatusUpdate(
        scheduleStatus,
        assertActive,
        assertLeaseActive
      );
      await assertLeaseActive();
      await this.sendScheduleLog(
        schedule,
        recovery.provider_result,
        null,
        true,
        assertActive
      );
    }

    if (recovery.annotation) {
      await assertLeaseActive();
      await this.publishAnnotation(
        data,
        recovery.annotation.message,
        assertActive,
        recovery.annotation.message_id,
        recovery.annotation.date
      );
    }
  }

  private buildSentStatusUpdate(
    data: IChatMessage,
    result: MetaWhatsappMessageSendResult
  ): IMessageStatusUpdate | null {
    if (!result.message_id) {
      return null;
    }

    return {
      event_id: buildOfficialWhatsappMessageStatusEventId({
        accountId: data.account.id,
        workerId: data.worker.id,
        providerMessageId: result.message_id,
        status: 'sent',
      }),
      account_id: data.account.id,
      worker_id: data.worker.id,
      source_provider: 'official_whatsapp',
      message_id: result.message_id,
      patch: {
        is_sent: true,
      },
      key: {
        id: result.message_id,
        remoteJid: result.contact_wa_id
          ? `${result.contact_wa_id}@s.whatsapp.net`
          : (data.message_key?.remote_jid ?? undefined),
        fromMe: true,
      },
    };
  }

  private async routeFailedMessage(
    envelope: IQueuedEnvelope,
    error: unknown,
    assertLeaseActive: () => Promise<void> = async () => undefined,
    scheduleOperationalStateAlreadyDurable = false
  ): Promise<void> {
    if (
      this.isScheduleMessage(envelope.payload) &&
      !scheduleOperationalStateAlreadyDurable
    ) {
      const transitioned = this.isDefinitiveProviderRejection(error)
        ? await this.transitionScheduleProviderRejection(envelope.payload)
        : await this.transitionSchedulePreProviderFailure(envelope.payload);
      if (!transitioned) {
        return;
      }
    }

    const messageId = this.extractMessageId(envelope.payload);
    const message = this.resolvePayloadMessage(envelope.payload);
    if (messageId && message) {
      envelope.assertDispatchActive();
      await assertLeaseActive();
      if (error instanceof MetaGraphApiError) {
        await this.messageStatusService.markMessageAsNotSent(
          message.account.id,
          messageId,
          () => envelope.assertDispatchActive(),
          'failed',
          {
            errorCode: error.code,
            occurredAt: new Date().toISOString(),
          }
        );
      } else {
        await this.messageStatusService.markMessageAsNotSent(
          message.account.id,
          messageId,
          () => envelope.assertDispatchActive()
        );
      }
    }

    if (message?.content?.type === EMessageType.official_template) {
      envelope.assertDispatchActive();
      await assertLeaseActive();
      await this.officialWindowService.recordTemplateFailureForMessage(
        message,
        error instanceof MetaGraphApiError ? error.code : null
      );
    }

    if (
      message &&
      error instanceof MetaGraphApiError &&
      error.code === 131047
    ) {
      envelope.assertDispatchActive();
      await assertLeaseActive();
      await this.officialWindowService.markClosedByMetaReengagementForMessage(
        message,
        error.code
      );
    }

    const annotation = this.resolveWindowAnnotation(message, error);
    if (annotation && message) {
      await assertLeaseActive();
      await this.publishAnnotation(
        message,
        annotation,
        envelope.assertDispatchActive
      );
    }

    if (this.isScheduleMessage(envelope.payload)) {
      await this.sendScheduleStatusBestEffort(
        envelope.payload,
        EScheduleStatus.failed,
        envelope.assertDispatchActive,
        assertLeaseActive
      );
      await assertLeaseActive();
      await this.sendScheduleLogBestEffort(
        envelope.payload,
        null,
        this.errorMessage(error),
        false,
        envelope.assertDispatchActive
      );
    }

    console.error('[OfficialWhatsappMessageSend] terminal send failure:', {
      provider: this.PROVIDER,
      source_topic: envelope.sourceTopic,
      partition: envelope.partition,
      offset: envelope.offset,
      kafka_key: envelope.kafkaKey,
      queue_key: envelope.queueKey,
      chat_id: envelope.chatId,
      message_id: messageId,
      error: this.errorMessage(error),
    });
  }

  private extractMessageId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const value = (payload as { message_id?: unknown }).message_id;
    if (this.isScheduleMessage(payload)) {
      return payload.message.message_id?.trim() || null;
    }
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private async sendScheduleStatus(
    data: IScheduleMessage,
    status: EScheduleStatus.sent | EScheduleStatus.failed,
    assertActive: () => void,
    assertLeaseActive: () => Promise<void> = async () => undefined
  ): Promise<void> {
    await this.publishScheduleStatusUpdate(
      this.buildScheduleStatusUpdate(data, status),
      assertActive,
      assertLeaseActive
    );
  }

  private buildScheduleStatusUpdate(
    data: IScheduleMessage,
    status: EScheduleStatus.sent | EScheduleStatus.failed
  ): IScheduleStatusUpdate {
    const statusUpdate: IScheduleStatusUpdate = {
      attempt_id:
        data.attempt_id?.trim() || `legacy:${data.message.message_id}`,
      account_id: data.account_id ?? data.message.account.id,
      worker_id: data.message.worker.id,
      source_provider: 'official_whatsapp',
      schedule_id: data.schedule_id,
      contact_id: data.contact_id,
      message_id: data.message.message_id,
      processed_at: new Date().toISOString(),
      status,
    };
    ensureScheduleStatusEventId(statusUpdate);
    return statusUpdate;
  }

  private async publishScheduleStatusUpdate(
    statusUpdate: IScheduleStatusUpdate,
    assertActive: () => void,
    assertLeaseActive: () => Promise<void>
  ): Promise<void> {
    assertActive();
    await assertLeaseActive();
    await this.streamProducerService.send(
      this.kafkaServiceQueueService.scheduleStatusUpdate(),
      statusUpdate,
      buildScheduleStatusKafkaKey(statusUpdate),
      undefined,
      async () => {
        assertActive();
        await assertLeaseActive();
        assertActive();
      }
    );
  }

  private async sendScheduleStatusBestEffort(
    data: IScheduleMessage,
    status: EScheduleStatus.sent | EScheduleStatus.failed,
    assertActive: () => void,
    assertLeaseActive: () => Promise<void> = async () => undefined
  ): Promise<void> {
    try {
      await this.sendScheduleStatus(
        data,
        status,
        assertActive,
        assertLeaseActive
      );
    } catch (error) {
      if (
        isKafkaConsumerDispatchRevokedError(error) ||
        this.isScheduleMessageAttemptLeaseError(error)
      ) {
        throw error;
      }
      console.error(
        `Failed to publish official schedule status update for message ${data.message.message_id}:`,
        error
      );
    }
  }

  private isScheduleMessageAttemptLeaseError(
    error: unknown
  ): error is ScheduleMessageInFlightLeaseUnavailableError {
    return (
      error instanceof ScheduleMessageInFlightLeaseUnavailableError ||
      (error instanceof Error &&
        error.name === 'ScheduleMessageInFlightLeaseUnavailableError')
    );
  }

  private async sendScheduleLog(
    data: IScheduleMessage,
    result: MetaWhatsappMessageSendResult | null,
    error: string | null,
    success: boolean,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const sendLog = {
      result: success ? result : null,
      error,
      success,
      jid: data.message.message_key?.remote_jid ?? data.message.phone,
      payload: data.message.content,
    };

    assertActive();
    await this.elasticDatabaseService.updateField(
      EElasticIndex.schedule,
      data.message.message_id,
      'send_log',
      sendLog,
      3
    );
  }

  private async sendScheduleLogBestEffort(
    data: IScheduleMessage,
    result: MetaWhatsappMessageSendResult | null,
    error: string | null,
    success: boolean,
    assertActive: () => void
  ): Promise<void> {
    try {
      await this.sendScheduleLog(data, result, error, success, assertActive);
    } catch (logError) {
      if (isKafkaConsumerDispatchRevokedError(logError)) {
        throw logError;
      }
      console.error(
        `Failed to save official schedule send log for message ${data.message.message_id}:`,
        logError
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private resolveWindowAnnotation(
    message: IChatMessage | null,
    payload: unknown
  ): string | null {
    if (!message) {
      return null;
    }

    if (this.hasExplicitOpenWindowSignal(payload)) {
      return 'A Meta retornou um sinal explícito de janela de conversa válida para este contato neste canal oficial.';
    }

    return null;
  }

  private hasExplicitOpenWindowSignal(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if (payload instanceof MetaGraphApiError) {
      return false;
    }

    const stack: unknown[] = [payload];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') {
        continue;
      }

      for (const [key, value] of Object.entries(
        current as Record<string, unknown>
      )) {
        const normalizedKey = key.toLowerCase();
        if (
          /(?:conversation|customer|service).*window/u.test(normalizedKey) ||
          /window.*(?:open|valid|active)/u.test(normalizedKey)
        ) {
          if (value === true) {
            return true;
          }

          if (
            typeof value === 'string' &&
            /^(?:open|opened|active|valid|true)$/iu.test(value.trim())
          ) {
            return true;
          }
        }

        if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }

    return false;
  }

  private async publishAnnotation(
    data: IChatMessage,
    message: string,
    assertActive: () => void,
    preparedMessageId?: string,
    preparedDate?: string
  ): Promise<void> {
    assertActive();
    await this.chatMessageService.publishPreparedMessage(
      {
        message_id:
          preparedMessageId ?? this.buildAnnotationMessageId(data, null),
        chat_id: data.chat_id,
        message_key: {
          remote_jid: data.message_key?.remote_jid ?? null,
          remote_jid_alt: data.message_key?.remote_jid_alt ?? null,
          is_view_once: false,
        },
        type_user: ETypeUserChat.system,
        account: data.account,
        worker: data.worker,
        user: data.user ?? null,
        phone: data.phone,
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: true,
        },
        deleted: false,
        has_quoted: false,
        content: {
          type: EMessageType.annotation,
          message,
        },
        date: preparedDate ?? new Date().toISOString(),
      },
      undefined,
      assertActive
    );
  }

  private buildAnnotationMessageId(
    data: IChatMessage,
    providerMessageId: string | null
  ): string {
    const digest = createHash('sha256')
      .update(
        [
          'official-window-annotation:v1',
          data.account.id,
          data.worker.id,
          data.message_id,
          providerMessageId?.trim() || data.message_key?.id?.trim() || '',
        ].join('\0')
      )
      .digest('hex');
    const variant = (
      (Number.parseInt(digest.slice(16, 17), 16) & 0x3) |
      0x8
    ).toString(16);
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(
      13,
      16
    )}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  }
}
