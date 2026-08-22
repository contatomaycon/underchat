import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { baileysEnvironment } from '@core/config/environments';
import { IScheduleMessage } from '@core/common/interfaces/IScheduleMessage';
import { IScheduleStatusUpdate } from '@core/common/interfaces/IScheduleStatusUpdate';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { BaileysMessageMediaService } from '@core/services/baileys/methods/messageMedia.service';
import { BaileysPhoneValidationService } from '@core/services/baileys/methods/phoneValidation.service';
import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import {
  CONTACT_VALIDATION_SCHEDULE_SOURCE,
  IContactValidationUpdate,
} from '@core/common/interfaces/IContactValidationUpdate';
import { EMessageType } from '@core/common/enums/EMessageType';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { withLock } from '@core/common/functions/withLock';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import Redis from 'ioredis';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import {
  bindMessageSendOperationId,
  buildMessageSendQueueKey,
  buildScheduleSendQueueKey,
  resolveMessageSendIdentity,
  resolveMessageSendOperationId,
} from '@core/common/functions/messageIdentity';
import {
  IMessageSendAcquiredClaim,
  MessageSendClaimResult,
  MessageSendIdempotencyService,
} from '@core/services/messageSendIdempotency.service';
import {
  MessageUpdatePublishFailedError,
  isMessageUpdatePublishFailedError,
} from '@core/common/exceptions/MessageUpdatePublishFailedError';
import {
  buildMessageUpdateEventId,
  buildMessageUpdateKafkaKey,
  ensureMessageUpdateIdentity,
} from '@core/common/functions/messageUpdateIdentity';
import {
  buildScheduleStatusKafkaKey,
  ensureScheduleStatusEventId,
} from '@core/common/functions/scheduleStatusIdentity';
import { isKafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import {
  ScheduleMessageSendAmbiguousError,
  isScheduleMessageSendAmbiguousError,
} from '@core/common/exceptions/ScheduleMessageSendAmbiguousError';
import {
  IWhatsappRuntimeFence,
  WhatsappRuntimeFenceService,
} from '@core/services/whatsappRuntimeFence.service';
import {
  ScheduleMessageInFlightLeaseUnavailableError,
  ScheduleStatusCoordinationService,
} from '@core/services/scheduleStatusCoordination.service';
import { isProviderInvocationInFlightError } from '@core/common/functions/providerInvocationSingleFlight';
import {
  buildScheduleSendAmbiguousRecovery,
  IScheduleSendAmbiguousRecovery,
  normalizeScheduleSendAmbiguousRecovery,
} from '@core/common/functions/outboundAuxiliarySendRecovery';
import { resolveBaileysSendMessageTimeoutMs } from '@core/services/baileys/util/providerSendTimeout';
import type { IProviderInvocationBoundary } from '@core/common/interfaces/IProviderInvocationBoundary';
import { isPermanentMediaDownloadError } from '@core/common/functions/downloadMediaBuffer';

interface IRuntimeFenceDiscardError extends Error {
  readonly runtimeFenceDiscard: true;
}

type SchedulePreLeaseRecoveryResult =
  | { status: 'continue' }
  | { status: 'handled' }
  | {
      status: 'reserved_takeover';
      claim: IMessageSendAcquiredClaim;
      connectionScope: IWhatsappRuntimeFence;
    };

@singleton()
export class ScheduleMessageConsume {
  private readonly activeSendClaims = new Map<
    string,
    IMessageSendAcquiredClaim
  >();
  private activeSucceededRecoveries = new Map<
    string,
    { update_message: IUpdateMessage }
  >();
  private pendingTerminalCompactions = new Map<
    string,
    {
      claim: IMessageSendAcquiredClaim;
      state: 'failed';
      recovery: IScheduleSendAmbiguousRecovery;
    }
  >();
  private readonly providerInvokedSendClaims = new Set<string>();
  private readonly providerInvocationTransitionUncertainClaims =
    new Set<string>();
  private readonly activeSendDispatchGuards = new Map<string, () => void>();
  private readonly activeSendConnectionScopes = new Map<
    string,
    IWhatsappRuntimeFence
  >();
  private readonly activeScheduleLeaseGuards = new Map<
    string,
    () => Promise<void>
  >();
  private readonly activeScheduleAttemptIds = new Map<string, string>();
  private activeScheduleMessages = new Map<string, IScheduleMessage>();
  private readonly providerInvocationLeaseMs =
    MessageSendIdempotencyService.providerInvocationLeaseMs(
      resolveBaileysSendMessageTimeoutMs()
    );

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(BaileysMessageTextService)
    private readonly baileysMessageTextService: BaileysMessageTextService,
    @inject(BaileysMessageMediaService)
    private readonly baileysMessageMediaService: BaileysMessageMediaService,
    @inject(BaileysPhoneValidationService)
    private readonly baileysPhoneValidationService: BaileysPhoneValidationService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(MessageSendIdempotencyService)
    private readonly messageSendIdempotencyService: MessageSendIdempotencyService,
    @inject(BaileysIncomingMessageService)
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService,
    @inject(WhatsappRuntimeFenceService)
    private readonly runtimeFence: WhatsappRuntimeFenceService,
    @inject(ScheduleStatusCoordinationService)
    private readonly scheduleStatusCoordinationService: ScheduleStatusCoordinationService
  ) {}

  public async handleJetStreamCommand(
    payload: unknown,
    assertActive: () => void,
    operationId: string
  ): Promise<void> {
    const data = this.parseMessage(
      Buffer.from(JSON.stringify(payload), 'utf8')
    );
    if (!data) {
      throw new Error('worker_command_schedule_payload_invalid');
    }
    bindMessageSendOperationId(data.message, operationId);
    await this.processScheduleMessage(
      baileysEnvironment.baileysWorkerId,
      data,
      assertActive
    );
  }

  private async claimMessageSend(
    data: IScheduleMessage,
    connectionScope: IWhatsappRuntimeFence,
    consumerAssignmentEpoch?: number
  ): Promise<MessageSendClaimResult | null> {
    const identity = resolveMessageSendIdentity(data.message);
    const operationId = identity?.messageId ?? null;
    if (!identity || !operationId) {
      return null;
    }

    data.message.hash = identity.hash;

    return this.messageSendIdempotencyService.claimOperation({
      accountId: identity.accountId,
      operationType: 'schedule',
      operationId,
      meta: this.buildScheduleClaimMeta(
        data,
        identity,
        connectionScope,
        consumerAssignmentEpoch
      ),
      runtimeFenceKey: WhatsappRuntimeFenceService.key(
        connectionScope.worker_id
      ),
    });
  }

  private buildScheduleClaimMeta(
    data: IScheduleMessage,
    identity: NonNullable<ReturnType<typeof resolveMessageSendIdentity>>,
    connectionScope?: IWhatsappRuntimeFence,
    consumerAssignmentEpoch?: number
  ): Record<string, unknown> {
    return {
      provider: 'baileys',
      account_id: identity.accountId,
      chat_id: identity.chatId,
      message_id: identity.messageId,
      worker_id: baileysEnvironment.baileysWorkerId,
      schedule_id: data.schedule_id,
      contact_id: data.contact_id,
      ...(connectionScope
        ? {
            runtime_generation: connectionScope.runtime_generation,
            connection_epoch: connectionScope.connection_epoch,
            consumer_assignment_epoch: consumerAssignmentEpoch,
          }
        : {}),
    };
  }

  private async recoverScheduleSendBeforeAttemptLease(
    workerId: string,
    data: IScheduleMessage,
    assertDispatchActive: () => void,
    consumerAssignmentEpoch?: number
  ): Promise<SchedulePreLeaseRecoveryResult> {
    const identity = resolveMessageSendIdentity(data.message);
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

    assertDispatchActive();
    const inspection = await idempotencyService.inspectOperation({
      accountId: identity.accountId,
      operationType: 'schedule',
      operationId: identity.messageId,
      meta: this.buildScheduleClaimMeta(data, identity),
      compatibleLegacyMetaKeys: [
        'attempt_id',
        'runtime_generation',
        'connection_epoch',
        'consumer_assignment_epoch',
      ],
    });
    assertDispatchActive();

    if (inspection.status === 'error') {
      if (inspection.reason === 'identity_conflict') {
        console.error(
          '[ScheduleMessageConsume] Conflicting immutable recovery identity discarded before attempt lease',
          {
            schedule_id: data.schedule_id,
            contact_id: data.contact_id,
            message_id: data.message.message_id,
            attempt_id: data.attempt_id,
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
      const connectionScope = await this.captureActiveConnectionScope(workerId);
      assertDispatchActive();
      const takeover = await this.claimMessageSend(
        data,
        connectionScope,
        consumerAssignmentEpoch
      );
      if (!takeover) {
        throw new MessageUpdatePublishFailedError(
          new Error('schedule_reserved_takeover_identity_invalid')
        );
      }
      if (takeover.status === 'error') {
        if (takeover.reason === 'identity_conflict') {
          console.error(
            '[ScheduleMessageConsume] Reserved takeover identity conflict discarded',
            {
              schedule_id: data.schedule_id,
              contact_id: data.contact_id,
              message_id: data.message.message_id,
              attempt_id: data.attempt_id,
            }
          );
          return { status: 'handled' };
        }
        throw new MessageUpdatePublishFailedError(
          new Error(`schedule_reserved_takeover_${takeover.reason}`)
        );
      }
      if (takeover.status === 'duplicate') {
        if (takeover.compacted) {
          return { status: 'handled' };
        }
        throw new MessageUpdatePublishFailedError(
          new Error(`schedule_reserved_takeover_${takeover.state}`)
        );
      }

      try {
        const adoption =
          await this.scheduleStatusCoordinationService.adoptMessageAttemptFromLedgerReservation(
            {
              scheduleId: data.schedule_id,
              accountId: identity.accountId,
              workerId: data.message.worker.id,
              messageId: identity.messageId,
              attemptId:
                data.attempt_id?.trim() || `legacy:${identity.messageId}`,
              ledgerOperationId: takeover.operationId,
              ledgerReservationOwner: takeover.owner,
            }
          );
        if (adoption === 'stale' || adoption === 'terminal') {
          await idempotencyService
            .releaseReservation(takeover)
            .catch(() => undefined);
          console.error(
            '[ScheduleMessageConsume] Reserved ledger takeover was not adopted by the operational identity',
            {
              schedule_id: data.schedule_id,
              contact_id: data.contact_id,
              message_id: data.message.message_id,
              attempt_id: data.attempt_id,
              adoption,
            }
          );
          return { status: 'handled' };
        }
        if (adoption === 'invalid') {
          throw new Error('schedule_reserved_takeover_adoption_invalid');
        }
      } catch (error) {
        await idempotencyService
          .releaseReservation(takeover)
          .catch(() => undefined);
        throw new MessageUpdatePublishFailedError(error);
      }
      try {
        assertDispatchActive();
      } catch (error) {
        await idempotencyService
          .releaseReservation(takeover)
          .catch(() => undefined);
        throw error;
      }
      return {
        status: 'reserved_takeover',
        claim: takeover,
        connectionScope,
      };
    }
    if (inspection.state === 'provider_invoked') {
      throw new MessageUpdatePublishFailedError(
        new Error('message_send_idempotency_provider_invoked')
      );
    }
    if (inspection.state === 'ambiguous') {
      await this.recoverDuplicateAmbiguousSchedule(inspection, data, true);
      return { status: 'handled' };
    }
    if (inspection.state === 'succeeded') {
      await this.ensureScheduleOperationalStateFromLedger(
        inspection,
        data,
        'succeeded'
      );
      const currentConnectionScope =
        await this.captureActiveConnectionScope(workerId);
      await this.recoverSucceededSchedule(
        inspection.result,
        data,
        currentConnectionScope,
        assertDispatchActive
      );
      await this.compactTerminalRecovery(
        inspection,
        'succeeded',
        inspection.result
      );
      return { status: 'handled' };
    }
    if (inspection.state === 'failed') {
      await this.ensureScheduleOperationalStateFromLedger(
        inspection,
        data,
        'pre_provider_failed'
      );
      const currentConnectionScope =
        await this.captureActiveConnectionScope(workerId);
      await this.sendStatusUpdateBestEffort(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.failed,
        currentConnectionScope,
        assertDispatchActive,
        data.account_id ?? data.message.account.id
      );
      await this.compactTerminalRecovery(
        inspection,
        'failed',
        inspection.result
      );
      return { status: 'handled' };
    }
    return { status: 'continue' };
  }

  private parseMessage(value: Buffer | null): IScheduleMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return this.isScheduleMessagePayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private isScheduleMessagePayload(value: unknown): value is IScheduleMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const payload = value as Record<string, unknown>;
    const message = payload.message;
    if (
      !this.isNonEmptyString(payload.schedule_id) ||
      !this.isNonEmptyString(payload.contact_id) ||
      typeof payload.is_validated !== 'boolean' ||
      !this.isOptionalString(payload.attempt_id) ||
      !this.isOptionalString(payload.account_id) ||
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message)
    ) {
      return false;
    }

    const chatMessage = message as Record<string, unknown>;
    const account = chatMessage.account;
    const worker = chatMessage.worker;
    const content = chatMessage.content;
    const messageKey = chatMessage.message_key;
    if (
      !this.isNonEmptyString(chatMessage.message_id) ||
      !this.isNonEmptyString(chatMessage.chat_id) ||
      !this.isNonEmptyString(chatMessage.phone) ||
      !this.isOptionalString(chatMessage.phone_ddi) ||
      !account ||
      typeof account !== 'object' ||
      Array.isArray(account) ||
      !this.isNonEmptyString((account as Record<string, unknown>).id) ||
      !worker ||
      typeof worker !== 'object' ||
      Array.isArray(worker) ||
      !this.isNonEmptyString((worker as Record<string, unknown>).id) ||
      !content ||
      typeof content !== 'object' ||
      Array.isArray(content) ||
      !messageKey ||
      typeof messageKey !== 'object' ||
      Array.isArray(messageKey)
    ) {
      return false;
    }

    const key = messageKey as Record<string, unknown>;
    if (
      !this.isOptionalString(key.remote_jid) ||
      !this.isOptionalString(key.remote_jid_alt) ||
      !this.isOptionalBoolean(key.is_view_once)
    ) {
      return false;
    }
    if (!(
      this.isNonEmptyString(key.remote_jid) ||
      this.isNonEmptyString(key.remote_jid_alt)
    )) {
      return false;
    }

    return this.isScheduleContentPayload(content as Record<string, unknown>);
  }

  private isOptionalString(value: unknown): boolean {
    return value === undefined || value === null || typeof value === 'string';
  }

  private isOptionalBoolean(value: unknown): boolean {
    return value === undefined || value === null || typeof value === 'boolean';
  }

  private isOptionalFiniteNumber(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'number' && Number.isFinite(value))
    );
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isScheduleContentPayload(content: Record<string, unknown>): boolean {
    const type = content.type;
    if (!this.isOptionalString(content.message)) {
      return false;
    }
    if (type === EMessageType.text) {
      return this.isNonEmptyString(content.message);
    }
    if (type === EMessageType.image) {
      return this.isScheduleMediaPayload(content.image, {
        stringFields: ['caption', 'mimetype', 'extension', 'thumbnail'],
        numberFields: ['size', 'height', 'width'],
      });
    }
    if (type === EMessageType.video) {
      return this.isScheduleMediaPayload(content.video, {
        stringFields: ['caption', 'name', 'mimetype', 'extension', 'thumbnail'],
        numberFields: ['size', 'duration', 'height', 'width'],
      });
    }
    if (type === EMessageType.audio) {
      return this.isScheduleMediaPayload(content.audio, {
        stringFields: [
          'name',
          'mimetype',
          'extension',
          'waveform',
          'transcription',
        ],
        numberFields: ['size', 'duration'],
        booleanFields: ['ptt', 'view_once'],
      });
    }
    return false;
  }

  private isScheduleMediaPayload(
    value: unknown,
    fields: {
      stringFields: readonly string[];
      numberFields: readonly string[];
      booleanFields?: readonly string[];
    }
  ): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const media = value as Record<string, unknown>;
    if (!this.isNonEmptyString(media.url)) {
      return false;
    }
    return (
      fields.stringFields.every((field) =>
        this.isOptionalString(media[field])
      ) &&
      fields.numberFields.every((field) =>
        this.isOptionalFiniteNumber(media[field])
      ) &&
      (fields.booleanFields ?? []).every((field) =>
        this.isOptionalBoolean(media[field])
      )
    );
  }

  private async processScheduleMessage(
    workerId: string,
    data: IScheduleMessage,
    assertDispatchActive: () => void = () => undefined,
    consumerAssignmentEpoch?: number
  ): Promise<void> {
    this.scheduleMessageContexts().set(data.message.message_id, data);
    try {
      const preLeaseRecovery = await this.recoverScheduleSendBeforeAttemptLease(
        workerId,
        data,
        assertDispatchActive,
        consumerAssignmentEpoch
      );
      if (preLeaseRecovery.status === 'handled') {
        return;
      }
      await this.withScheduleMessageInFlight(
        data.schedule_id,
        data.message.message_id,
        data.attempt_id,
        async (assertLeaseActive) => {
          this.activeScheduleLeaseGuards?.set(
            data.message.message_id,
            assertLeaseActive
          );
          const attemptId = data.attempt_id?.trim();
          if (attemptId) {
            this.activeScheduleAttemptIds?.set(
              data.message.message_id,
              attemptId
            );
          }
          try {
            await assertLeaseActive();
            await this.processScheduleMessageWithLease(
              workerId,
              data,
              assertDispatchActive,
              consumerAssignmentEpoch,
              preLeaseRecovery.status === 'reserved_takeover'
                ? preLeaseRecovery
                : null
            );
          } finally {
            this.activeScheduleLeaseGuards?.delete(data.message.message_id);
            this.activeScheduleAttemptIds?.delete(data.message.message_id);
          }
        }
      );
    } catch (error) {
      if (this.isScheduleMessageInFlightLeaseError(error)) {
        console.info(
          '[ScheduleMessageConsume] Deferring message without an active distributed lease',
          {
            schedule_id: data.schedule_id,
            message_id: data.message.message_id,
          }
        );
        throw new MessageUpdatePublishFailedError(error);
      }
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error)
      ) {
        throw error;
      }
      // A raw error escaping withMessageInFlight is coordination
      // infrastructure (claim/heartbeat/final ownership assertion). Business
      // failures are classified and terminalized inside the leased callback.
      throw new MessageUpdatePublishFailedError(error);
    } finally {
      this.scheduleMessageContexts().delete(data.message.message_id);
      this.pendingTerminalCompactionMap().delete(data.message.message_id);
    }
  }

  private async processScheduleMessageWithLease(
    workerId: string,
    data: IScheduleMessage,
    assertDispatchActive: () => void = () => undefined,
    consumerAssignmentEpoch?: number,
    reservedTakeover: Extract<
      SchedulePreLeaseRecoveryResult,
      { status: 'reserved_takeover' }
    > | null = null
  ): Promise<void> {
    let connectionScope: IWhatsappRuntimeFence | null =
      reservedTakeover?.connectionScope ?? null;
    try {
      await this.assertScheduleMessageLeaseActive(data.message.message_id);
      assertDispatchActive();
      if (!connectionScope) {
        connectionScope = await this.captureActiveConnectionScope(workerId);
      }
      assertDispatchActive();
      await this.assertScheduleMessageLeaseActive(data.message.message_id);
      const claim =
        reservedTakeover?.claim ??
        (await this.claimMessageSend(
          data,
          connectionScope,
          consumerAssignmentEpoch
        ));
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
          await this.recoverDuplicateSucceededSchedule(
            claim,
            data,
            connectionScope,
            assertDispatchActive
          );
        } else if (claim.state === 'provider_invoked') {
          throw new MessageUpdatePublishFailedError(
            new Error('message_send_idempotency_provider_invoked')
          );
        } else if (claim.state === 'ambiguous') {
          await this.recoverDuplicateAmbiguousSchedule(claim, data);
        } else if (claim.state === 'failed') {
          await this.recoverDuplicateFailedSchedule(
            claim,
            data,
            connectionScope,
            assertDispatchActive
          );
        } else {
          throw new MessageUpdatePublishFailedError(
            new Error(`message_send_idempotency_${claim.state}`)
          );
        }
        return;
      }

      try {
        assertDispatchActive();
        await this.assertScheduleMessageLeaseActive(data.message.message_id);
        this.activeSendClaims.set(data.message.message_id, claim);
        this.activeSendDispatchGuards?.set(
          data.message.message_id,
          assertDispatchActive
        );
        this.activeSendConnectionScopes?.set(
          data.message.message_id,
          connectionScope
        );
        await this.assertScheduleMessageLeaseActive(data.message.message_id);
        await withLock(
          this.redis,
          `schedule:send:${this.resolveEntityKey(workerId, data)}`,
          () => this.handleMessage(data),
          { ttlMs: 300000, retryMs: 500 }
        );
        const succeededRecovery = this.succeededRecoveryMap().get(
          data.message.message_id
        );
        if (succeededRecovery) {
          await this.compactTerminalRecovery(
            claim,
            'succeeded',
            succeededRecovery
          );
        }
        await this.assertScheduleMessageLeaseActive(data.message.message_id);
        if (!this.providerInvokedSendClaims.has(data.message.message_id)) {
          await this.messageSendIdempotencyService
            .releaseReservation(claim)
            .catch(() => undefined);
          return;
        }
        if (this.activeSendClaims.get(data.message.message_id) === claim) {
          throw new Error(
            'message_send_provider_result_recovery_not_persisted'
          );
        }
      } catch (error) {
        const providerInvoked = this.providerInvokedSendClaims.has(
          data.message.message_id
        );
        const claimStillActive =
          this.activeSendClaims.get(data.message.message_id) === claim;
        if (providerInvoked && claimStillActive) {
          const recovery = this.buildScheduleAmbiguousRecovery(data, claim);
          await this.terminalizeAmbiguousScheduleSend(claim, error, recovery);
          await this.ensureScheduleOperationalState(data, 'ambiguous');
          throw new ScheduleMessageSendAmbiguousError(error);
        }

        // Once succeeded is durable the provider must never be replayed. Any
        // later fence/lease/Kafka/Redis failure is recovered from the
        // succeeded ledger on redelivery.
        if (providerInvoked && !claimStillActive) {
          throw isMessageUpdatePublishFailedError(error)
            ? error
            : new MessageUpdatePublishFailedError(error);
        }

        const transitionUncertain =
          this.providerInvocationTransitionUncertainClaims?.has(
            data.message.message_id
          ) === true;
        if (
          !providerInvoked &&
          !transitionUncertain &&
          this.isPermanentPreProviderFailure(error)
        ) {
          await this.persistSchedulePreProviderFailure(claim, data, error);
          throw error;
        }
        if (!providerInvoked && !transitionUncertain) {
          await this.messageSendIdempotencyService
            .releaseReservation(claim)
            .catch(() => undefined);
        }

        if (
          isMessageUpdatePublishFailedError(error) ||
          isKafkaConsumerDispatchRevokedError(error)
        ) {
          throw error;
        }
        // Lock acquisition/renewal, Redis, runtime fencing, provider
        // capacity and every opaque pre-provider error are transient by
        // default. Failing closed prevents a technical outage from being
        // committed as a business failure.
        throw new MessageUpdatePublishFailedError(error);
      } finally {
        this.activeSendClaims.delete(data.message.message_id);
        this.succeededRecoveryMap().delete(data.message.message_id);
        this.providerInvokedSendClaims.delete(data.message.message_id);
        this.providerInvocationTransitionUncertainClaims?.delete(
          data.message.message_id
        );
        this.activeSendDispatchGuards?.delete(data.message.message_id);
        this.activeSendConnectionScopes?.delete(data.message.message_id);
      }
    } catch (error) {
      if (isScheduleMessageSendAmbiguousError(error)) {
        if (isKafkaConsumerDispatchRevokedError(error.originalCause)) {
          throw error.originalCause;
        }
        console.warn(
          '[ScheduleMessageConsume] Schedule provider result is ambiguous; suppressing failed status and automatic retry',
          {
            schedule_id: data.schedule_id,
            contact_id: data.contact_id,
            message_id: data.message.message_id,
            attempt_id: data.attempt_id,
            error:
              error.originalCause instanceof Error
                ? error.originalCause.message
                : String(error.originalCause),
          }
        );
        return;
      }
      if (this.isRuntimeFenceDiscardError(error)) {
        throw new MessageUpdatePublishFailedError(error);
      }
      if (this.isScheduleMessageInFlightLeaseError(error)) {
        throw new MessageUpdatePublishFailedError(error);
      }
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error)
      ) {
        throw error;
      }
      if (!this.isPermanentPreProviderFailure(error)) {
        throw new MessageUpdatePublishFailedError(error);
      }
      console.error(
        `Error processing schedule message for schedule ${data.schedule_id}, contact ${data.contact_id}:`,
        error
      );

      if (!(await this.transitionSchedulePreProviderFailureBestEffort(data))) {
        return;
      }
      await this.sendStatusUpdateBestEffort(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.failed,
        connectionScope,
        assertDispatchActive,
        data.account_id ?? data.message.account.id
      );
      const pendingCompaction = this.pendingTerminalCompactionMap().get(
        data.message.message_id
      );
      if (pendingCompaction) {
        await this.compactTerminalRecovery(
          pendingCompaction.claim,
          pendingCompaction.state,
          pendingCompaction.recovery
        );
        this.pendingTerminalCompactionMap().delete(data.message.message_id);
      }
    }
  }

  private buildScheduleAmbiguousRecovery(
    data: IScheduleMessage,
    claim: Pick<
      Extract<MessageSendClaimResult, { status: 'acquired' | 'duplicate' }>,
      'accountId' | 'operationId'
    >
  ): IScheduleSendAmbiguousRecovery {
    const messageId = data.message.message_id.trim();
    return buildScheduleSendAmbiguousRecovery({
      provider: 'baileys',
      operationId: claim.operationId,
      scheduleId: data.schedule_id,
      contactId: data.contact_id,
      messageId,
      attemptId: data.attempt_id?.trim() || `legacy:${messageId}`,
      accountId: claim.accountId,
      workerId: baileysEnvironment.baileysWorkerId,
    });
  }

  private async recoverDuplicateAmbiguousSchedule(
    claim: Extract<MessageSendClaimResult, { status: 'duplicate' }>,
    data: IScheduleMessage,
    beforeAttemptLease = false
  ): Promise<void> {
    const expected = this.buildScheduleAmbiguousRecovery(data, claim);
    const recovery = normalizeScheduleSendAmbiguousRecovery(claim.result, {
      provider: expected.provider,
      operationId: expected.operation_id,
      scheduleId: expected.schedule_id,
      contactId: expected.contact_id,
      messageId: expected.message_id,
      attemptId: expected.attempt_id,
      accountId: expected.account_id,
      workerId: expected.worker_id,
    });
    if (!recovery) {
      const identity = resolveMessageSendIdentity(data.message);
      if (!identity) {
        throw new MessageUpdatePublishFailedError(
          new Error('schedule_send_recovery_identity_invalid')
        );
      }
      const legacyRecovery =
        await this.messageSendIdempotencyService.recoverLegacyAmbiguous(
          claim,
          expected,
          this.buildScheduleClaimMeta(data, identity),
          [
            'attempt_id',
            'runtime_generation',
            'connection_epoch',
            'consumer_assignment_epoch',
          ]
        );
      if (legacyRecovery === 'transitioned') {
        if (beforeAttemptLease) {
          await this.ensureScheduleOperationalStateFromLedger(
            claim,
            data,
            'ambiguous'
          );
        } else {
          await this.ensureScheduleOperationalState(data, 'ambiguous');
        }
        return;
      }
      if (legacyRecovery === 'identity_conflict') {
        if (beforeAttemptLease) {
          console.error(
            '[ScheduleMessageConsume] Legacy ledger recovery identity changed before terminal CAS',
            {
              schedule_id: data.schedule_id,
              contact_id: data.contact_id,
              message_id: data.message.message_id,
              attempt_id: data.attempt_id,
            }
          );
          return;
        }
        await this.ensureScheduleOperationalState(data, 'pre_provider_failed');
        return;
      }
      throw new MessageUpdatePublishFailedError(
        new Error(`schedule_send_${claim.state}_recovery_${legacyRecovery}`)
      );
    }
    if (beforeAttemptLease) {
      await this.ensureScheduleOperationalStateFromLedger(
        claim,
        data,
        'ambiguous'
      );
    } else {
      await this.ensureScheduleOperationalState(data, 'ambiguous');
    }
  }

  private async terminalizeAmbiguousScheduleSend(
    claim: IMessageSendAcquiredClaim,
    error: unknown,
    recovery: IScheduleSendAmbiguousRecovery
  ): Promise<void> {
    try {
      const transition = await this.messageSendIdempotencyService.markAmbiguous(
        claim,
        error,
        recovery
      );
      if (transition !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(`message_send_idempotency_ambiguous_${transition}`)
        );
      }
    } catch (transitionError) {
      if (isMessageUpdatePublishFailedError(transitionError)) {
        throw transitionError;
      }
      throw new MessageUpdatePublishFailedError(transitionError);
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

  private async ensureScheduleOperationalState(
    data: IScheduleMessage,
    state: 'pre_provider_failed' | 'ambiguous'
  ): Promise<void> {
    try {
      await this.transitionScheduleOperationalState(data, state);
    } catch (error) {
      if (isMessageUpdatePublishFailedError(error)) {
        throw error;
      }
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async ensureScheduleOperationalStateFromLedger(
    claim: Pick<
      Extract<MessageSendClaimResult, { status: 'duplicate' }>,
      'operationId'
    >,
    data: IScheduleMessage,
    state: 'pre_provider_failed' | 'ambiguous' | 'succeeded'
  ): Promise<void> {
    try {
      const messageId = data.message.message_id;
      const result =
        await this.scheduleStatusCoordinationService.setMessageOperationalStateFromLedger(
          {
            scheduleId: data.schedule_id,
            accountId: data.account_id?.trim() || data.message.account.id,
            workerId: data.message.worker.id,
            messageId,
            attemptId: data.attempt_id?.trim() || `legacy:${messageId}`,
            ledgerOperationId: claim.operationId,
          },
          state
        );
      if (result === 'stale') {
        console.error(
          '[ScheduleMessageConsume] Ledger outcome matched but operational identity was stale; provider remains terminal and will not be retried',
          {
            schedule_id: data.schedule_id,
            contact_id: data.contact_id,
            message_id: data.message.message_id,
            attempt_id: data.attempt_id,
            state,
          }
        );
        return;
      }
      if (result === 'invalid') {
        throw new Error(
          `schedule_message_ledger_operational_state_${state}_${result}`
        );
      }
    } catch (error) {
      if (isMessageUpdatePublishFailedError(error)) {
        throw error;
      }
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async recoverDuplicateSucceededSchedule(
    claim: Extract<MessageSendClaimResult, { status: 'duplicate' }>,
    data: IScheduleMessage,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void
  ): Promise<void> {
    try {
      await this.ensureScheduleOperationalStateFromLedger(
        claim,
        data,
        'succeeded'
      );
      await this.recoverSucceededSchedule(
        claim.result,
        data,
        connectionScope,
        assertDispatchActive
      );
      await this.compactTerminalRecovery(claim, 'succeeded', claim.result);
    } catch (error) {
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error)
      ) {
        throw error;
      }
      console.error(
        `Failed to recover succeeded schedule message update for message ${data.message.message_id}:`,
        error
      );
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async recoverDuplicateFailedSchedule(
    claim: Extract<MessageSendClaimResult, { status: 'duplicate' }>,
    data: IScheduleMessage,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void
  ): Promise<void> {
    await this.ensureScheduleOperationalStateFromLedger(
      claim,
      data,
      'pre_provider_failed'
    );
    await this.sendStatusUpdateBestEffort(
      data.schedule_id,
      data.contact_id,
      data.message.message_id,
      EScheduleStatus.failed,
      connectionScope,
      assertDispatchActive,
      data.account_id ?? data.message.account.id
    );
  }

  private async persistSchedulePreProviderFailure(
    claim: IMessageSendAcquiredClaim,
    data: IScheduleMessage,
    error: unknown
  ): Promise<void> {
    try {
      // Keep the attempt out of the immutable send identity, but persist it in
      // the recovery result so the singleton drainer can CAS the exact
      // schedule attempt if this worker dies before the operational update.
      const recovery = this.buildScheduleAmbiguousRecovery(data, claim);
      const transition = await this.messageSendIdempotencyService.markFailed(
        claim,
        error,
        recovery
      );
      if (transition !== 'transitioned') {
        throw new Error(
          `message_send_idempotency_pre_provider_failed_${transition}`
        );
      }
      this.pendingTerminalCompactionMap().set(data.message.message_id, {
        claim,
        state: 'failed',
        recovery,
      });
      await this.ensureScheduleOperationalStateFromLedger(
        claim,
        data,
        'pre_provider_failed'
      );
    } catch (transitionError) {
      if (
        isMessageUpdatePublishFailedError(transitionError) ||
        isKafkaConsumerDispatchRevokedError(transitionError)
      ) {
        throw transitionError;
      }
      throw new MessageUpdatePublishFailedError(transitionError);
    }
  }

  private async recoverSucceededSchedule(
    result: unknown,
    data: IScheduleMessage,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void = () => undefined
  ): Promise<void> {
    try {
      await this.recoverSucceededUpdate(
        result,
        data,
        connectionScope,
        assertDispatchActive
      );
      await this.sendStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent,
        connectionScope,
        assertDispatchActive,
        data.account_id ?? data.message.account.id
      );
    } catch (error) {
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error)
      ) {
        throw error;
      }
      console.error(
        `Failed to recover succeeded schedule message ${data.message.message_id}:`,
        error
      );
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private resolveEntityKey(workerId: string, data: IScheduleMessage): string {
    const identity = resolveMessageSendIdentity(data.message);
    const accountId =
      identity?.accountId ||
      data.account_id ||
      data.message?.account?.id ||
      'unknown-account';
    const normalizedAccountId = String(accountId).trim() || 'unknown-account';
    const normalizedWorkerId = workerId.trim() || 'unknown-channel';

    const chatId = identity?.chatId?.trim();
    return chatId
      ? buildMessageSendQueueKey(normalizedAccountId, chatId)
      : buildScheduleSendQueueKey(normalizedAccountId, normalizedWorkerId);
  }

  private buildPhoneWithDdi(
    phone: string | null | undefined,
    phoneDdi: string | null | undefined
  ): string {
    const ddi = phoneDdi || '55';
    return `${ddi}${phone ?? ''}`;
  }

  private isTechnicalValidationError(error: unknown): boolean {
    if (this.isInvalidValidationError(error)) {
      return false;
    }
    // validatePhone has an explicit invalid result/error contract. Every other
    // thrown value is an SDK/infrastructure failure and must be redriven.
    return true;
  }

  private isPermanentPreProviderFailure(error: unknown): boolean {
    if (isPermanentMediaDownloadError(error)) {
      return true;
    }
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.trim();
    return (
      message === 'Received message without remoteJid' ||
      message === 'Message type is required' ||
      message === 'Image URL is required' ||
      message === 'Video URL is required' ||
      message === 'Audio URL is required' ||
      message.startsWith('Unsupported message type:')
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

  private async publishInvalidContactValidationUpdate(
    data: IScheduleMessage,
    fallbackPhoneWithDdi: string,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void
  ): Promise<void> {
    try {
      await this.publishContactValidationUpdate(
        data,
        fallbackPhoneWithDdi,
        false,
        connectionScope,
        assertDispatchActive
      );
    } catch (publishError) {
      if (
        isKafkaConsumerDispatchRevokedError(publishError) ||
        this.isRuntimeFenceDiscardError(publishError) ||
        this.isScheduleMessageInFlightLeaseError(publishError)
      ) {
        throw publishError;
      }
      throw isMessageUpdatePublishFailedError(publishError)
        ? publishError
        : new MessageUpdatePublishFailedError(publishError);
    }
  }

  private shouldPublishValidationSuccessUpdate(
    data: IScheduleMessage,
    validatedPhoneWithDdi: string
  ): boolean {
    if (!data.is_validated) {
      return true;
    }

    const currentPhoneWithDdi = this.buildPhoneWithDdi(
      data.message.phone,
      data.message.phone_ddi
    );

    return (
      onlyDigits(currentPhoneWithDdi) !== onlyDigits(validatedPhoneWithDdi)
    );
  }

  private async publishContactValidationUpdate(
    data: IScheduleMessage,
    phoneWithDdi: string,
    isValidated: boolean,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void = () => undefined
  ): Promise<void> {
    const contactUpdate: IContactValidationUpdate = {
      contact_id: data.contact_id,
      phone: phoneWithDdi,
      is_validated: isValidated,
      account_id: data.account_id ?? data.message.account?.id,
      worker_id: connectionScope.worker_id,
      source_provider: connectionScope.source_provider,
      runtime_generation: connectionScope.runtime_generation,
      connection_epoch: connectionScope.connection_epoch,
      operation_id:
        data.attempt_id?.trim() ||
        resolveMessageSendOperationId(data.message) ||
        undefined,
      source: CONTACT_VALIDATION_SCHEDULE_SOURCE,
    };

    const topic = this.kafkaServiceQueueService.contactValidationUpdate();
    await this.assertContactValidationContextActive(
      data,
      connectionScope,
      assertDispatchActive
    );
    await this.streamProducerService.send(
      topic,
      contactUpdate,
      `${contactUpdate.account_id ?? 'unknown'}:${data.contact_id}`,
      undefined,
      () =>
        this.assertContactValidationContextActive(
          data,
          connectionScope,
          assertDispatchActive
        )
    );
    await this.assertContactValidationContextActive(
      data,
      connectionScope,
      assertDispatchActive
    );
  }

  private async resolveValidatedJid(
    data: IScheduleMessage,
    fallbackJid: string,
    assertDispatchActive: () => void = () => undefined
  ): Promise<string | null> {
    const phone = data.message.phone;
    const phoneDdi = data.message.phone_ddi || '55';

    if (!phone) {
      if (data.is_validated) {
        return fallbackJid;
      }
      return null;
    }

    const fallbackPhoneWithDdi = this.buildPhoneWithDdi(phone, phoneDdi);
    const connectionScope =
      this.activeSendConnectionScopes?.get(data.message.message_id) ?? null;
    if (!connectionScope) {
      throw this.runtimeFenceDiscardError(
        'whatsapp_connection_scope_active_send_missing'
      );
    }
    const maxRetries = 3;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.assertContactValidationContextActive(
          data,
          connectionScope,
          assertDispatchActive
        );
        const validationResult =
          await this.baileysPhoneValidationService.validatePhone(
            phoneDdi,
            phone
          );
        await this.assertContactValidationContextActive(
          data,
          connectionScope,
          assertDispatchActive
        );

        if (!validationResult.valid) {
          await this.publishContactValidationUpdate(
            data,
            fallbackPhoneWithDdi,
            false,
            connectionScope,
            assertDispatchActive
          );
          return null;
        }

        const normalizedFromResponse = validationResult.phone
          ? extractPhoneAndDdi(validationResult.phone)
          : null;
        const validatedPhoneWithDdi = normalizedFromResponse
          ? `${normalizedFromResponse.phone_ddi}${normalizedFromResponse.phone}`
          : validationResult.phone ||
            getPhoneFromJid(validationResult.jid, null) ||
            fallbackPhoneWithDdi;

        let validatedJid = validationResult.jid ?? null;
        if (!validatedJid && normalizedFromResponse) {
          validatedJid =
            normalizePhoneToJid(
              normalizedFromResponse.phone,
              normalizedFromResponse.phone_ddi
            ) ?? null;
        }

        const jidToUse = validatedJid ?? fallbackJid;
        if (!jidToUse) {
          return null;
        }

        if (
          this.shouldPublishValidationSuccessUpdate(data, validatedPhoneWithDdi)
        ) {
          await this.publishContactValidationUpdate(
            data,
            validatedPhoneWithDdi,
            true,
            connectionScope,
            assertDispatchActive
          );
        }

        return jidToUse;
      } catch (error) {
        if (
          isKafkaConsumerDispatchRevokedError(error) ||
          this.isRuntimeFenceDiscardError(error) ||
          this.isScheduleMessageInFlightLeaseError(error)
        ) {
          throw error;
        }
        lastError = error;

        if (this.isInvalidValidationError(error)) {
          await this.publishInvalidContactValidationUpdate(
            data,
            fallbackPhoneWithDdi,
            connectionScope,
            assertDispatchActive
          );
          return null;
        }

        if (this.isTechnicalValidationError(error) && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        break;
      }
    }

    if (lastError instanceof Error) {
      console.warn(
        `[ScheduleMessageConsume] Phone validation failed after ${maxRetries} attempts for contact ${data.contact_id}: ${lastError.message}`
      );
    }

    if (lastError !== null && this.isTechnicalValidationError(lastError)) {
      throw new MessageUpdatePublishFailedError(lastError);
    }

    return data.is_validated ? fallbackJid : null;
  }

  private async handleMessage(data: IScheduleMessage): Promise<void> {
    const assertDispatchActive =
      this.activeSendDispatchGuards?.get(data.message.message_id) ??
      (() => undefined);
    assertDispatchActive();

    const fallbackJid = selectJidChat(data.message);

    if (!fallbackJid) {
      throw new Error('Received message without remoteJid');
    }

    const jid = await this.resolveValidatedJid(
      data,
      fallbackJid,
      assertDispatchActive
    );
    assertDispatchActive();
    if (!jid) {
      await this.sendStatusUpdateBestEffort(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.ignored
      );
      return;
    }

    const messageType = data.message.content?.type;

    if (!messageType) {
      throw new Error('Message type is required');
    }

    if (
      messageType !== EMessageType.text &&
      messageType !== EMessageType.image &&
      messageType !== EMessageType.video &&
      messageType !== EMessageType.audio
    ) {
      throw new Error(`Unsupported message type: ${messageType}`);
    }
    if (
      messageType === EMessageType.image &&
      !data.message.content?.image?.url
    ) {
      throw new Error('Image URL is required');
    }
    if (
      messageType === EMessageType.video &&
      !data.message.content?.video?.url
    ) {
      throw new Error('Video URL is required');
    }
    if (
      messageType === EMessageType.audio &&
      !data.message.content?.audio?.url
    ) {
      throw new Error('Audio URL is required');
    }

    try {
      if (messageType === EMessageType.text) {
        await this.processText(jid, data);
        return;
      }

      if (messageType === EMessageType.image) {
        await this.processImage(jid, data);
        return;
      }

      if (messageType === EMessageType.video) {
        await this.processVideo(jid, data);
        return;
      }

      if (messageType === EMessageType.audio) {
        await this.processAudio(jid, data);
        return;
      }

      throw new Error(`Unsupported message type: ${messageType}`);
    } catch (error) {
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error) ||
        isProviderInvocationInFlightError(error)
      ) {
        throw error;
      }
      const providerInvoked = this.providerInvokedSendClaims.has(
        data.message.message_id
      );
      if (!providerInvoked && !this.isPermanentPreProviderFailure(error)) {
        throw new MessageUpdatePublishFailedError(error);
      }
      if (!providerInvoked) {
        if (
          !(await this.transitionSchedulePreProviderFailureBestEffort(data))
        ) {
          throw error;
        }
        await this.sendStatusUpdateBestEffort(
          data.schedule_id,
          data.contact_id,
          data.message.message_id,
          EScheduleStatus.failed
        );
      }
      throw error;
    }
  }

  private async markActiveProviderInvoked(
    input: IScheduleMessage | string
  ): Promise<void> {
    const data =
      typeof input === 'string'
        ? this.scheduleMessageContexts().get(input)
        : input;
    if (!data) {
      throw new Error('schedule_message_operational_context_missing');
    }
    const messageId = data.message.message_id;
    this.activeSendDispatchGuards?.get(messageId)?.();
    await this.assertScheduleMessageLeaseActive(messageId);
    const connectionScope =
      this.activeSendConnectionScopes?.get(messageId) ?? null;
    if (!connectionScope) {
      throw this.runtimeFenceDiscardError(
        'whatsapp_connection_scope_active_send_missing'
      );
    }
    await this.assertConnectionScopeActive(connectionScope);
    const claim = this.activeSendClaims.get(messageId);
    if (!claim) {
      throw new Error('message_send_idempotency_active_claim_missing');
    }
    if (this.providerInvokedSendClaims.has(messageId)) {
      return;
    }

    this.activeSendDispatchGuards?.get(messageId)?.();
    await this.assertScheduleMessageLeaseActive(messageId);
    const ambiguousRecovery = this.buildScheduleAmbiguousRecovery(data, claim);
    this.providerInvocationTransitionUncertainClaims?.add(messageId);
    const invoked =
      await this.messageSendIdempotencyService.markProviderInvoked(
        claim,
        ambiguousRecovery,
        this.providerInvocationLeaseMs ??
          MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS
      );
    if (invoked !== 'transitioned') {
      throw new MessageUpdatePublishFailedError(
        new Error(`message_send_idempotency_provider_invoked_${invoked}`)
      );
    }
    this.providerInvocationTransitionUncertainClaims?.delete(messageId);
    this.providerInvokedSendClaims.add(messageId);
    try {
      // No asynchronous work is allowed after the durable transition. The
      // helper performs the exact provider/socket assertion synchronously.
      this.activeSendDispatchGuards?.get(messageId)?.();
    } catch (error) {
      const reverted =
        await this.messageSendIdempotencyService.revertProviderInvocationBeforeStart(
          claim
        );
      if (reverted !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(
            `message_send_idempotency_provider_start_revert_${reverted}`
          )
        );
      }
      this.providerInvokedSendClaims.delete(messageId);
      throw error;
    }
  }

  private providerInvocationBoundary(
    data: IScheduleMessage
  ): IProviderInvocationBoundary {
    const messageId = data.message.message_id;
    const boundary = async (): Promise<void> => {
      await this.markActiveProviderInvoked(data);
    };
    boundary.assertActive = (): void => {
      const dispatchGuard = this.activeSendDispatchGuards?.get(messageId);
      if (
        !dispatchGuard ||
        !this.activeSendClaims.has(messageId) ||
        !this.activeSendConnectionScopes?.has(messageId) ||
        !this.providerInvokedSendClaims.has(messageId)
      ) {
        throw this.runtimeFenceDiscardError(
          'whatsapp_connection_scope_active_send_missing'
        );
      }
      dispatchGuard();
    };
    boundary.onStartRejected = async (): Promise<void> => {
      if (!this.providerInvokedSendClaims.has(messageId)) {
        return;
      }
      const claim = this.activeSendClaims.get(messageId);
      if (!claim) {
        throw new MessageUpdatePublishFailedError(
          new Error('message_send_idempotency_active_claim_missing')
        );
      }
      const reverted =
        await this.messageSendIdempotencyService.revertProviderInvocationBeforeStart(
          claim
        );
      if (reverted !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(
            `message_send_idempotency_provider_start_revert_${reverted}`
          )
        );
      }
      this.providerInvokedSendClaims.delete(messageId);
    };
    return boundary;
  }

  private async transitionScheduleOperationalState(
    data: IScheduleMessage,
    state: 'pre_provider_failed' | 'ambiguous' | 'succeeded'
  ): Promise<void> {
    const messageId = data.message.message_id;
    const connectionScope =
      this.activeSendConnectionScopes?.get(messageId) ?? null;
    const result =
      await this.scheduleStatusCoordinationService.setMessageOperationalState(
        {
          scheduleId: data.schedule_id,
          accountId: data.account_id?.trim() || data.message.account.id,
          workerId: connectionScope?.worker_id ?? data.message.worker.id,
          messageId,
          attemptId:
            data.attempt_id?.trim() ||
            this.activeScheduleAttemptIds?.get(messageId) ||
            `legacy:${messageId}`,
        },
        state
      );
    if (result === 'stale' || result === 'invalid') {
      throw new Error(`schedule_message_operational_state_${state}_${result}`);
    }
  }

  private async transitionSchedulePreProviderFailureBestEffort(
    data: IScheduleMessage
  ): Promise<boolean> {
    try {
      await this.transitionScheduleOperationalState(
        data,
        'pre_provider_failed'
      );
      return true;
    } catch (error) {
      const permanentRejection =
        error instanceof Error &&
        (error.message ===
          'schedule_message_operational_state_pre_provider_failed_stale' ||
          error.message ===
            'schedule_message_operational_state_pre_provider_failed_invalid');
      if (!permanentRejection) {
        throw isMessageUpdatePublishFailedError(error)
          ? error
          : new MessageUpdatePublishFailedError(error);
      }
      console.warn(
        '[ScheduleMessageConsume] Suppressing failed status because the durable operational outcome rejected the transition',
        {
          schedule_id: data.schedule_id,
          contact_id: data.contact_id,
          message_id: data.message.message_id,
          attempt_id: data.attempt_id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  private async processText(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    let result = null;
    let error: string | null = null;

    try {
      result = await this.baileysMessageTextService.sendText(
        jid,
        data.message.content?.message ?? '',
        undefined,
        this.providerInvocationBoundary(data)
      );

      if (!result) {
        throw new Error('Failed to send text message');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdateBestEffort(update, data.message.message_id);

      await this.sendSentStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (
        !this.providerInvokedSendClaims.has(data.message.message_id) &&
        this.isPermanentPreProviderFailure(err)
      ) {
        await this.sendSendLog(data, jid, null, error, false);
      }
      throw err;
    }
  }

  private async processImage(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const imageUrl = data.message.content?.image?.url;

    if (!imageUrl) {
      throw new Error('Image URL is required');
    }

    let result = null;
    let error: string | null = null;

    try {
      result = await this.baileysMessageMediaService.sendImage(
        jid,
        { url: imageUrl },
        {
          caption: data.message.content?.image?.caption ?? undefined,
        },
        undefined,
        this.providerInvocationBoundary(data)
      );

      if (!result) {
        throw new Error('Failed to send image');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdateBestEffort(update, data.message.message_id);

      await this.sendSentStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (
        !this.providerInvokedSendClaims.has(data.message.message_id) &&
        this.isPermanentPreProviderFailure(err)
      ) {
        await this.sendSendLog(data, jid, null, error, false);
      }
      throw err;
    }
  }

  private async processVideo(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const video = data.message.content?.video;

    if (!video?.url) {
      throw new Error('Video URL is required');
    }

    let result = null;
    let error: string | null = null;

    try {
      result = await this.baileysMessageMediaService.sendVideo(
        jid,
        {
          url: video.url,
          mimetype: video.mimetype ?? undefined,
          filename: video.name ?? undefined,
          filesize: video.size ?? undefined,
        },
        {
          caption: video.caption ?? data.message.content?.message ?? undefined,
          seconds: data.message.content?.video?.duration ?? undefined,
          mimetype: video.mimetype ?? undefined,
          fileName: video.name ?? undefined,
          filesize: video.size ?? undefined,
        },
        undefined,
        this.providerInvocationBoundary(data)
      );

      if (!result) {
        throw new Error('Failed to send video');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdateBestEffort(update, data.message.message_id);

      await this.sendSentStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (
        !this.providerInvokedSendClaims.has(data.message.message_id) &&
        this.isPermanentPreProviderFailure(err)
      ) {
        await this.sendSendLog(data, jid, null, error, false);
      }
      throw err;
    }
  }

  private async processAudio(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const audio = data.message.content?.audio;

    if (!audio?.url) {
      throw new Error('Audio URL is required');
    }

    let result = null;
    let error: string | null = null;

    try {
      const isViewOnce = this.resolveViewOnceFlag(
        data.message.message_key?.is_view_once,
        audio.view_once
      );
      const isPtt = isViewOnce ? true : (audio.ptt ?? false);

      result = await this.baileysMessageMediaService.sendAudio(
        jid,
        {
          url: audio.url,
          mimetype: audio.mimetype ?? undefined,
          filename: audio.name ?? undefined,
          filesize: audio.size ?? undefined,
        },
        {
          ptt: isPtt,
          seconds: audio.duration ?? undefined,
          mimetype: audio.mimetype ?? undefined,
          fileName: audio.name ?? undefined,
          filesize: audio.size ?? undefined,
          viewOnce: isViewOnce,
        },
        undefined,
        this.providerInvocationBoundary(data)
      );

      if (!result) {
        throw new Error('Failed to send audio');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdateBestEffort(update, data.message.message_id);

      await this.sendSentStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (
        !this.providerInvokedSendClaims.has(data.message.message_id) &&
        this.isPermanentPreProviderFailure(err)
      ) {
        await this.sendSendLog(data, jid, null, error, false);
      }
      throw err;
    }
  }

  private resolveViewOnceFlag(...values: unknown[]): boolean {
    return values.some((value) => this.isTruthyViewOnce(value));
  }

  private isTruthyViewOnce(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return (
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'yes' ||
        normalized === 'on'
      );
    }

    return false;
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();
    const messageId = input.data?.message_id;
    const assertDispatchActive =
      this.activeSendDispatchGuards?.get(messageId) ?? (() => undefined);
    const connectionScope =
      this.activeSendConnectionScopes?.get(messageId) ?? null;
    if (!connectionScope) {
      throw this.runtimeFenceDiscardError(
        'whatsapp_connection_scope_active_send_missing'
      );
    }
    input.worker_id = connectionScope.worker_id;
    input.source_provider = connectionScope.source_provider;
    input.runtime_generation = connectionScope.runtime_generation;
    input.connection_epoch = connectionScope.connection_epoch;
    ensureMessageUpdateIdentity(input);
    const claim = messageId ? this.activeSendClaims.get(messageId) : undefined;
    const succeededRecovery = claim ? { update_message: input } : null;
    if (claim) {
      const succeeded = await this.messageSendIdempotencyService.markSucceeded(
        claim,
        succeededRecovery
      );
      if (succeeded !== 'transitioned') {
        throw new Error(`message_send_idempotency_${succeeded}`);
      }
      if (this.activeSendClaims.get(messageId) === claim) {
        this.activeSendClaims.delete(messageId);
      }
      if (succeededRecovery) {
        this.succeededRecoveryMap().set(messageId, succeededRecovery);
      }
      const scheduleMessage = this.scheduleMessageContexts().get(messageId);
      if (!scheduleMessage) {
        throw new MessageUpdatePublishFailedError(
          new Error('schedule_message_operational_context_missing')
        );
      }
      try {
        await this.transitionScheduleOperationalState(
          scheduleMessage,
          'succeeded'
        );
      } catch (error) {
        throw new MessageUpdatePublishFailedError(error);
      }
    }
    try {
      assertDispatchActive();
      await this.assertConnectionScopeActive(connectionScope);
      assertDispatchActive();
      await this.assertScheduleMessageLeaseActive(messageId);
      assertDispatchActive();
      await this.streamProducerService.send(
        topic,
        input,
        buildMessageUpdateKafkaKey(input),
        undefined,
        async () => {
          assertDispatchActive();
          await this.assertConnectionScopeActive(connectionScope);
          await this.assertScheduleMessageLeaseActive(messageId);
        }
      );
    } catch (error) {
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async recoverSucceededUpdate(
    result: unknown,
    data: IScheduleMessage,
    currentConnectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void = () => undefined
  ): Promise<void> {
    try {
      assertDispatchActive();
      if (!result || typeof result !== 'object') {
        throw new Error('schedule_succeeded_recovery_result_missing');
      }

      const update = (result as { update_message?: unknown }).update_message;
      if (!update || typeof update !== 'object') {
        throw new Error('schedule_succeeded_recovery_update_missing');
      }

      const persistedUpdate = update as IUpdateMessage;
      const persistedScope = this.connectionScopeFromEvent(persistedUpdate);
      const expectedIdentity = resolveMessageSendIdentity(data.message);
      const persistedIdentity = resolveMessageSendIdentity(
        persistedUpdate.data
      );
      const providerMessageId = persistedUpdate.message?.key?.id?.trim();
      const storedEventId = persistedUpdate.event_id?.trim();
      const expectedEventId = buildMessageUpdateEventId(persistedUpdate);
      if (
        !persistedScope ||
        persistedScope.source_provider !== 'baileys' ||
        persistedScope.worker_id !== currentConnectionScope.worker_id ||
        currentConnectionScope.source_provider !== 'baileys' ||
        currentConnectionScope.worker_id !== data.message.worker.id.trim() ||
        !expectedIdentity ||
        !persistedIdentity ||
        expectedIdentity.accountId !== persistedIdentity.accountId ||
        expectedIdentity.chatId !== persistedIdentity.chatId ||
        expectedIdentity.messageId !== persistedIdentity.messageId ||
        persistedUpdate.data?.worker?.id?.trim() !==
          currentConnectionScope.worker_id ||
        !providerMessageId ||
        !storedEventId ||
        storedEventId !== expectedEventId
      ) {
        throw new Error('schedule_succeeded_recovery_identity_mismatch');
      }

      const messageUpdate: IUpdateMessage = {
        ...persistedUpdate,
        worker_id: currentConnectionScope.worker_id,
        source_provider: currentConnectionScope.source_provider,
        runtime_generation: currentConnectionScope.runtime_generation,
        connection_epoch: currentConnectionScope.connection_epoch,
      };
      const messageId = messageUpdate.data?.message_id;
      await this.assertScheduleMessageLeaseActive(messageId);
      await this.assertConnectionScopeActive(currentConnectionScope);
      assertDispatchActive();
      ensureMessageUpdateIdentity(messageUpdate);
      await this.assertScheduleMessageLeaseActive(messageId);
      assertDispatchActive();
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessage(),
        messageUpdate,
        buildMessageUpdateKafkaKey(messageUpdate),
        undefined,
        async () => {
          assertDispatchActive();
          await this.assertConnectionScopeActive(currentConnectionScope);
          await this.assertScheduleMessageLeaseActive(messageId);
        }
      );
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

  private async pushUpdateBestEffort(
    input: IUpdateMessage,
    messageId: string
  ): Promise<void> {
    try {
      await this.pushUpdate(input);
    } catch (error) {
      if (
        isMessageUpdatePublishFailedError(error) ||
        isKafkaConsumerDispatchRevokedError(error)
      ) {
        throw error;
      }
      console.error(
        `Failed to publish schedule message update for message ${messageId}:`,
        error
      );
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async sendStatusUpdate(
    scheduleId: string,
    contactId: string,
    messageId: string,
    status:
      EScheduleStatus.sent | EScheduleStatus.failed | EScheduleStatus.ignored,
    explicitConnectionScope?: IWhatsappRuntimeFence | null,
    explicitAssertDispatchActive?: () => void,
    explicitAccountId?: string
  ): Promise<void> {
    const assertDispatchActive =
      explicitAssertDispatchActive ??
      this.activeSendDispatchGuards?.get(messageId) ??
      (() => undefined);
    assertDispatchActive();
    await this.assertScheduleMessageLeaseActive(messageId);
    const connectionScope =
      explicitConnectionScope ??
      this.activeSendConnectionScopes?.get(messageId) ??
      null;
    if (!connectionScope) {
      throw this.runtimeFenceDiscardError(
        'whatsapp_connection_scope_active_send_missing'
      );
    }
    await this.assertConnectionScopeActive(connectionScope);
    assertDispatchActive();
    const scheduleMessage = this.scheduleMessageContexts().get(messageId);
    const statusUpdate: IScheduleStatusUpdate = {
      attempt_id:
        scheduleMessage?.attempt_id?.trim() ||
        this.activeScheduleAttemptIds?.get(messageId) ||
        `legacy:${messageId}`,
      account_id:
        explicitAccountId?.trim() ||
        scheduleMessage?.account_id?.trim() ||
        scheduleMessage?.message.account.id,
      worker_id: connectionScope.worker_id,
      source_provider: connectionScope.source_provider,
      runtime_generation: connectionScope.runtime_generation,
      connection_epoch: connectionScope.connection_epoch,
      schedule_id: scheduleId,
      contact_id: contactId,
      message_id: messageId,
      processed_at: new Date().toISOString(),
      status,
    };
    ensureScheduleStatusEventId(statusUpdate);

    const topic = this.kafkaServiceQueueService.scheduleStatusUpdate();
    assertDispatchActive();
    await this.assertScheduleMessageLeaseActive(messageId);
    await this.streamProducerService.send(
      topic,
      statusUpdate,
      buildScheduleStatusKafkaKey(statusUpdate),
      undefined,
      async () => {
        assertDispatchActive();
        await this.assertConnectionScopeActive(connectionScope);
        await this.assertScheduleMessageLeaseActive(messageId);
      }
    );
  }

  private async sendStatusUpdateBestEffort(
    scheduleId: string,
    contactId: string,
    messageId: string,
    status:
      EScheduleStatus.sent | EScheduleStatus.failed | EScheduleStatus.ignored,
    connectionScope?: IWhatsappRuntimeFence | null,
    assertDispatchActive?: () => void,
    explicitAccountId?: string
  ): Promise<void> {
    try {
      await this.sendStatusUpdate(
        scheduleId,
        contactId,
        messageId,
        status,
        connectionScope,
        assertDispatchActive,
        explicitAccountId
      );
    } catch (error) {
      if (isKafkaConsumerDispatchRevokedError(error)) {
        throw error;
      }
      console.error(
        `Failed to publish schedule status update for message ${messageId}:`,
        error
      );
      throw isMessageUpdatePublishFailedError(error)
        ? error
        : new MessageUpdatePublishFailedError(error);
    }
  }

  private async sendSentStatusUpdate(
    scheduleId: string,
    contactId: string,
    messageId: string,
    status: EScheduleStatus.sent
  ): Promise<void> {
    try {
      await this.sendStatusUpdate(scheduleId, contactId, messageId, status);
    } catch (error) {
      if (this.isRuntimeFenceDiscardError(error)) {
        throw error;
      }
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private async withScheduleMessageInFlight<T>(
    scheduleId: string,
    messageId: string,
    attemptId: string | undefined,
    callback: (assertOwned: () => Promise<void>) => Promise<T>
  ): Promise<T> {
    const coordination = this.scheduleStatusCoordinationService;
    if (!coordination) {
      return callback(async () => undefined);
    }
    return coordination.withMessageInFlight(
      { scheduleId, messageId, attemptId },
      callback
    );
  }

  private scheduleMessageContexts(): Map<string, IScheduleMessage> {
    this.activeScheduleMessages ??= new Map<string, IScheduleMessage>();
    return this.activeScheduleMessages;
  }

  private succeededRecoveryMap(): Map<
    string,
    { update_message: IUpdateMessage }
  > {
    this.activeSucceededRecoveries ??= new Map();
    return this.activeSucceededRecoveries;
  }

  private pendingTerminalCompactionMap(): Map<
    string,
    {
      claim: IMessageSendAcquiredClaim;
      state: 'failed';
      recovery: IScheduleSendAmbiguousRecovery;
    }
  > {
    this.pendingTerminalCompactions ??= new Map();
    return this.pendingTerminalCompactions;
  }

  private async assertScheduleMessageLeaseActive(
    messageId: string | undefined
  ): Promise<void> {
    if (!messageId) {
      return;
    }
    await this.activeScheduleLeaseGuards?.get(messageId)?.();
  }

  private async assertContactValidationContextActive(
    data: IScheduleMessage,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void
  ): Promise<void> {
    const messageId = data.message.message_id;
    assertDispatchActive();
    await this.assertScheduleMessageLeaseActive(messageId);
    assertDispatchActive();

    const activeConnectionScope =
      this.activeSendConnectionScopes?.get(messageId) ?? null;
    if (
      !activeConnectionScope ||
      activeConnectionScope.worker_id !== connectionScope.worker_id ||
      activeConnectionScope.source_provider !==
        connectionScope.source_provider ||
      activeConnectionScope.runtime_generation !==
        connectionScope.runtime_generation ||
      activeConnectionScope.connection_epoch !==
        connectionScope.connection_epoch
    ) {
      throw this.runtimeFenceDiscardError(
        'whatsapp_connection_scope_active_send_changed'
      );
    }

    await this.assertConnectionScopeActive(connectionScope);
    assertDispatchActive();
    await this.assertScheduleMessageLeaseActive(messageId);
    assertDispatchActive();
  }

  private isScheduleMessageInFlightLeaseError(
    error: unknown
  ): error is ScheduleMessageInFlightLeaseUnavailableError {
    return (
      error instanceof ScheduleMessageInFlightLeaseUnavailableError ||
      (error instanceof Error &&
        error.name === 'ScheduleMessageInFlightLeaseUnavailableError')
    );
  }

  private async captureActiveConnectionScope(
    workerId: string
  ): Promise<IWhatsappRuntimeFence> {
    let connectionScope: IWhatsappRuntimeFence | null;
    try {
      connectionScope =
        await this.baileysIncomingMessageService.captureActiveConnectionScope();
    } catch (error) {
      if (isKafkaConsumerDispatchRevokedError(error)) {
        throw error;
      }
      throw isMessageUpdatePublishFailedError(error)
        ? error
        : new MessageUpdatePublishFailedError(error);
    }
    if (
      !connectionScope ||
      connectionScope.worker_id !== workerId ||
      connectionScope.source_provider !== 'baileys'
    ) {
      throw new MessageUpdatePublishFailedError(
        new Error('whatsapp_connection_scope_unavailable_or_stale')
      );
    }
    return connectionScope;
  }

  private connectionScopeFromEvent(
    event: Pick<
      IUpdateMessage,
      | 'worker_id'
      | 'source_provider'
      | 'runtime_generation'
      | 'connection_epoch'
    >
  ): IWhatsappRuntimeFence | null {
    const workerId = event.worker_id?.trim();
    const connectionEpoch = event.connection_epoch?.trim();
    const runtimeGeneration = Number(event.runtime_generation);
    if (
      !workerId ||
      !connectionEpoch ||
      event.source_provider !== 'baileys' ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      return null;
    }
    return {
      worker_id: workerId,
      source_provider: 'baileys',
      runtime_generation: runtimeGeneration,
      connection_epoch: connectionEpoch,
      connection_sequence: 1,
      activated_at: 1,
    };
  }

  private async assertConnectionScopeActive(
    connectionScope: IWhatsappRuntimeFence
  ): Promise<void> {
    if (!(await this.runtimeFence.isCurrent(connectionScope))) {
      throw this.runtimeFenceDiscardError('whatsapp_connection_scope_revoked');
    }
  }

  private runtimeFenceDiscardError(message: string): IRuntimeFenceDiscardError {
    const error = new Error(message) as IRuntimeFenceDiscardError;
    Object.defineProperty(error, 'runtimeFenceDiscard', {
      value: true,
      enumerable: false,
    });
    return error;
  }

  private isRuntimeFenceDiscardError(
    error: unknown
  ): error is IRuntimeFenceDiscardError {
    return (
      error instanceof Error &&
      (error as Partial<IRuntimeFenceDiscardError>).runtimeFenceDiscard === true
    );
  }

  private async sendSendLog(
    data: IScheduleMessage,
    jid: string,
    result: any,
    error: string | null,
    success: boolean
  ): Promise<void> {
    const assertDispatchActive =
      this.activeSendDispatchGuards?.get(data.message.message_id) ??
      (() => undefined);
    assertDispatchActive();
    await this.assertScheduleMessageLeaseActive(data.message.message_id);
    try {
      await this.elasticDatabaseService.indices(
        EElasticIndex.schedule,
        scheduleMappings()
      );
      assertDispatchActive();
      await this.assertScheduleMessageLeaseActive(data.message.message_id);

      const sendLog = {
        result: success ? result : null,
        error,
        success,
        jid,
        payload: data.message.content,
      };

      assertDispatchActive();
      await this.assertScheduleMessageLeaseActive(data.message.message_id);
      await this.elasticDatabaseService.updateField(
        EElasticIndex.schedule,
        data.message.message_id,
        'send_log',
        sendLog,
        3
      );
    } catch (error) {
      if (isKafkaConsumerDispatchRevokedError(error)) {
        throw error;
      }
      console.error(
        `Failed to save send log for message ${data.message.message_id}:`,
        error
      );
    }
  }
}
