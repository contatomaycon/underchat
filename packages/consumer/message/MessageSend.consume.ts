import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { BaileysMessageMediaService } from '@core/services/baileys/methods/messageMedia.service';
import { BaileysMessageReactionsInteractionsService } from '@core/services/baileys/methods/messageReactionsInteractions.service';
import { BaileysMessageEditDeleteService } from '@core/services/baileys/methods/messageEditDelete.service';
import { BaileysMessageLocationContactService } from '@core/services/baileys/methods/messageLocationContact.service';
import { BaileysMessageStatusStoriesService } from '@core/services/baileys/methods/messageStatusStories.service';
import { BaileysProfileService } from '@core/services/baileys/methods/profile.service';
import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  IChatMessage,
  IContactMessage,
} from '@core/common/interfaces/IChatMessage';
import { IProfileStatusMessage } from '@core/common/interfaces/IProfileStatusMessage';
import { IProfileStatusDeleteMessage } from '@core/common/interfaces/IProfileStatusDeleteMessage';
import { IProfileInfoMessage } from '@core/common/interfaces/IProfileInfoMessage';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import {
  proto,
  WAMessage,
  WAUrlInfo,
  type WAMessageKey,
} from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { convertWaveformBase64ToUint8Array } from '@core/common/functions/convertWaveform';
import { createHash, webcrypto } from 'node:crypto';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { MessageKeyLookupService } from '@core/services/messageKeyLookup.service';
import { isMessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';
import {
  MessageUpdatePublishFailedError,
  isMessageUpdatePublishFailedError,
} from '@core/common/exceptions/MessageUpdatePublishFailedError';
import { MessageStatusService } from '@core/services/messageStatus.service';
import {
  IMessageSendAcquiredClaim,
  MessageSendClaimResult,
  MessageSendIdempotencyService,
} from '@core/services/messageSendIdempotency.service';
import {
  bindMessageSendOperationId,
  buildMessageSendQueueKey,
  resolveMessageSendIdentity,
  resolveMessageSendOperationId,
} from '@core/common/functions/messageIdentity';
import { isKafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import {
  buildMessageUpdateKafkaKey,
  buildMessageUpdateEventId,
  ensureMessageUpdateIdentity,
} from '@core/common/functions/messageUpdateIdentity';
import {
  WhatsappRuntimeFenceService,
  type IWhatsappRuntimeFence,
} from '@core/services/whatsappRuntimeFence.service';
import type { IProviderInvocationBoundary } from '@core/common/interfaces/IProviderInvocationBoundary';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import {
  buildMessageStatusEventId,
  ensureMessageStatusEventId,
} from '@core/common/functions/messageStatusIdentity';
import type { IMessageSendTerminalFailureRecovery } from '@core/common/interfaces/IMessageSendTerminalFailureRecovery';
import type { IMessageSendAmbiguousTerminalRecovery } from '@core/common/interfaces/IMessageSendAmbiguousTerminalRecovery';
import {
  buildMessageSendNoUpdateRequiredResult,
  isMessageSendNoUpdateRequiredResult,
} from '@core/common/functions/messageSendNoUpdateRequired';
import { resolveBaileysSendMessageTimeoutMs } from '@core/services/baileys/util/providerSendTimeout';
import { resolveTypingSimulationMaxDelayMs } from '@core/common/functions/typingSimulationConfig';
import {
  isPermanentMediaDownloadError,
  MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS,
} from '@core/common/functions/downloadMediaBuffer';
import {
  resolveMessageSendPreProviderTimeoutMs,
  resolveMessageSendReservationLeaseMs,
} from '@core/common/functions/messageSendPreProviderBudget';
import {
  isRuntimeSafeChatMessagePayload,
  isRuntimeSafeProfileInfoPayload,
  isRuntimeSafeProfileStatusDeletePayload,
  isRuntimeSafeProfileStatusPayload,
} from '@core/common/functions/messageSendRuntimeValidation';
import {
  buildProfileStatusExternalIdRecovery,
  normalizeProfileStatusExternalIdRecovery,
  type IProfileStatusExternalIdRecovery,
} from '@core/common/functions/providerCommandAuxiliaryRecovery';

type MessageSendDurableTerminalRecovery =
  IMessageSendTerminalFailureRecovery | IMessageSendAmbiguousTerminalRecovery;

type ProviderCommandAfterDurableSuccess = ((
  assertPublisherActive: () => Promise<void>
) => Promise<void>) & {
  recovery?: IProfileStatusExternalIdRecovery;
};

interface IQueuedEnvelope {
  commandId?: string;
  sourceTopic: string;
  partition: number;
  offset: number;
  kafkaKey: string | null;
  payload: unknown;
  queueKey: string;
  chatId: string | null;
  consumerAssignmentEpoch?: number;
  assertDispatchActive: () => void;
  connectionScope?: IWhatsappRuntimeFence | null;
  connectionScopeCaptured?: boolean;
}

type ForwardFailReason =
  | 'missing_source_key'
  | 'source_key_incomplete'
  | 'source_not_found_cache_or_store'
  | 'native_forward_exception'
  | 'fallback_handler_unavailable';

interface INonRetryableError extends Error {
  readonly nonRetryable: true;
}

interface IProviderInvocationTransitionUncertainError extends Error {
  readonly providerInvocationTransitionUncertain: true;
}

const FAILURE_STATUS_PUBLISH_MAX_ATTEMPTS = 3;
const FAILURE_STATUS_PUBLISH_RETRY_DELAYS_MS = [100, 300] as const;

@singleton()
export class MessageSendConsume {
  private readonly PROVIDER = 'baileys';
  private readonly MAX_PROCESS_ATTEMPTS = 5;
  private readonly RETRY_BASE_MS = 500;
  private readonly RETRY_MAX_MS = 8000;
  private readonly FORWARD_SOURCE_KEY_MAX_WAIT_MS = 4000;
  private readonly FORWARD_SOURCE_KEY_POLL_INTERVAL_MS = 300;
  private readonly PROVIDER_SEND_TIMEOUT_MS =
    resolveBaileysSendMessageTimeoutMs();
  private readonly PRE_PROVIDER_TIMEOUT_MS =
    resolveMessageSendPreProviderTimeoutMs({
      providerTimeoutMs: this.PROVIDER_SEND_TIMEOUT_MS,
      preparationTimeoutMs: Math.max(
        MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS,
        this.FORWARD_SOURCE_KEY_MAX_WAIT_MS
      ),
      typingSimulationMaxDelayMs: resolveTypingSimulationMaxDelayMs(),
    });
  private readonly RESERVATION_LEASE_MS = resolveMessageSendReservationLeaseMs(
    this.PRE_PROVIDER_TIMEOUT_MS,
    MessageSendIdempotencyService.LEASE_MS
  );
  private readonly PROVIDER_INVOCATION_LEASE_MS =
    MessageSendIdempotencyService.providerInvocationLeaseMs(
      this.PROVIDER_SEND_TIMEOUT_MS
    );
  private readonly SYSTEM_QUEUE_KEY = 'system';
  private readonly lastMessageTypeByChatId: Map<string, EMessageType> =
    new Map();
  private readonly activeSendClaims = new Map<
    string,
    IMessageSendAcquiredClaim
  >();
  private readonly providerInvokedSendClaims = new Set<string>();
  private readonly activeSendDispatchGuards = new Map<string, () => void>();
  private readonly activeSendConnectionScopes = new Map<
    string,
    IWhatsappRuntimeFence
  >();
  private readonly activeSendPreProviderDeadlines = new Map<string, number>();
  private readonly activeSendProviderStartedResolvers = new Map<
    string,
    () => void
  >();
  private activeSendOperationOwners = new Map<string, symbol>();

  constructor(
    @inject(BaileysMessageTextService)
    private readonly baileysMessageTextService: BaileysMessageTextService,
    @inject(BaileysMessageMediaService)
    private readonly baileysMessageMediaService: BaileysMessageMediaService,
    @inject(BaileysMessageReactionsInteractionsService)
    private readonly baileysMessageReactionsInteractionsService: BaileysMessageReactionsInteractionsService,
    @inject(BaileysMessageEditDeleteService)
    private readonly baileysMessageEditDeleteService: BaileysMessageEditDeleteService,
    @inject(BaileysMessageLocationContactService)
    private readonly baileysMessageLocationContactService: BaileysMessageLocationContactService,
    @inject(BaileysMessageStatusStoriesService)
    private readonly baileysMessageStatusStoriesService: BaileysMessageStatusStoriesService,
    @inject(BaileysProfileService)
    private readonly baileysProfileService: BaileysProfileService,
    @inject(BaileysIncomingMessageService)
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService,
    @inject(MessageKeyLookupService)
    private readonly messageKeyLookupService: MessageKeyLookupService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(MessageSendIdempotencyService)
    private readonly messageSendIdempotencyService: MessageSendIdempotencyService
  ) {}

  private extractMessageId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const value = (payload as { message_id?: unknown }).message_id;
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private activeSendKey(data: IChatMessage | string): string {
    if (typeof data === 'string') {
      const directKey = data.trim();
      if (this.activeSendClaims?.has(directKey)) {
        return directKey;
      }
      const matchingKeys = Array.from(this.activeSendClaims?.entries() ?? [])
        .filter(([, claim]) => claim.operationId === directKey)
        .map(([key]) => key);
      return matchingKeys.length === 1 ? matchingKeys[0] : directKey;
    }
    const identity = resolveMessageSendIdentity(data);
    const operationId = resolveMessageSendOperationId(data);
    if (!identity || !operationId) {
      return data.message_id.trim();
    }
    return `send:${createHash('sha256')
      .update(
        [
          identity.accountId,
          identity.chatId,
          identity.messageId,
          operationId,
        ].join('\0')
      )
      .digest('hex')}`;
  }

  private async isAlreadySent(
    accountId: string,
    messageId: string
  ): Promise<boolean> {
    try {
      return await this.messageStatusService.isMessageAlreadySentByMessageId(
        accountId,
        messageId
      );
    } catch {
      return false;
    }
  }

  private async claimMessageSend(
    envelope: IQueuedEnvelope,
    payload: IChatMessage,
    connectionScope: IWhatsappRuntimeFence
  ): Promise<MessageSendClaimResult | null> {
    if (!this.payloadMatchesRuntime(payload)) {
      return null;
    }
    const operationId = resolveMessageSendOperationId(payload);
    const identity = resolveMessageSendIdentity(payload);
    if (!identity || !operationId) {
      return null;
    }

    payload.hash = identity.hash;

    return this.messageSendIdempotencyService.claimOperation({
      accountId: identity.accountId,
      operationType: 'direct',
      operationId,
      meta: {
        provider: this.PROVIDER,
        account_id: identity.accountId,
        chat_id: identity.chatId,
        message_id: identity.messageId,
        worker_id: baileysEnvironment.baileysWorkerId,
        source_topic: envelope.sourceTopic,
        source_partition: envelope.partition,
        source_offset: envelope.offset,
        runtime_generation: connectionScope.runtime_generation,
        connection_epoch: connectionScope.connection_epoch,
        consumer_assignment_epoch: envelope.consumerAssignmentEpoch,
      },
      runtimeFenceKey: WhatsappRuntimeFenceService.key(
        connectionScope.worker_id
      ),
      reservationLeaseMs: this.RESERVATION_LEASE_MS,
    });
  }

  private async markMessageAsFailedToSend(
    envelope: IQueuedEnvelope,
    payload: IChatMessage,
    recovery: MessageSendDurableTerminalRecovery = this.buildTerminalFailureRecovery(
      payload
    ),
    claim?: Extract<
      MessageSendClaimResult,
      { status: 'acquired' | 'duplicate' }
    >
  ): Promise<void> {
    let lastError: unknown = null;
    let eventId: string | undefined;

    for (
      let attempt = 1;
      attempt <= FAILURE_STATUS_PUBLISH_MAX_ATTEMPTS;
      attempt++
    ) {
      try {
        envelope.assertDispatchActive();
        const connectionScope =
          await this.captureEnvelopeConnectionScope(envelope);
        envelope.assertDispatchActive();
        const statusUpdate: IMessageStatusUpdate = {
          ...recovery.status_update,
          worker_id: connectionScope.worker_id,
          source_provider: connectionScope.source_provider,
          runtime_generation: connectionScope.runtime_generation,
          connection_epoch: connectionScope.connection_epoch,
        };
        eventId = ensureMessageStatusEventId(statusUpdate) ?? undefined;
        if (!eventId) {
          throw new Error('message_status_event_identity_missing');
        }
        const assertStatusPublishActive = async (): Promise<void> => {
          envelope.assertDispatchActive();
          await this.assertConnectionScopeActive(connectionScope);
          envelope.assertDispatchActive();
        };
        const topic = this.kafkaServiceQueueService.updateMessageStatus();
        const kafkaKey = MessageStatusService.statusKafkaKey(
          statusUpdate.account_id,
          statusUpdate.message_id,
          connectionScope.worker_id
        );
        await assertStatusPublishActive();
        await this.streamProducerService.send(
          topic,
          statusUpdate,
          kafkaKey,
          undefined,
          assertStatusPublishActive
        );
        await assertStatusPublishActive();
        if (claim) {
          await this.compactTerminalRecovery(
            claim,
            recovery.schema_version === 'message_send_ambiguous_terminal_v1'
              ? 'ambiguous'
              : 'failed',
            recovery
          );
        }
        return;
      } catch (error) {
        if (isKafkaConsumerDispatchRevokedError(error)) {
          throw error;
        }
        lastError = error;
        if (attempt < FAILURE_STATUS_PUBLISH_MAX_ATTEMPTS) {
          await this.delay(
            FAILURE_STATUS_PUBLISH_RETRY_DELAYS_MS[attempt - 1] ?? 300
          );
        }
      }
    }

    console.error('[MessageSend] Failed to publish terminal status update:', {
      message_id: payload.message_id,
      event_id: eventId,
      attempts: FAILURE_STATUS_PUBLISH_MAX_ATTEMPTS,
      error: lastError,
    });
    throw new MessageUpdatePublishFailedError(lastError);
  }

  private buildTerminalFailureRecovery(
    payload: IChatMessage
  ): IMessageSendTerminalFailureRecovery {
    const operationId =
      resolveMessageSendOperationId(payload) ?? payload.message_id.trim();
    const statusUpdate: IMessageStatusUpdate = {
      account_id: baileysEnvironment.baileysAccountId,
      worker_id: baileysEnvironment.baileysWorkerId,
      source_provider: 'baileys',
      message_id: payload.message_id,
      internal_message_id: payload.message_id,
      terminal_failure_schema: 'message_send_terminal_failure_recovery_v1',
      patch: {},
      failed: true,
      key: this.buildTerminalFailureMessageKey(payload),
    };
    const eventId = buildMessageStatusEventId(statusUpdate);
    if (!eventId) {
      throw new Error('message_status_event_identity_missing');
    }
    statusUpdate.event_id = eventId;
    return {
      schema_version: 'message_send_terminal_failure_recovery_v1',
      provider: 'baileys',
      operation_id: operationId,
      outcome_digest: this.terminalFailureOutcomeDigest(
        operationId,
        statusUpdate
      ),
      status_update: statusUpdate,
    };
  }

  private normalizeTerminalFailureRecovery(
    result: unknown,
    payload: IChatMessage
  ): IMessageSendTerminalFailureRecovery | null {
    if (!result || typeof result !== 'object') {
      return null;
    }
    const recovery = result as Partial<IMessageSendTerminalFailureRecovery>;
    const statusUpdate = recovery.status_update;
    const expected = this.buildTerminalFailureRecovery(payload);
    if (
      recovery.schema_version !== 'message_send_terminal_failure_recovery_v1' ||
      recovery.provider !== 'baileys' ||
      recovery.operation_id !== expected.operation_id ||
      recovery.outcome_digest !== expected.outcome_digest ||
      !statusUpdate ||
      typeof statusUpdate !== 'object' ||
      statusUpdate.failed !== true ||
      statusUpdate.terminal_failure_schema !==
        'message_send_terminal_failure_recovery_v1' ||
      statusUpdate.internal_message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.account_id?.trim() !== baileysEnvironment.baileysAccountId ||
      statusUpdate.worker_id?.trim() !== baileysEnvironment.baileysWorkerId ||
      statusUpdate.source_provider !== 'baileys' ||
      statusUpdate.event_id?.trim() !==
        expected.status_update.event_id?.trim() ||
      Object.keys(statusUpdate.patch ?? {}).length !== 0
    ) {
      return null;
    }

    return recovery as IMessageSendTerminalFailureRecovery;
  }

  private terminalFailureOutcomeDigest(
    operationId: string,
    statusUpdate: IMessageStatusUpdate
  ): string {
    return createHash('sha256')
      .update(
        [
          'message_send_terminal_failure_recovery_v1',
          'baileys',
          operationId.trim(),
          statusUpdate.event_id?.trim() ?? '',
          statusUpdate.account_id.trim(),
          statusUpdate.worker_id?.trim() ?? '',
          statusUpdate.message_id.trim(),
          statusUpdate.internal_message_id?.trim() ?? '',
        ].join('\0')
      )
      .digest('hex');
  }

  private buildAmbiguousTerminalRecovery(
    payload: IChatMessage
  ): IMessageSendAmbiguousTerminalRecovery {
    const operationId =
      resolveMessageSendOperationId(payload) ?? payload.message_id.trim();
    const statusUpdate: IMessageStatusUpdate = {
      account_id: baileysEnvironment.baileysAccountId,
      worker_id: baileysEnvironment.baileysWorkerId,
      source_provider: 'baileys',
      message_id: payload.message_id,
      internal_message_id: payload.message_id,
      terminal_failure_schema: 'message_send_ambiguous_terminal_v1',
      patch: {},
      failed: true,
      ambiguous: true,
      key: this.buildTerminalFailureMessageKey(payload),
    };
    const eventId = buildMessageStatusEventId(statusUpdate);
    if (!eventId) {
      throw new Error('message_status_event_identity_missing');
    }
    statusUpdate.event_id = eventId;
    return {
      schema_version: 'message_send_ambiguous_terminal_v1',
      provider: 'baileys',
      operation_id: operationId,
      outcome_digest: createHash('sha256')
        .update(
          [
            'message_send_ambiguous_terminal_v1',
            'baileys',
            operationId.trim(),
            eventId,
            statusUpdate.account_id,
            statusUpdate.worker_id ?? '',
            statusUpdate.message_id,
            statusUpdate.internal_message_id ?? '',
          ].join('\0')
        )
        .digest('hex'),
      status_update: statusUpdate,
    };
  }

  private normalizeAmbiguousTerminalRecovery(
    result: unknown,
    payload: IChatMessage
  ): IMessageSendAmbiguousTerminalRecovery | null {
    if (!result || typeof result !== 'object') {
      return null;
    }
    const recovery = result as Partial<IMessageSendAmbiguousTerminalRecovery>;
    const statusUpdate = recovery.status_update;
    const expected = this.buildAmbiguousTerminalRecovery(payload);
    if (
      recovery.schema_version !== 'message_send_ambiguous_terminal_v1' ||
      recovery.provider !== 'baileys' ||
      recovery.operation_id !== expected.operation_id ||
      recovery.outcome_digest !== expected.outcome_digest ||
      !statusUpdate ||
      typeof statusUpdate !== 'object' ||
      statusUpdate.failed !== true ||
      statusUpdate.ambiguous !== true ||
      statusUpdate.terminal_failure_schema !==
        'message_send_ambiguous_terminal_v1' ||
      statusUpdate.internal_message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.account_id?.trim() !== baileysEnvironment.baileysAccountId ||
      statusUpdate.worker_id?.trim() !== baileysEnvironment.baileysWorkerId ||
      statusUpdate.source_provider !== 'baileys' ||
      statusUpdate.event_id?.trim() !==
        expected.status_update.event_id?.trim() ||
      Object.keys(statusUpdate.patch ?? {}).length !== 0
    ) {
      return null;
    }
    return recovery as IMessageSendAmbiguousTerminalRecovery;
  }

  private payloadMatchesRuntime(payload: IChatMessage): boolean {
    return (
      payload.account?.id?.trim() === baileysEnvironment.baileysAccountId &&
      payload.worker?.id?.trim() === baileysEnvironment.baileysWorkerId
    );
  }

  private async persistTerminalFailureRecovery(
    claim: IMessageSendAcquiredClaim,
    payload: IChatMessage,
    envelope: IQueuedEnvelope,
    error: unknown
  ): Promise<IMessageSendTerminalFailureRecovery> {
    const recovery = this.buildTerminalFailureRecovery(payload);
    let transition: Awaited<
      ReturnType<MessageSendIdempotencyService['markFailed']>
    >;
    try {
      envelope.assertDispatchActive();
      transition = await this.messageSendIdempotencyService.markFailed(
        claim,
        error,
        recovery
      );
      envelope.assertDispatchActive();
    } catch (transitionError) {
      if (isKafkaConsumerDispatchRevokedError(transitionError)) {
        throw transitionError;
      }
      throw new MessageUpdatePublishFailedError(transitionError);
    }
    if (transition !== 'transitioned') {
      throw new MessageUpdatePublishFailedError(
        new Error(`message_send_idempotency_failed_${transition}`)
      );
    }
    return recovery;
  }

  private buildTerminalFailureMessageKey(payload: IChatMessage): WAMessageKey {
    return {
      id: payload.message_key?.id ?? undefined,
      remoteJid:
        payload.message_key?.remote_jid ?? payload.chat_id ?? undefined,
      fromMe: payload.message_key?.from_me ?? true,
      participant: payload.message_key?.participant ?? undefined,
    };
  }

  public async handleJetStreamCommand(input: {
    commandId: string;
    operationId: string;
    entityKey: string;
    entitySequence: number;
    payload: unknown;
    assertActive: () => void;
  }): Promise<void> {
    const payload = this.parseRawMessage(JSON.stringify(input.payload));
    if (!payload) {
      throw this.nonRetryableError('worker_command_payload_invalid');
    }
    bindMessageSendOperationId(payload as object, input.operationId);
    const { chatId } = this.resolveQueueContext(payload);
    await this.processEnvelopeWithRetry({
      commandId: input.commandId,
      sourceTopic: 'UC_WORKER_COMMANDS_V1',
      partition: 0,
      offset: input.entitySequence,
      kafkaKey: input.entityKey,
      payload,
      queueKey: input.entityKey,
      chatId,
      assertDispatchActive: input.assertActive,
    });
  }

  private parseRawMessage(raw: string | null): unknown {
    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const record = parsed as Record<string, unknown>;
      if ('message_id' in record || 'chat_id' in record) {
        return isRuntimeSafeChatMessagePayload(parsed) ? parsed : null;
      }
      if ('worker_profile_status_id' in record) {
        if ('external_id' in record) {
          return this.isDeleteStatusMessage(parsed) ? parsed : null;
        }
        return this.isStatusMessage(parsed) ? parsed : null;
      }
      if ('worker_id' in record || 'account_id' in record) {
        return this.isProfileInfoMessage(parsed) ? parsed : null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private isDeleteStatusMessage(
    payload: unknown
  ): payload is IProfileStatusDeleteMessage {
    return isRuntimeSafeProfileStatusDeletePayload(payload);
  }

  private isStatusMessage(payload: unknown): payload is IProfileStatusMessage {
    return isRuntimeSafeProfileStatusPayload(payload);
  }

  private isProfileInfoMessage(
    payload: unknown
  ): payload is IProfileInfoMessage {
    return isRuntimeSafeProfileInfoPayload(payload);
  }

  private isSendMessage(payload: unknown): payload is IChatMessage {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }

    const message = payload as Record<string, unknown>;
    const account = message.account;
    const worker = message.worker;
    return (
      this.isNonEmptyRuntimeString(message.message_id) &&
      this.isNonEmptyRuntimeString(message.chat_id) &&
      !!account &&
      typeof account === 'object' &&
      !Array.isArray(account) &&
      this.isNonEmptyRuntimeString((account as Record<string, unknown>).id) &&
      (worker === undefined ||
        worker === null ||
        (typeof worker === 'object' &&
          !Array.isArray(worker) &&
          this.isNonEmptyRuntimeString((worker as Record<string, unknown>).id)))
    );
  }

  private isNonEmptyRuntimeString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private resolveChatId(data: IChatMessage): string | null {
    const chatId = data.chat_id ?? data.message_key?.remote_jid ?? data.phone;

    if (!chatId) {
      return null;
    }

    return String(chatId);
  }

  private resolveQueueContext(payload: unknown): {
    queueKey: string;
    chatId: string | null;
  };
  private resolveQueueContext(payload: unknown): {
    queueKey: string;
    chatId: string | null;
  } {
    if (this.isSendMessage(payload)) {
      const chatId = this.resolveChatId(payload);
      if (chatId) {
        const accountId =
          payload.account?.id?.trim() || baileysEnvironment.baileysAccountId;
        return {
          queueKey: buildMessageSendQueueKey(accountId, chatId),
          chatId,
        };
      }
    }

    if (this.isDeleteStatusMessage(payload)) {
      const id = payload.external_id || payload.worker_profile_status_id;
      return {
        queueKey: `profile_status_delete:${id}`,
        chatId: null,
      };
    }

    if (this.isStatusMessage(payload)) {
      return {
        queueKey: `profile_status:${payload.worker_profile_status_id}`,
        chatId: null,
      };
    }

    if (this.isProfileInfoMessage(payload)) {
      return {
        queueKey: `profile_info:${payload.worker_id}:${payload.account_id}`,
        chatId: null,
      };
    }

    return {
      queueKey: this.SYSTEM_QUEUE_KEY,
      chatId: null,
    };
  }

  private async processEnvelopeWithRetry(
    envelope: IQueuedEnvelope
  ): Promise<void> {
    let lastError: unknown = null;
    const isSendPayload = this.isSendMessage(envelope.payload);
    const maxAttempts = isSendPayload ? 1 : this.MAX_PROCESS_ATTEMPTS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.processPayload(envelope.payload, envelope);
        return;
      } catch (error) {
        lastError = error;
        if (
          isMessageUpdatePublishFailedError(error) ||
          isKafkaConsumerDispatchRevokedError(error)
        ) {
          throw error;
        }
        if (isMessageDeliveryConfirmationFailedError(error)) {
          await this.routeFailedMessage(
            envelope,
            error,
            'delivery_unconfirmed'
          );
          return;
        }

        if (isSendPayload) {
          await this.routeFailedMessage(envelope, error, 'processing_failed');
          return;
        }

        if (this.resolveTerminalReason(error)) {
          await this.routeFailedMessage(envelope, error, 'processing_failed');
          return;
        }

        const isLastAttempt = attempt === maxAttempts;

        if (!isLastAttempt) {
          await this.delay(this.calculateRetryDelayMs(attempt));
        }
      }
    }

    await this.routeFailedMessage(envelope, lastError, 'processing_failed');
  }

  private async processPayload(
    payload: unknown,
    envelope: IQueuedEnvelope
  ): Promise<void> {
    if (this.isDeleteStatusMessage(payload)) {
      await this.processProviderCommandWithIdempotency(
        payload,
        envelope,
        (beforeProviderInvoke) =>
          this.processDeleteStatus(payload, beforeProviderInvoke)
      );
      return;
    }

    if (this.isStatusMessage(payload)) {
      if (this.isSupportedProfileStatus(payload)) {
        await this.processProviderCommandWithIdempotency(
          payload,
          envelope,
          (beforeProviderInvoke) =>
            this.processProfileStatus(payload, beforeProviderInvoke)
        );
      }
      return;
    }

    if (this.isProfileInfoMessage(payload)) {
      if (
        payload.name !== undefined ||
        payload.message !== undefined ||
        payload.photo !== undefined
      ) {
        await this.processProfileInfo(payload, envelope);
      }
      return;
    }

    if (this.isSendMessage(payload)) {
      const chatId = this.resolveChatId(payload);
      if (!chatId) {
        console.warn(
          '[MessageSend] Send payload without chatId. Message skipped.'
        );
        return;
      }

      const connectionScope =
        await this.captureEnvelopeConnectionScope(envelope);
      const claim = await this.claimMessageSend(
        envelope,
        payload,
        connectionScope
      );
      if (!claim) {
        throw this.nonRetryableError(
          'message_send_idempotency_identity_invalid'
        );
      }
      if (claim.status === 'error') {
        if (claim.reason === 'identity_conflict') {
          await this.markMessageAsFailedToSend(envelope, payload);
          console.error(
            '[MessageSend] Conflicting immutable idempotency identity rejected',
            {
              account_id: payload.account?.id,
              worker_id: payload.worker?.id,
              chat_id: payload.chat_id,
              message_id: payload.message_id,
            }
          );
          return;
        }
        throw new MessageUpdatePublishFailedError(
          new Error('message_send_idempotency_error')
        );
      }

      if (claim.status === 'duplicate') {
        if (claim.compacted) {
          return;
        }
        if (claim.state === 'succeeded') {
          const projectionPublished = this.hasMessageUpdateRecovery(
            claim.result
          );
          await this.recoverSucceededUpdate(
            claim.result,
            payload,
            envelope.assertDispatchActive
          );
          if (projectionPublished) {
            await this.compactTerminalRecovery(
              claim,
              'succeeded',
              claim.result
            );
          }
        } else if (claim.state === 'failed') {
          const recovery = this.normalizeTerminalFailureRecovery(
            claim.result,
            payload
          );
          if (!recovery) {
            throw new MessageUpdatePublishFailedError(
              new Error('message_send_terminal_failure_recovery_missing')
            );
          }
          await this.markMessageAsFailedToSend(
            envelope,
            payload,
            recovery,
            claim
          );
        } else if (claim.state === 'ambiguous') {
          const recovery = this.normalizeAmbiguousTerminalRecovery(
            claim.result,
            payload
          );
          if (!recovery) {
            throw new MessageUpdatePublishFailedError(
              new Error('message_send_ambiguous_terminal_recovery_missing')
            );
          }
          await this.markMessageAsFailedToSend(
            envelope,
            payload,
            recovery,
            claim
          );
        } else if (
          claim.state === 'reserved' ||
          claim.state === 'provider_invoked'
        ) {
          throw new MessageUpdatePublishFailedError(
            new Error(`message_send_idempotency_${claim.state}`)
          );
        }
        return;
      }

      const activeSendKey = this.activeSendKey(payload);
      const activeSendOwner = Symbol(activeSendKey);
      const activeSendOperationOwners = (this.activeSendOperationOwners ??=
        new Map<string, symbol>());
      activeSendOperationOwners.set(activeSendKey, activeSendOwner);
      this.activeSendClaims.set(activeSendKey, claim);
      this.activeSendDispatchGuards?.set(
        activeSendKey,
        envelope.assertDispatchActive
      );
      this.activeSendConnectionScopes?.set(activeSendKey, connectionScope);
      this.activeSendPreProviderDeadlines?.set(
        activeSendKey,
        Date.now() + this.PRE_PROVIDER_TIMEOUT_MS
      );
      try {
        await this.processMessageWithPreProviderDeadline(
          payload,
          activeSendKey
        );
        if (!this.providerInvokedSendClaims.has(activeSendKey)) {
          await this.messageSendIdempotencyService
            .releaseReservation(claim)
            .catch(() => undefined);
          return;
        }
        if (this.activeSendClaims.get(activeSendKey) === claim) {
          const noUpdateRequired = buildMessageSendNoUpdateRequiredResult(
            payload,
            this.PROVIDER,
            baileysEnvironment.baileysWorkerId
          );
          if (!noUpdateRequired) {
            throw new Error('message_send_succeeded_recovery_missing');
          }
          const succeeded =
            await this.messageSendIdempotencyService.markSucceeded(
              claim,
              noUpdateRequired
            );
          if (succeeded !== 'transitioned') {
            throw new Error(`message_send_idempotency_${succeeded}`);
          }
        }
      } catch (error) {
        if (isMessageUpdatePublishFailedError(error)) {
          if (
            !this.providerInvokedSendClaims.has(activeSendKey) &&
            !this.isProviderInvocationTransitionUncertain(error.originalCause)
          ) {
            await this.messageSendIdempotencyService
              .releaseReservation(claim)
              .catch(() => undefined);
            this.clearEnvelopeConnectionScope(envelope);
          }
          throw error;
        }
        if (this.providerInvokedSendClaims.has(activeSendKey)) {
          if (this.activeSendClaims.get(activeSendKey) !== claim) {
            // `pushUpdate` durably stored the provider result before its
            // Kafka publication fence failed. Force replay from `succeeded`;
            // never downgrade that known result to ambiguous.
            throw new MessageUpdatePublishFailedError(error);
          }
          const recovery = this.buildAmbiguousTerminalRecovery(payload);
          await this.terminalizeProviderInvokedFailure(claim, error, recovery);
          if (isKafkaConsumerDispatchRevokedError(error)) {
            throw error;
          }
          await this.markMessageAsFailedToSend(
            envelope,
            payload,
            recovery,
            claim
          );
          return;
        }
        if (isKafkaConsumerDispatchRevokedError(error)) {
          await this.messageSendIdempotencyService
            .releaseReservation(claim)
            .catch(() => undefined);
          this.clearEnvelopeConnectionScope(envelope);
          throw error;
        }
        if (this.isProviderInvocationTransitionUncertain(error)) {
          throw new MessageUpdatePublishFailedError(error);
        }
        if (!this.isPermanentPreProviderFailure(error)) {
          if (!(
            error instanceof Error &&
            error.message === 'message_send_pre_provider_timeout'
          )) {
            await this.messageSendIdempotencyService
              .releaseReservation(claim)
              .catch(() => undefined);
          }
          this.clearEnvelopeConnectionScope(envelope);
          throw new MessageUpdatePublishFailedError(error);
        }
        await this.persistTerminalFailureRecovery(
          claim,
          payload,
          envelope,
          error
        );
        throw error;
      } finally {
        // `pushUpdate` removes the claim immediately after the durable
        // succeeded CAS, so claim presence cannot own cleanup. A per-operation
        // token prevents an older finally block from deleting a newer send
        // that happens to reuse the same logical key.
        if (activeSendOperationOwners.get(activeSendKey) === activeSendOwner) {
          activeSendOperationOwners.delete(activeSendKey);
          if (this.activeSendClaims.get(activeSendKey) === claim) {
            this.activeSendClaims.delete(activeSendKey);
          }
          this.providerInvokedSendClaims.delete(activeSendKey);
          this.activeSendDispatchGuards?.delete(activeSendKey);
          this.activeSendConnectionScopes?.delete(activeSendKey);
          this.activeSendPreProviderDeadlines?.delete(activeSendKey);
          this.activeSendProviderStartedResolvers?.delete(activeSendKey);
        }
      }
      return;
    }

    console.warn('[MessageSend] Unsupported payload type. Message skipped.');
  }

  private isSupportedProfileStatus(data: IProfileStatusMessage): boolean {
    return (
      data.worker_profile_status_type_id === EWorkerProfileStatusType.text ||
      data.worker_profile_status_type_id === EWorkerProfileStatusType.image ||
      data.worker_profile_status_type_id === EWorkerProfileStatusType.video ||
      data.worker_profile_status_type_id === EWorkerProfileStatusType.audio
    );
  }

  private async processProviderCommandWithIdempotency(
    payload: { account_id: string; worker_id: string },
    envelope: IQueuedEnvelope,
    action: (
      beforeProviderInvoke: () => Promise<void>
    ) => Promise<ProviderCommandAfterDurableSuccess | void>,
    suboperation?: string
  ): Promise<void> {
    const accountId = payload.account_id?.trim();
    if (!accountId) {
      throw this.nonRetryableError('message_send_idempotency_account_missing');
    }
    if (
      accountId !== baileysEnvironment.baileysAccountId ||
      payload.worker_id?.trim() !== baileysEnvironment.baileysWorkerId
    ) {
      throw this.nonRetryableError('message_send_payload_scope_mismatch');
    }
    const operationIdentity = envelope.commandId
      ? ['worker-command', envelope.commandId]
      : [
          'worker-command',
          envelope.sourceTopic,
          String(envelope.partition),
          String(envelope.offset),
        ];
    const normalizedSuboperation = suboperation?.trim();
    if (normalizedSuboperation) {
      operationIdentity.push(normalizedSuboperation);
    }
    const operationId = operationIdentity.join('\0');
    const connectionScope = await this.captureEnvelopeConnectionScope(envelope);
    const assertPublisherActive = async (): Promise<void> => {
      envelope.assertDispatchActive();
      await this.assertConnectionScopeActive(connectionScope);
      envelope.assertDispatchActive();
    };
    const claim = await this.messageSendIdempotencyService.claimOperation({
      accountId,
      operationType: 'direct',
      operationId,
      meta: {
        provider: this.PROVIDER,
        worker_id: payload.worker_id,
        ...(envelope.commandId ? { command_id: envelope.commandId } : {}),
        source_topic: envelope.sourceTopic,
        source_partition: envelope.partition,
        source_offset: envelope.offset,
        ...(normalizedSuboperation
          ? { suboperation: normalizedSuboperation }
          : {}),
        runtime_generation: connectionScope.runtime_generation,
        connection_epoch: connectionScope.connection_epoch,
        consumer_assignment_epoch: envelope.consumerAssignmentEpoch,
      },
      runtimeFenceKey: WhatsappRuntimeFenceService.key(
        connectionScope.worker_id
      ),
    });
    if (claim.status === 'error') {
      if (claim.reason === 'identity_conflict') {
        console.error(
          '[MessageSend] Conflicting provider-command idempotency identity rejected',
          {
            account_id: accountId,
            worker_id: payload.worker_id,
            source_topic: envelope.sourceTopic,
            source_partition: envelope.partition,
            source_offset: envelope.offset,
          }
        );
        return;
      }
      throw new MessageUpdatePublishFailedError(
        new Error(`message_send_idempotency_${claim.reason}`)
      );
    }
    if (claim.status === 'duplicate') {
      if (claim.compacted) {
        return;
      }
      if (claim.state === 'reserved' || claim.state === 'provider_invoked') {
        throw new MessageUpdatePublishFailedError(
          new Error(`message_send_idempotency_${claim.state}`)
        );
      }
      if (claim.state === 'succeeded') {
        const projectionPublished = this.hasProfileStatusRecovery(
          claim.result,
          payload
        );
        await this.recoverSucceededProviderCommandAuxiliary(
          claim.result,
          payload,
          assertPublisherActive
        );
        if (projectionPublished) {
          await this.compactTerminalRecovery(claim, 'succeeded', claim.result);
        }
      }
      return;
    }
    let providerInvoked = false;
    let providerStartRejected: unknown | null = null;
    const beforeProviderInvoke = async (): Promise<void> => {
      if (providerStartRejected !== null) {
        throw providerStartRejected;
      }
      if (providerInvoked) {
        return;
      }
      await assertPublisherActive();
      let invoked: Awaited<
        ReturnType<MessageSendIdempotencyService['markProviderInvoked']>
      >;
      try {
        invoked = await this.messageSendIdempotencyService.markProviderInvoked(
          claim,
          undefined,
          this.PROVIDER_INVOCATION_LEASE_MS ??
            MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS
        );
      } catch (error) {
        throw this.providerInvocationTransitionUncertainError(
          error instanceof Error
            ? `message_send_idempotency_provider_invoked_uncertain:${error.message}`
            : 'message_send_idempotency_provider_invoked_uncertain'
        );
      }
      if (invoked !== 'transitioned') {
        throw this.providerInvocationTransitionUncertainError(
          `message_send_idempotency_${invoked}`
        );
      }
      providerInvoked = true;
      try {
        // No asynchronous work is permitted between the durable transition
        // and the provider invocation. The helper performs one final
        // synchronous provider/socket assertion before starting the SDK call.
        envelope.assertDispatchActive();
      } catch (error) {
        providerStartRejected = error;
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
        providerInvoked = false;
        throw error;
      }
    };
    beforeProviderInvoke.assertActive = envelope.assertDispatchActive;
    beforeProviderInvoke.onStartRejected = async (
      error: unknown
    ): Promise<void> => {
      if (!providerInvoked) {
        return;
      }
      providerStartRejected = error;
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
      providerInvoked = false;
    };

    let afterDurableSuccess: ProviderCommandAfterDurableSuccess | void;
    try {
      afterDurableSuccess = await action(beforeProviderInvoke);
      if (!providerInvoked) {
        await this.messageSendIdempotencyService
          .releaseReservation(claim)
          .catch(() => undefined);
        return;
      }
      const succeeded = afterDurableSuccess?.recovery
        ? await this.messageSendIdempotencyService.markSucceeded(
            claim,
            afterDurableSuccess.recovery
          )
        : await this.messageSendIdempotencyService.markSucceeded(claim);
      if (succeeded !== 'transitioned') {
        throw new Error(`message_send_idempotency_${succeeded}`);
      }
    } catch (error) {
      if (providerInvoked) {
        await this.terminalizeProviderInvokedFailure(claim, error);
        if (isKafkaConsumerDispatchRevokedError(error)) {
          throw error;
        }
        return;
      }
      if (this.isProviderInvocationTransitionUncertain(error)) {
        throw new MessageUpdatePublishFailedError(error);
      }
      await this.messageSendIdempotencyService
        .releaseReservation(claim)
        .catch(() => undefined);
      if (
        !isKafkaConsumerDispatchRevokedError(error) &&
        !isMessageUpdatePublishFailedError(error) &&
        !this.isProviderInvocationTransitionUncertain(error) &&
        !this.isPermanentPreProviderFailure(error)
      ) {
        this.clearEnvelopeConnectionScope(envelope);
        throw new MessageUpdatePublishFailedError(error);
      }
      throw error;
    }

    if (afterDurableSuccess) {
      try {
        await afterDurableSuccess(assertPublisherActive);
        if (afterDurableSuccess.recovery) {
          await this.compactTerminalRecovery(
            claim,
            'succeeded',
            afterDurableSuccess.recovery
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
    }
  }

  private async recoverSucceededProviderCommandAuxiliary(
    result: unknown,
    payload: { account_id: string; worker_id: string },
    assertPublisherActive: () => Promise<void>
  ): Promise<void> {
    if (!result || typeof result !== 'object') {
      return;
    }
    const candidate = result as Partial<IProfileStatusExternalIdRecovery>;
    if (candidate.schema_version !== 'profile_status_external_id_recovery_v1') {
      return;
    }
    if (
      typeof candidate.external_id !== 'string' ||
      !('worker_profile_status_id' in payload) ||
      typeof payload.worker_profile_status_id !== 'string'
    ) {
      console.error(
        '[MessageSend] Invalid succeeded profile-status auxiliary recovery discarded'
      );
      return;
    }
    const recovery = normalizeProfileStatusExternalIdRecovery(result, {
      provider: this.PROVIDER,
      accountId: payload.account_id,
      workerId: payload.worker_id,
      workerProfileStatusId: payload.worker_profile_status_id,
      externalId: candidate.external_id,
    });
    if (!recovery) {
      console.error(
        '[MessageSend] Conflicting succeeded profile-status auxiliary recovery discarded'
      );
      return;
    }
    await this.sendExternalIdUpdate(recovery, assertPublisherActive);
  }

  private async terminalizeProviderInvokedFailure(
    claim: IMessageSendAcquiredClaim,
    error: unknown,
    recovery?: IMessageSendAmbiguousTerminalRecovery
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

  private hasMessageUpdateRecovery(result: unknown): boolean {
    return Boolean(
      result &&
      typeof result === 'object' &&
      (result as { update_message?: unknown }).update_message &&
      typeof (result as { update_message?: unknown }).update_message ===
        'object'
    );
  }

  private hasProfileStatusRecovery(
    result: unknown,
    payload: { account_id: string; worker_id: string }
  ): boolean {
    if (!result || typeof result !== 'object') {
      return false;
    }
    const candidate = result as Partial<IProfileStatusExternalIdRecovery>;
    return Boolean(
      candidate.schema_version === 'profile_status_external_id_recovery_v1' &&
      typeof candidate.external_id === 'string' &&
      'worker_profile_status_id' in payload &&
      typeof payload.worker_profile_status_id === 'string' &&
      normalizeProfileStatusExternalIdRecovery(result, {
        provider: this.PROVIDER,
        accountId: payload.account_id,
        workerId: payload.worker_id,
        workerProfileStatusId: payload.worker_profile_status_id,
        externalId: candidate.external_id,
      })
    );
  }

  private calculateRetryDelayMs(attempt: number): number {
    const exponentialDelay = Math.min(
      this.RETRY_MAX_MS,
      this.RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
    );
    const jitter = Math.floor(exponentialDelay * 0.2 * this.randomFraction());
    return exponentialDelay + jitter;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private randomFraction(): number {
    const array = new Uint32Array(1);
    webcrypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
  }

  private nonRetryableError(message: string): INonRetryableError {
    const error = new Error(message) as INonRetryableError;
    Object.defineProperty(error, 'nonRetryable', {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return error;
  }

  private resolveTerminalReason(error: unknown): string | null {
    if (
      error instanceof Error &&
      (error as Partial<INonRetryableError>).nonRetryable === true
    ) {
      return error.message;
    }

    return null;
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
      message === 'message_send_idempotency_account_missing' ||
      message === 'message_send_payload_scope_mismatch' ||
      message === 'message_send_idempotency_identity_invalid' ||
      message === 'message_send_handler_unavailable' ||
      message === 'Received message without remoteJid' ||
      message === 'Received message without chatId' ||
      message === 'Failed to resolve forward fallback handler' ||
      message === 'Document URL is required' ||
      message === 'Video URL is required' ||
      message === 'Audio URL is required' ||
      message === 'Image URL is required' ||
      message === 'Sticker URL is required' ||
      message === 'Contact data is required' ||
      message === 'Contacts data is required' ||
      message === 'Location coordinates are required' ||
      message === 'Message edit is not allowed for non-own message' ||
      message.startsWith('Number not found on WhatsApp:')
    );
  }

  private providerInvocationTransitionUncertainError(
    message: string
  ): IProviderInvocationTransitionUncertainError {
    const error = new Error(
      message
    ) as IProviderInvocationTransitionUncertainError;
    Object.defineProperty(error, 'providerInvocationTransitionUncertain', {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return error;
  }

  private isProviderInvocationTransitionUncertain(
    error: unknown
  ): error is IProviderInvocationTransitionUncertainError {
    return (
      error instanceof Error &&
      (error as Partial<IProviderInvocationTransitionUncertainError>)
        .providerInvocationTransitionUncertain === true
    );
  }

  private clearEnvelopeConnectionScope(envelope: IQueuedEnvelope): void {
    envelope.connectionScope = null;
    envelope.connectionScopeCaptured = false;
  }

  private connectionScopesMatch(
    expected: IWhatsappRuntimeFence,
    current: IWhatsappRuntimeFence | null
  ): boolean {
    return (
      current !== null &&
      current.worker_id === expected.worker_id &&
      current.runtime_generation === expected.runtime_generation &&
      current.connection_epoch === expected.connection_epoch &&
      current.source_provider === expected.source_provider
    );
  }

  private async captureEnvelopeConnectionScope(
    envelope: IQueuedEnvelope
  ): Promise<IWhatsappRuntimeFence> {
    if (!envelope.connectionScopeCaptured) {
      try {
        envelope.connectionScope =
          await this.baileysIncomingMessageService.captureActiveConnectionScope();
      } catch (error) {
        this.clearEnvelopeConnectionScope(envelope);
        if (isKafkaConsumerDispatchRevokedError(error)) {
          throw error;
        }
        throw isMessageUpdatePublishFailedError(error)
          ? error
          : new MessageUpdatePublishFailedError(error);
      }
      envelope.connectionScopeCaptured = true;
    }

    const scope = envelope.connectionScope ?? null;
    if (
      !scope ||
      scope.worker_id !== baileysEnvironment.baileysWorkerId ||
      scope.source_provider !== this.PROVIDER
    ) {
      this.clearEnvelopeConnectionScope(envelope);
      throw new MessageUpdatePublishFailedError(
        new Error('whatsapp_connection_scope_unavailable_or_stale')
      );
    }

    return scope;
  }

  private async assertConnectionScopeActive(
    expected: IWhatsappRuntimeFence
  ): Promise<void> {
    const current =
      await this.baileysIncomingMessageService.captureActiveConnectionScope();
    if (!this.connectionScopesMatch(expected, current)) {
      throw this.nonRetryableError('whatsapp_connection_scope_revoked');
    }
  }

  private async routeFailedMessage(
    envelope: IQueuedEnvelope,
    error: unknown,
    failureEvent: 'delivery_unconfirmed' | 'processing_failed' | 'enqueue_error'
  ): Promise<void> {
    const messageId = this.extractMessageId(envelope.payload);
    const reason = messageId
      ? `${failureEvent}_terminal`
      : `${failureEvent}_missing_message_id`;

    if (!messageId) {
      this.logTerminalFailure(envelope, error, reason);
      return;
    }
    if (
      !this.isSendMessage(envelope.payload) ||
      !this.payloadMatchesRuntime(envelope.payload)
    ) {
      this.logTerminalFailure(
        envelope,
        error,
        `${failureEvent}_scope_mismatch`
      );
      return;
    }

    envelope.assertDispatchActive();
    const alreadySent = await this.isAlreadySent(
      baileysEnvironment.baileysAccountId,
      messageId
    );
    envelope.assertDispatchActive();
    if (alreadySent) {
      return;
    }

    await this.markMessageAsFailedToSend(
      envelope,
      envelope.payload as IChatMessage
    );
    this.logTerminalFailure(envelope, error, reason);
  }

  private logTerminalFailure(
    envelope: IQueuedEnvelope,
    error: unknown,
    reason: string
  ): void {
    console.error('[MessageSend] Discarding terminal send failure:', {
      provider: this.PROVIDER,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      source_topic: envelope.sourceTopic,
      partition: envelope.partition,
      offset: envelope.offset,
      kafka_key: envelope.kafkaKey,
      queue_key: envelope.queueKey,
      chat_id: envelope.chatId,
      message_id: this.extractMessageId(envelope.payload),
      error: this.errorMessage(error),
      reason,
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private getRandomDelay(): number {
    const array = new Uint32Array(1);
    webcrypto.getRandomValues(array);
    const randomValue = array[0] / (0xffffffff + 1);
    return Math.floor(randomValue * (2000 - 500 + 1)) + 500;
  }

  private async applyDelayIfNeeded(
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<void> {
    if (currentType && currentType === lastType) {
      const delay = this.getRandomDelay();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private async processMessageWithDelay(
    jid: string,
    chatId: string,
    data: IChatMessage,
    currentType: EMessageType,
    lastType: EMessageType | undefined,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await this.applyDelayIfNeeded(currentType, lastType);
    await processor(jid, data);
    this.lastMessageTypeByChatId.set(chatId, currentType);
  }

  private async processMediaMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    lastType: EMessageType | undefined,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await this.processMessageWithDelay(
      jid,
      chatId,
      data,
      type,
      lastType,
      processor
    );
  }

  private async processTextMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    hasQuoted: boolean
  ): Promise<void> {
    if (hasQuoted && data.content?.quoted) {
      await this.processTextQuoted(jid, data);
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return;
    }

    await this.processText(jid, data);
    this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
  }

  private async processActionMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await processor(jid, data);
    this.lastMessageTypeByChatId.set(chatId, type);
  }

  private createMediaHandler(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    lastType: EMessageType | undefined,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): () => Promise<void> {
    return () =>
      this.processMediaMessage(jid, chatId, data, type, lastType, processor);
  }

  private createActionHandler(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): () => Promise<void> {
    return () => this.processActionMessage(jid, chatId, data, type, processor);
  }

  private createMediaTypeHandler(
    url: string | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    lastType: EMessageType | undefined,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): (() => Promise<void>) | null {
    if (!url) return null;
    return this.createMediaHandler(
      jid,
      chatId,
      data,
      type,
      lastType,
      processor
    );
  }

  private createActionTypeHandler(
    condition: boolean | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    processor: (j: string, d: IChatMessage) => Promise<void>
  ): (() => Promise<void>) | null {
    if (!condition) return null;
    return this.createActionHandler(jid, chatId, data, type, processor);
  }

  private createTextMessageHandler(
    message: string | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    hasQuoted: boolean
  ): (() => Promise<void>) | null {
    if (!message) return null;
    return () => this.processTextMessage(jid, chatId, data, hasQuoted);
  }

  private selectMessageHandler(
    currentType: EMessageType | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    lastType: EMessageType | undefined,
    hasQuoted: boolean
  ): (() => Promise<void>) | null {
    if (!currentType) {
      return null;
    }

    const handlers: Partial<
      Record<EMessageType, (() => Promise<void>) | null>
    > = {
      [EMessageType.image]: this.createMediaTypeHandler(
        data.content?.image?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.image,
        lastType,
        (j, d) => this.processImage(j, d)
      ),
      [EMessageType.document]: this.createMediaTypeHandler(
        data.content?.document?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.document,
        lastType,
        (j, d) => this.processDocument(j, d)
      ),
      [EMessageType.audio]: this.createMediaTypeHandler(
        data.content?.audio?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.audio,
        lastType,
        (j, d) => this.processAudio(j, d)
      ),
      [EMessageType.video]: this.createMediaTypeHandler(
        data.content?.video?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.video,
        lastType,
        (j, d) => this.processVideo(j, d)
      ),
      [EMessageType.video_note]: this.createMediaTypeHandler(
        data.content?.video?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.video_note,
        lastType,
        (j, d) => this.processVideo(j, d)
      ),
      [EMessageType.sticker]: this.createMediaTypeHandler(
        data.content?.sticker?.url ?? undefined,
        jid,
        chatId,
        data,
        EMessageType.sticker,
        lastType,
        (j, d) => this.processSticker(j, d)
      ),
      [EMessageType.location]: this.createActionTypeHandler(
        !!data.content?.location,
        jid,
        chatId,
        data,
        EMessageType.location,
        (j, d) => this.processLocation(j, d)
      ),
      [EMessageType.text]: this.createTextMessageHandler(
        data.content?.message ?? undefined,
        jid,
        chatId,
        data,
        hasQuoted
      ),
      [EMessageType.system]: this.createTextMessageHandler(
        data.content?.message ?? undefined,
        jid,
        chatId,
        data,
        hasQuoted
      ),
      [EMessageType.contact_card]: this.createActionTypeHandler(
        !!data.content?.contact,
        jid,
        chatId,
        data,
        EMessageType.contact_card,
        (j, d) => this.processContact(j, d)
      ),
      [EMessageType.contacts]: this.createActionTypeHandler(
        !!data.content?.contacts?.length,
        jid,
        chatId,
        data,
        EMessageType.contacts,
        (j, d) => this.processContacts(j, d)
      ),
      [EMessageType.delete_message]: this.createActionTypeHandler(
        !!data.message_key?.id,
        jid,
        chatId,
        data,
        EMessageType.delete_message,
        (j, d) => this.processDelete(j, d)
      ),
      [EMessageType.react]: this.createActionTypeHandler(
        !!data.message_key?.id,
        jid,
        chatId,
        data,
        EMessageType.react,
        (j, d) => this.processReact(j, d)
      ),
    };

    return handlers[currentType] ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private hasForwardSourceKeyId(data: IChatMessage): boolean {
    return !!data.content?.forward?.source_message_key?.id?.trim();
  }

  private hasForwardSourceRemote(data: IChatMessage): boolean {
    const sourceKey = data.content?.forward?.source_message_key;
    if (sourceKey?.remote_jid?.trim() || sourceKey?.remote_jid_alt?.trim()) {
      return true;
    }

    const parsed = parseSerializedMessageId(sourceKey?.id ?? null);
    return !!parsed?.remoteJid?.trim();
  }

  private hasUsableForwardSourceKey(data: IChatMessage): boolean {
    return (
      this.hasForwardSourceKeyId(data) && this.hasForwardSourceRemote(data)
    );
  }

  private resolveMissingSourceReason(data: IChatMessage): ForwardFailReason {
    if (!this.hasForwardSourceKeyId(data)) {
      return 'missing_source_key';
    }

    return 'source_key_incomplete';
  }

  private mergeForwardSourceKey(
    data: IChatMessage,
    sourceKey: NonNullable<IChatMessage['message_key']>
  ): void {
    if (!data.content?.forward) {
      return;
    }

    const currentKey = data.content.forward.source_message_key ?? null;
    data.content.forward.source_message_key = {
      ...(currentKey ?? { is_view_once: false }),
      ...sourceKey,
      is_view_once:
        sourceKey.is_view_once ??
        currentKey?.is_view_once ??
        data.message_key?.is_view_once ??
        false,
    };
  }

  private async hydrateForwardSourceKey(data: IChatMessage): Promise<void> {
    if (this.hasUsableForwardSourceKey(data)) {
      return;
    }

    const accountId = data.account?.id?.trim();
    const sourceMessageId = data.content?.forward?.source_message_id?.trim();
    if (!accountId || !sourceMessageId) {
      return;
    }

    const deadline = Date.now() + this.FORWARD_SOURCE_KEY_MAX_WAIT_MS;
    while (Date.now() <= deadline) {
      const sourceKey =
        await this.messageKeyLookupService.getMessageKeyByMessageId(
          accountId,
          sourceMessageId
        );

      if (sourceKey) {
        this.mergeForwardSourceKey(
          data,
          sourceKey as NonNullable<IChatMessage['message_key']>
        );
      }

      if (this.hasUsableForwardSourceKey(data)) {
        return;
      }

      if (Date.now() >= deadline) {
        return;
      }

      await this.sleep(this.FORWARD_SOURCE_KEY_POLL_INTERVAL_MS);
    }
  }

  private logForwardResult(
    data: IChatMessage,
    path: 'native' | 'fallback',
    result: 'success' | 'failed',
    options?: {
      reason?: ForwardFailReason;
      error?: unknown;
      nativeResolution?: 'cache';
    }
  ): void {
    console.info('[MessageSend] Forward processed', {
      source_message_id: data.content?.forward?.source_message_id ?? null,
      target_chat_id: data.chat_id,
      provider: 'baileys',
      path,
      result,
      reason: options?.reason,
      native_resolution: options?.nativeResolution,
      error:
        options?.error instanceof Error
          ? options.error.message
          : typeof options?.error === 'string'
            ? options.error
            : undefined,
    });
  }

  private buildJidAliases(jid: string): string[] {
    const normalized = normalizeJid(jid) ?? jid;
    const aliases = new Set<string>([normalized]);

    if (normalized.endsWith('@s.whatsapp.net')) {
      aliases.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
    }

    if (normalized.endsWith('@c.us')) {
      aliases.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
    }

    return Array.from(aliases);
  }

  private resolveForwardSourceKeys(data: IChatMessage): Array<{
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  }> {
    const sourceKey = data.content?.forward?.source_message_key;
    if (!sourceKey?.id) {
      return [];
    }

    const rawId = sourceKey.id.trim();
    if (!rawId) {
      return [];
    }

    const parsed = parseSerializedMessageId(rawId);
    const rawJids = [
      sourceKey.remote_jid,
      sourceKey.remote_jid_alt,
      parsed?.remoteJid,
    ].filter(
      (jid): jid is string => typeof jid === 'string' && jid.trim() !== ''
    );

    const jidCandidates = new Set<string>();
    for (const jid of rawJids) {
      for (const alias of this.buildJidAliases(jid)) {
        jidCandidates.add(alias);
      }
    }

    const uniqueKeys = new Map<
      string,
      { remoteJid: string; fromMe: boolean; id: string; participant?: string }
    >();
    for (const jidCandidate of jidCandidates) {
      const built = this.buildBaileysMessageKey(
        {
          remote_jid: jidCandidate,
          from_me: sourceKey.from_me ?? null,
          id: rawId,
          participant:
            sourceKey.participant ?? sourceKey.participant_alt ?? null,
        },
        jidCandidate
      );
      if (!built?.remoteJid) {
        continue;
      }

      const dedupeKey = `${built.remoteJid}:${built.fromMe}:${built.id}:${built.participant ?? ''}`;
      uniqueKeys.set(dedupeKey, built);
    }

    return Array.from(uniqueKeys.values());
  }

  private async tryNativeForward(
    jid: string,
    data: IChatMessage,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<{
    sent: boolean;
    reason?: ForwardFailReason;
    nativeResolution?: 'cache';
  }> {
    const sourceKeys = this.resolveForwardSourceKeys(data);
    if (sourceKeys.length === 0) {
      return {
        sent: false,
        reason: this.resolveMissingSourceReason(data),
      };
    }

    for (const sourceKey of sourceKeys) {
      const cachedMessage =
        await this.baileysIncomingMessageService.getCachedMessage(sourceKey);
      if (!cachedMessage) {
        continue;
      }

      const nativeForward = await this.baileysMessageTextService.forward(
        jid,
        {
          key: sourceKey,
          message: cachedMessage,
        },
        true,
        undefined,
        this.providerInvocationBoundary(data)
      );

      if (!nativeForward) {
        continue;
      }

      await this.pushUpdate({ message: nativeForward, data });
      if (currentType) {
        this.lastMessageTypeByChatId.set(chatId, currentType);
      }
      this.logForwardResult(data, 'native', 'success', {
        nativeResolution: 'cache',
      });
      return {
        sent: true,
        nativeResolution: 'cache',
      };
    }

    return {
      sent: false,
      reason: 'source_not_found_cache_or_store',
    };
  }

  private async processForwardMessage(
    currentType: EMessageType | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    lastType: EMessageType | undefined,
    hasQuoted: boolean
  ): Promise<boolean> {
    if (!data.content?.forward) {
      return false;
    }

    await this.hydrateForwardSourceKey(data);

    try {
      const nativeForwardResult = await this.tryNativeForward(
        jid,
        data,
        chatId,
        currentType
      );
      if (nativeForwardResult.sent) {
        return true;
      }
      this.logForwardResult(data, 'native', 'failed', {
        reason: nativeForwardResult.reason,
      });
    } catch (error) {
      if (
        isMessageUpdatePublishFailedError(error) ||
        this.providerInvokedSendClaims.has(this.activeSendKey(data)) ||
        this.isIdempotencyBoundaryError(error)
      ) {
        throw error;
      }
      this.logForwardResult(data, 'native', 'failed', {
        reason: 'native_forward_exception',
        error,
      });
    }

    const fallbackHandler = this.selectMessageHandler(
      currentType,
      jid,
      chatId,
      data,
      lastType,
      hasQuoted
    );

    if (!fallbackHandler) {
      this.logForwardResult(data, 'fallback', 'failed', {
        reason: 'fallback_handler_unavailable',
      });
      throw new Error('Failed to resolve forward fallback handler');
    }

    await fallbackHandler();
    this.logForwardResult(data, 'fallback', 'success');
    return true;
  }

  private isIdempotencyBoundaryError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.startsWith('message_send_idempotency_') ||
        (error as Partial<INonRetryableError>).nonRetryable === true)
    );
  }

  private async processMessageWithPreProviderDeadline(
    data: IChatMessage,
    activeSendKey: string
  ): Promise<void> {
    const configuredDeadline =
      this.activeSendPreProviderDeadlines?.get(activeSendKey);
    const deadlineAtMs =
      typeof configuredDeadline === 'number' &&
      Number.isFinite(configuredDeadline)
        ? configuredDeadline
        : Date.now() + 30_000;
    let resolveProviderStarted!: () => void;
    const providerStarted = new Promise<{ kind: 'provider_started' }>(
      (resolve) => {
        resolveProviderStarted = () => resolve({ kind: 'provider_started' });
      }
    );
    this.activeSendProviderStartedResolvers?.set(
      activeSendKey,
      resolveProviderStarted
    );
    const processing = Promise.resolve()
      .then(() => this.processMessage(data))
      .then(
        () => ({ kind: 'completed' }) as const,
        (error: unknown) => ({ kind: 'failed', error }) as const
      );
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<{ kind: 'deadline' }>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: 'deadline' }),
        Math.max(0, deadlineAtMs - Date.now())
      );
      timer.unref?.();
    });

    const outcome = await Promise.race([processing, providerStarted, deadline]);
    if (timer) {
      clearTimeout(timer);
    }
    if (
      this.activeSendProviderStartedResolvers?.get(activeSendKey) ===
      resolveProviderStarted
    ) {
      this.activeSendProviderStartedResolvers.delete(activeSendKey);
    }

    if (outcome.kind === 'provider_started') {
      const finalOutcome = await processing;
      if (finalOutcome.kind === 'failed') {
        throw finalOutcome.error;
      }
      return;
    }
    if (outcome.kind === 'deadline') {
      void processing.then(() => undefined);
      throw this.nonRetryableError('message_send_pre_provider_timeout');
    }
    if (outcome.kind === 'failed') {
      throw outcome.error;
    }
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const jid = selectJidChat(data);

    if (!jid) {
      throw new Error('Received message without remoteJid');
    }

    const chatId = this.resolveChatId(data);

    if (!chatId) {
      throw new Error('Received message without chatId');
    }

    const currentType = data?.content?.type;
    const lastType = this.lastMessageTypeByChatId.get(chatId);
    const hasQuoted = !!data.content?.quoted || data.has_quoted === true;

    if (data.content?.forward) {
      await this.processForwardMessage(
        currentType,
        jid,
        chatId,
        data,
        lastType,
        hasQuoted
      );
      return;
    }

    const handler = this.selectMessageHandler(
      currentType,
      jid,
      chatId,
      data,
      lastType,
      hasQuoted
    );

    if (!handler) {
      throw this.nonRetryableError('message_send_handler_unavailable');
    }
    await handler();
  }

  private async markActiveProviderInvoked(
    data: IChatMessage | string
  ): Promise<void> {
    await this.providerInvocationBoundary(data)();
  }

  private providerInvocationBoundary(
    data: IChatMessage | string
  ): IProviderInvocationBoundary {
    const activeSendKey = this.activeSendKey(data);
    const dispatchGuard =
      this.activeSendDispatchGuards?.get(activeSendKey) ?? null;
    const connectionScope =
      this.activeSendConnectionScopes?.get(activeSendKey) ?? null;
    const claim = this.activeSendClaims?.get(activeSendKey) ?? null;
    const deadlineAtMs =
      this.activeSendPreProviderDeadlines?.get(activeSendKey);
    const isRegistered = (): boolean => {
      if (this.activeSendDispatchGuards?.get(activeSendKey) !== dispatchGuard) {
        return false;
      }
      if (claim && this.activeSendClaims?.get(activeSendKey) !== claim) {
        return false;
      }
      if (
        connectionScope &&
        this.activeSendConnectionScopes?.get(activeSendKey) !== connectionScope
      ) {
        return false;
      }
      return (
        this.providerInvokedSendClaims?.has(activeSendKey) === true ||
        typeof deadlineAtMs !== 'number' ||
        !Number.isFinite(deadlineAtMs) ||
        Date.now() < deadlineAtMs
      );
    };
    const assertRegistered = (): void => {
      if (!dispatchGuard || !isRegistered()) {
        throw this.nonRetryableError(
          'whatsapp_connection_scope_active_send_missing'
        );
      }
      dispatchGuard();
    };
    const boundary = async (): Promise<void> => {
      assertRegistered();
      if (!connectionScope) {
        throw this.nonRetryableError(
          'whatsapp_connection_scope_active_send_missing'
        );
      }
      if (!claim) {
        throw new Error('message_send_idempotency_active_claim_missing');
      }
      await this.assertConnectionScopeActive(connectionScope);
      assertRegistered();
      if (!this.providerInvokedSendClaims.has(activeSendKey)) {
        const ambiguousRecovery =
          typeof data === 'string'
            ? undefined
            : this.buildAmbiguousTerminalRecovery(data);
        let invoked: Awaited<
          ReturnType<MessageSendIdempotencyService['markProviderInvoked']>
        >;
        try {
          invoked =
            await this.messageSendIdempotencyService.markProviderInvoked(
              claim,
              ambiguousRecovery,
              this.PROVIDER_INVOCATION_LEASE_MS ??
                MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS
            );
        } catch (error) {
          throw this.providerInvocationTransitionUncertainError(
            error instanceof Error
              ? `message_send_idempotency_provider_invoked_uncertain:${error.message}`
              : 'message_send_idempotency_provider_invoked_uncertain'
          );
        }
        if (invoked !== 'transitioned') {
          throw this.providerInvocationTransitionUncertainError(
            `message_send_idempotency_${invoked}`
          );
        }
        this.providerInvokedSendClaims.add(activeSendKey);
        try {
          // The CAS may complete after the deadline or assignment check that
          // preceded it. Only synchronous checks are allowed here; the helper
          // validates the exact provider/socket before starting the SDK call.
          assertRegistered();
          if (
            typeof deadlineAtMs === 'number' &&
            Number.isFinite(deadlineAtMs) &&
            Date.now() >= deadlineAtMs
          ) {
            throw this.nonRetryableError(
              'message_send_pre_provider_timeout_after_claim'
            );
          }
        } catch (error) {
          const reverted =
            await this.messageSendIdempotencyService.revertProviderInvocationBeforeStart(
              claim,
              this.RESERVATION_LEASE_MS
            );
          if (reverted !== 'transitioned') {
            throw new MessageUpdatePublishFailedError(
              new Error(
                `message_send_idempotency_provider_start_revert_${reverted}`
              )
            );
          }
          this.providerInvokedSendClaims.delete(activeSendKey);
          throw error;
        }
      }
      this.activeSendProviderStartedResolvers?.get(activeSendKey)?.();
    };
    boundary.assertActive = assertRegistered;
    boundary.onStartRejected = async (): Promise<void> => {
      if (!this.providerInvokedSendClaims.has(activeSendKey)) {
        return;
      }
      if (!claim) {
        throw new MessageUpdatePublishFailedError(
          new Error('message_send_idempotency_active_claim_missing')
        );
      }
      const reverted =
        await this.messageSendIdempotencyService.revertProviderInvocationBeforeStart(
          claim,
          this.RESERVATION_LEASE_MS
        );
      if (reverted !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(
            `message_send_idempotency_provider_start_revert_${reverted}`
          )
        );
      }
      this.providerInvokedSendClaims.delete(activeSendKey);
    };
    boundary.isActive = (): boolean => {
      try {
        assertRegistered();
        return true;
      } catch {
        return false;
      }
    };
    boundary.isRegistered = isRegistered;
    if (typeof deadlineAtMs === 'number' && Number.isFinite(deadlineAtMs)) {
      boundary.deadlineAtMs = deadlineAtMs;
    }
    return boundary;
  }

  private normalizeMessageKeyIdForBaileys(id?: string | null): string {
    if (!id) return '';
    const trimmed = id.trim();
    if (!trimmed) return '';

    const parsed = parseSerializedMessageId(trimmed);
    return parsed?.stanzaId ?? trimmed;
  }

  private resolveViewOnceFlag(...values: unknown[]): boolean {
    return values.some((value) => this.isTruthyViewOnce(value));
  }

  private buildOutgoingContextInfo(
    data: IChatMessage
  ): proto.IContextInfo | undefined {
    const rawContext = data.content?.context_info as
      Record<string, unknown> | null | undefined;
    if (!rawContext) {
      return undefined;
    }

    const rawForwardingScore =
      typeof rawContext.forwarding_score === 'number'
        ? rawContext.forwarding_score
        : typeof rawContext.forwardingScore === 'number'
          ? rawContext.forwardingScore
          : undefined;

    const rawIsForwarded =
      rawContext.is_forwarded === true || rawContext.isForwarded === true;

    if (!rawIsForwarded && rawForwardingScore === undefined) {
      return undefined;
    }

    const contextInfo: Record<string, unknown> = { ...rawContext };
    delete contextInfo.is_forwarded;
    delete contextInfo.forwarding_score;

    contextInfo.isForwarded = true;
    contextInfo.forwardingScore = Math.max(
      1,
      Math.floor(rawForwardingScore ?? 1)
    );

    return contextInfo as proto.IContextInfo;
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

  private buildBaileysMessageKey(
    key:
      | {
          remote_jid?: string | null;
          remote_jid_alt?: string | null;
          from_me?: boolean | null;
          id?: string | null;
          participant?: string | null;
          participant_alt?: string | null;
          addressing_mode?: string | null;
        }
      | undefined,
    fallbackRemoteJid = ''
  ): {
    remoteJid: string;
    remoteJidAlt?: string;
    fromMe: boolean;
    id: string;
    participant?: string;
    participantAlt?: string;
    addressingMode?: string;
  } | null {
    const rawId = key?.id?.trim();
    const parsed = parseSerializedMessageId(rawId);
    const normalizedId = this.normalizeMessageKeyIdForBaileys(rawId);
    if (!normalizedId) {
      return null;
    }

    const normalizedRemoteJid =
      normalizeJid(key?.remote_jid) ??
      normalizeJid(parsed?.remoteJid) ??
      normalizeJid(fallbackRemoteJid) ??
      fallbackRemoteJid;
    const normalizedRemoteJidAlt =
      normalizeJid(key?.remote_jid_alt) ?? key?.remote_jid_alt ?? undefined;
    const normalizedParticipant =
      normalizeJid(key?.participant) ?? key?.participant ?? undefined;
    const normalizedParticipantAlt =
      normalizeJid(key?.participant_alt) ?? key?.participant_alt ?? undefined;

    return {
      remoteJid: normalizedRemoteJid,
      remoteJidAlt: normalizedRemoteJidAlt,
      fromMe: key?.from_me ?? parsed?.fromMe ?? false,
      id: normalizedId,
      participant: normalizedParticipant,
      participantAlt: normalizedParticipantAlt,
      addressingMode: key?.addressing_mode ?? undefined,
    };
  }

  private async processDelete(jid: string, data: IChatMessage): Promise<void> {
    if (!data.message_key?.id) {
      return;
    }

    const messageKey = this.buildBaileysMessageKey(data.message_key, jid);
    if (!messageKey) return;

    await this.baileysMessageEditDeleteService.deleteMessage(
      jid,
      messageKey,
      undefined,
      this.providerInvocationBoundary(data)
    );
  }

  private async processDocument(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const document = data.content?.document;

    if (!document?.url) {
      throw new Error('Document URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendDocument(
      jid,
      {
        url: document.url,
        mimetype: document.mimetype ?? undefined,
        filename: document.name ?? undefined,
        filesize: document.size ?? undefined,
      },
      {
        mimetype: document.mimetype ?? 'application/octet-stream',
        fileName: document.name ?? undefined,
        filesize: document.size ?? undefined,
        caption: data.content?.message ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send document');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processVideo(jid: string, data: IChatMessage): Promise<void> {
    const video = data.content?.video;

    if (!video?.url) {
      throw new Error('Video URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendVideo(
      jid,
      {
        url: video.url,
        mimetype: video.mimetype ?? undefined,
        filename: video.name ?? undefined,
        filesize: video.size ?? undefined,
      },
      {
        caption: video.caption ?? data.content?.message ?? undefined,
        seconds: data.content?.video?.duration ?? undefined,
        mimetype: video.mimetype ?? undefined,
        fileName: video.name ?? undefined,
        filesize: video.size ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send video');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processAudio(jid: string, data: IChatMessage): Promise<void> {
    const audio = data.content?.audio;

    if (!audio?.url) {
      throw new Error('Audio URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const isViewOnce = this.resolveViewOnceFlag(
      data.message_key?.is_view_once,
      audio.view_once
    );
    const isPtt = isViewOnce ? true : (audio.ptt ?? true);

    let waveform: Uint8Array | undefined;
    if (isPtt && audio.waveform) {
      waveform = convertWaveformBase64ToUint8Array(audio.waveform);
    }

    const result = await this.baileysMessageMediaService.sendAudio(
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
        waveform,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send audio');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private readonly generateVCard = (contact: {
    name: string;
    last_name?: string | null;
    phone?: string | null;
    phone_ddi?: string | null;
    email?: string | null;
    email_partial?: string | null;
  }): string => {
    const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

    const fullName = [contact.name, contact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (fullName) {
      lines.push(`N:;${fullName};;;`, `FN:${fullName}`);
    }

    if (contact.phone) {
      let phone = contact.phone.replaceAll(/\D/g, '');
      const ddi = contact.phone_ddi
        ? contact.phone_ddi.replaceAll(/\D/g, '')
        : '';

      let phoneWithDdi = '';
      if (ddi && phone) {
        phoneWithDdi = `+${ddi}${phone}`;
      }
      if (!ddi && phone) {
        phoneWithDdi = `+${phone}`;
      }

      const phoneWithDdiWithoutPlus = phoneWithDdi.replace('+', '');

      if (phone) {
        lines.push(
          `TEL;type=CELL;type=VOICE;waid=${phoneWithDdiWithoutPlus}:${phoneWithDdi}`
        );
      }
    }

    if (contact.email) {
      lines.push(`EMAIL:${contact.email}`);
    }
    if (!contact.email && contact.email_partial) {
      lines.push(`EMAIL:${contact.email_partial}`);
    }

    lines.push('END:VCARD');
    return lines.join('\n');
  };

  private async processContact(jid: string, data: IChatMessage): Promise<void> {
    const contactData = data.content?.contact;

    if (!contactData) {
      throw new Error('Contact data is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const vcard = this.generateVCard(contactData);

    const displayName =
      `${contactData.name} ${contactData.last_name ?? ''}`.trim() || 'Contato';

    const result =
      await this.baileysMessageLocationContactService.sendContactCard(
        jid,
        vcard,
        displayName,
        this.buildOutgoingContextInfo(data),
        quotedMessage ? { quoted: quotedMessage } : undefined,
        this.providerInvocationBoundary(data)
      );

    if (!result) {
      throw new Error('Failed to send contact');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processContacts(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const contacts = data.content?.contacts ?? [];

    if (!contacts.length) {
      throw new Error('Contacts data is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const vcards = contacts.map((contact) => this.generateVCard(contact));
    const firstContact = contacts[0];
    const firstName =
      `${firstContact?.name ?? ''} ${firstContact?.last_name ?? ''}`.trim() ||
      'Contato';
    const displayName =
      contacts.length > 1
        ? `${firstName} e ${contacts.length - 1} outro contato`
        : firstName;

    const result = await this.baileysMessageLocationContactService.sendContacts(
      jid,
      vcards,
      displayName,
      this.buildOutgoingContextInfo(data),
      quotedMessage ? { quoted: quotedMessage } : undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send contacts');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processReact(jid: string, data: IChatMessage): Promise<void> {
    if (!data.message_key?.id || !data.content?.reactions) {
      return;
    }

    const lastReaction = data.content.reactions.at(-1);
    if (!lastReaction) {
      return;
    }

    const messageKey = this.buildBaileysMessageKey(data.message_key, jid);
    if (!messageKey) return;

    const result = await this.baileysMessageReactionsInteractionsService.react(
      jid,
      messageKey,
      lastReaction.emoji,
      undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send reaction');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processText(jid: string, data: IChatMessage): Promise<void> {
    const hasVersions =
      data.content?.version && data.content.version.length > 0;
    const hasMessageKey = !!data.message_key?.id;

    if (hasVersions && hasMessageKey && data.message_key && data.content) {
      if (data.message_key.from_me !== true) {
        throw new Error('Message edit is not allowed for non-own message');
      }

      const messageKey = this.buildBaileysMessageKey(data.message_key, jid);
      if (!messageKey) {
        return;
      }

      const latestVersion = data.content.version
        ? [...data.content.version].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0]
        : null;

      const newText = latestVersion?.message ?? data.content?.message ?? '';

      let result: WAMessage | undefined;
      try {
        result = await this.baileysMessageEditDeleteService.editText(
          jid,
          newText,
          messageKey,
          undefined,
          this.providerInvocationBoundary(data)
        );
      } catch (error) {
        throw error;
      }

      if (!result) {
        throw new Error('Failed to edit message');
      }

      const update: IUpdateMessage = { message: result, data };
      await this.pushUpdate(update);
      return;
    }

    const result = await this.baileysMessageTextService.sendText(
      jid,
      data.content?.message ?? '',
      {
        linkPreview: data.content?.link_preview as WAUrlInfo,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private handleStatusResult(
    result: WAMessage | null | undefined,
    workerProfileStatusId: string,
    errorMessage: string
  ): ProviderCommandAfterDurableSuccess | undefined {
    if (!result) {
      throw new Error(errorMessage);
    }

    const externalId = result.key?.id?.trim();
    if (!externalId) {
      // The provider invocation already crossed its point of no return. An
      // acknowledgement without an external id cannot be reconciled safely,
      // so persist an ambiguous outcome instead of a false succeeded record.
      throw new Error('profile_status_external_id_missing_after_provider_send');
    }
    const recovery = buildProfileStatusExternalIdRecovery({
      provider: this.PROVIDER,
      accountId: baileysEnvironment.baileysAccountId,
      workerId: baileysEnvironment.baileysWorkerId,
      workerProfileStatusId,
      externalId,
    });
    const publisher = ((assertPublisherActive) =>
      this.sendExternalIdUpdate(
        recovery,
        assertPublisherActive
      )) as ProviderCommandAfterDurableSuccess;
    publisher.recovery = recovery;
    return publisher;
  }

  private async processStatusText(
    jid: string,
    data: IProfileStatusMessage,
    statusJidList: string[],
    beforeProviderInvoke: () => Promise<void>
  ): Promise<ProviderCommandAfterDurableSuccess | undefined> {
    const result = await this.baileysMessageStatusStoriesService.sendStatusText(
      jid,
      data.value,
      {
        statusJidList,
      },
      undefined,
      beforeProviderInvoke
    );

    return this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status text'
    );
  }

  private async processStatusImage(
    jid: string,
    url: string,
    caption: string | undefined,
    data: IProfileStatusMessage,
    statusJidList: string[],
    beforeProviderInvoke: () => Promise<void>
  ): Promise<ProviderCommandAfterDurableSuccess | undefined> {
    const result =
      await this.baileysMessageStatusStoriesService.sendStatusImage(
        jid,
        { url },
        {
          caption,
          statusJidList,
        },
        undefined,
        beforeProviderInvoke
      );

    return this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status image'
    );
  }

  private async processStatusVideo(
    jid: string,
    url: string,
    caption: string | undefined,
    data: IProfileStatusMessage,
    statusJidList: string[],
    beforeProviderInvoke: () => Promise<void>
  ): Promise<ProviderCommandAfterDurableSuccess | undefined> {
    const result =
      await this.baileysMessageStatusStoriesService.sendStatusVideo(
        jid,
        { url },
        {
          caption,
          statusJidList,
        },
        undefined,
        beforeProviderInvoke
      );

    return this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status video'
    );
  }

  private async processStatusAudio(
    jid: string,
    url: string,
    caption: string | undefined,
    data: IProfileStatusMessage,
    statusJidList: string[],
    beforeProviderInvoke: () => Promise<void>
  ): Promise<ProviderCommandAfterDurableSuccess | undefined> {
    const result =
      await this.baileysMessageStatusStoriesService.sendStatusAudio(
        jid,
        { url },
        {
          caption,
          statusJidList,
        },
        undefined,
        beforeProviderInvoke
      );

    return this.handleStatusResult(
      result,
      data.worker_profile_status_id,
      'Failed to send status audio'
    );
  }

  private async processProfileStatus(
    data: IProfileStatusMessage,
    beforeProviderInvoke: () => Promise<void>
  ): Promise<ProviderCommandAfterDurableSuccess | undefined> {
    const jid = 'status@broadcast';
    const valueParts = data.value.split('|');
    const url = valueParts[0];
    const caption =
      valueParts.length > 1 ? valueParts.slice(1).join('|') : undefined;

    const statusJidList = data.statusJidList ?? [];

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.text) {
      return this.processStatusText(
        jid,
        data,
        statusJidList,
        beforeProviderInvoke
      );
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.image) {
      return this.processStatusImage(
        jid,
        url,
        caption,
        data,
        statusJidList,
        beforeProviderInvoke
      );
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.video) {
      return this.processStatusVideo(
        jid,
        url,
        caption,
        data,
        statusJidList,
        beforeProviderInvoke
      );
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.audio) {
      return this.processStatusAudio(
        jid,
        url,
        caption,
        data,
        statusJidList,
        beforeProviderInvoke
      );
    }
    return undefined;
  }

  private async processDeleteStatus(
    data: IProfileStatusDeleteMessage,
    beforeProviderInvoke: () => Promise<void>
  ): Promise<void> {
    await this.baileysMessageStatusStoriesService.deleteStatus(
      data.external_id,
      data.statusJidList,
      beforeProviderInvoke
    );
  }

  private async processProfileInfo(
    data: IProfileInfoMessage,
    envelope: IQueuedEnvelope
  ): Promise<void> {
    const profileName = data.name;
    if (profileName) {
      await this.processProviderCommandWithIdempotency(
        data,
        envelope,
        (beforeProviderInvoke) =>
          this.baileysProfileService.updateProfileName(
            profileName,
            beforeProviderInvoke
          ),
        'profile-info:name'
      );
    }

    const profileStatus = data.message;
    if (profileStatus) {
      await this.processProviderCommandWithIdempotency(
        data,
        envelope,
        (beforeProviderInvoke) =>
          this.baileysProfileService.updateProfileStatus(
            profileStatus,
            beforeProviderInvoke
          ),
        'profile-info:status'
      );
    }

    if (data.photo === null) {
      await this.processProviderCommandWithIdempotency(
        data,
        envelope,
        (beforeProviderInvoke) =>
          this.baileysProfileService.removeProfilePicture(beforeProviderInvoke),
        'profile-info:photo'
      );
      return;
    }

    const profilePhoto = data.photo;
    if (profilePhoto) {
      await this.processProviderCommandWithIdempotency(
        data,
        envelope,
        (beforeProviderInvoke) =>
          this.baileysProfileService.updateProfilePicture(
            profilePhoto,
            beforeProviderInvoke
          ),
        'profile-info:photo'
      );
    }
  }

  private async processImage(jid: string, data: IChatMessage): Promise<void> {
    const imageUrl = data.content?.image?.url;

    if (!imageUrl) {
      throw new Error('Image URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendImage(
      jid,
      { url: imageUrl },
      {
        caption: data.content?.image?.caption ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send image');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processSticker(jid: string, data: IChatMessage): Promise<void> {
    const sticker = data.content?.sticker;

    if (!sticker?.url) {
      throw new Error('Sticker URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendSticker(
      jid,
      { url: sticker.url },
      {
        isAnimated: sticker.is_animated ?? false,
        width: sticker.width ?? undefined,
        height: sticker.height ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send sticker');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processLocation(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const location = data.content?.location;

    if (
      typeof location?.latitude !== 'number' ||
      !Number.isFinite(location.latitude) ||
      typeof location.longitude !== 'number' ||
      !Number.isFinite(location.longitude)
    ) {
      throw new Error('Location coordinates are required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageLocationContactService.sendLocation(
      jid,
      {
        degreesLatitude: location.latitude,
        degreesLongitude: location.longitude,
        name: location.name ?? undefined,
        address: location.address ?? undefined,
        contextInfo: this.buildOutgoingContextInfo(data),
      },
      quotedMessage ? { quoted: quotedMessage } : undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send location');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processTextQuoted(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const quoted = this.composeQuotedMessage(data);

    const result = await this.baileysMessageTextService.sendTextQuoted(
      jid,
      data.content?.message ?? '',
      quoted,
      undefined,
      this.providerInvocationBoundary(data)
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private extractBase64FromThumbnail(thumb: string | null): string | null {
    if (!thumb) return null;
    if (!thumb.startsWith('data:')) return thumb;
    return thumb.split(',')[1] ?? null;
  }

  private createQuotedImageMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.image) return null;

    const thumb = q.image?.thumbnail ?? null;
    const base64 = this.extractBase64FromThumbnail(thumb);

    return {
      imageMessage: {
        caption: q.image?.caption ?? undefined,
        jpegThumbnail: base64 ? Buffer.from(base64, 'base64') : undefined,
      },
    };
  }

  private createQuotedVideoMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.video) return null;

    const thumb = q.video?.thumbnail ?? null;
    const base64 = this.extractBase64FromThumbnail(thumb);

    return {
      videoMessage: {
        caption: q.video?.caption ?? undefined,
        jpegThumbnail: base64 ? Buffer.from(base64, 'base64') : undefined,
        fileLength: q.video?.size ?? undefined,
        mimetype: q.video?.mimetype ?? undefined,
      },
    };
  }

  private createQuotedDocumentMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.document || !q?.document) return null;

    return {
      documentMessage: {
        fileName: q.document.name ?? undefined,
        mimetype: q.document.mimetype ?? undefined,
        caption: q.message ?? undefined,
        fileLength: q.document.size ?? undefined,
      },
    };
  }

  private createQuotedAudioMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.audio || !q?.audio) return null;

    return {
      audioMessage: {
        ptt: q.audio.ptt ?? true,
        seconds: q.audio.duration ?? undefined,
        mimetype: q.audio.mimetype ?? undefined,
      },
    };
  }

  private createQuotedStickerMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.sticker || !q?.sticker) return null;

    return {
      stickerMessage: {
        mimetype: q.sticker.mimetype ?? 'image/webp',
        isAnimated: q.sticker.is_animated ?? false,
        fileLength: q.sticker.size ?? undefined,
        width: q.sticker.width ?? undefined,
        height: q.sticker.height ?? undefined,
      },
    };
  }

  private createQuotedLocationMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.location || !q?.location) return null;

    return {
      locationMessage: {
        degreesLatitude: q.location.latitude ?? undefined,
        degreesLongitude: q.location.longitude ?? undefined,
        name: q.location.name ?? undefined,
        address: q.location.address ?? undefined,
      },
    };
  }

  private createQuotedContactMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type === EMessageType.contact_card && q?.contact) {
      const vcardLines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

      const fullName = [q.contact.name, q.contact.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();

      if (fullName) {
        vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
      }

      if (q.contact.phone) {
        vcardLines.push(`TEL:${q.contact.phone}`);
      }

      if (q.contact.email) {
        vcardLines.push(`EMAIL:${q.contact.email}`);
      }

      vcardLines.push('END:VCARD');
      const vcard = vcardLines.join('\n');

      return {
        contactMessage: {
          displayName: fullName || 'Contato',
          vcard,
        },
      };
    }

    if (q?.type === EMessageType.contacts) {
      const quotedContent = q as any;
      if (quotedContent?.contacts && quotedContent.contacts.length > 0) {
        const firstContact = quotedContent.contacts[0] as IContactMessage;

        const vcardLines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

        const fullName = [firstContact.name, firstContact.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();

        if (fullName) {
          vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
        }

        if (firstContact.phone) {
          vcardLines.push(`TEL:${firstContact.phone}`);
        }

        if (firstContact.email) {
          vcardLines.push(`EMAIL:${firstContact.email}`);
        }

        vcardLines.push('END:VCARD');
        const vcard = vcardLines.join('\n');

        const displayName =
          quotedContent.contacts.length === 1
            ? fullName || 'Contato'
            : `${firstContact.name} e ${quotedContent.contacts.length - 1} outro contato`;

        return {
          contactMessage: {
            displayName,
            vcard,
          },
        };
      }
    }

    return null;
  }

  private createQuotedTextMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (
      (q?.type !== EMessageType.text && q?.type !== EMessageType.system) ||
      !q?.message
    )
      return null;

    return {
      conversation: q.message,
    };
  }

  private composeQuotedMessage(data: IChatMessage): WAMessage {
    const q = data.content?.quoted;

    const rawQuotedId = q?.key.id?.trim();
    const parsedQuotedId = parseSerializedMessageId(rawQuotedId);
    const normalizedQuotedId =
      this.normalizeMessageKeyIdForBaileys(rawQuotedId);

    const quoted: WAMessage = {
      key: {
        remoteJid: q?.key.remote_jid ?? parsedQuotedId?.remoteJid ?? '',
        fromMe: q?.key.from_me ?? parsedQuotedId?.fromMe ?? false,
        id: normalizedQuotedId,
        participant: q?.key.participant || undefined,
      },
      message: null,
    };

    if (!q) {
      return quoted;
    }

    const messageCreators = [
      () => this.createQuotedTextMessage(q),
      () => this.createQuotedImageMessage(q),
      () => this.createQuotedVideoMessage(q),
      () => this.createQuotedDocumentMessage(q),
      () => this.createQuotedAudioMessage(q),
      () => this.createQuotedStickerMessage(q),
      () => this.createQuotedLocationMessage(q),
      () => this.createQuotedContactMessage(q),
    ];

    for (const creator of messageCreators) {
      const message = creator();
      if (message) {
        quoted.message = message;
        break;
      }
    }

    return quoted;
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();
    const activeSendKey = this.activeSendKey(input.data);
    const connectionScope = this.activeSendConnectionScopes?.get(activeSendKey);
    if (!connectionScope) {
      throw this.nonRetryableError('whatsapp_connection_scope_update_missing');
    }
    input.worker_id = connectionScope.worker_id;
    input.source_provider = connectionScope.source_provider;
    input.runtime_generation = connectionScope.runtime_generation;
    input.connection_epoch = connectionScope.connection_epoch;
    ensureMessageUpdateIdentity(input);
    const assertDispatchActive =
      this.activeSendDispatchGuards?.get(activeSendKey);
    const claim = this.activeSendClaims.get(activeSendKey);
    const succeededRecovery = claim ? { update_message: input } : null;
    if (claim) {
      const succeeded = await this.messageSendIdempotencyService.markSucceeded(
        claim,
        succeededRecovery
      );
      if (succeeded !== 'transitioned') {
        throw new Error(`message_send_idempotency_${succeeded}`);
      }
      if (this.activeSendClaims.get(activeSendKey) === claim) {
        this.activeSendClaims.delete(activeSendKey);
      }
    }

    assertDispatchActive?.();
    await this.assertConnectionScopeActive(connectionScope);
    assertDispatchActive?.();
    try {
      await this.streamProducerService.send(
        topic,
        input,
        buildMessageUpdateKafkaKey(input),
        undefined,
        assertDispatchActive
      );
    } catch (error) {
      console.error('[MessageSend] Failed to publish message update:', {
        message_id: input.data?.message_id,
        error,
      });
      throw new MessageUpdatePublishFailedError(error);
    }
    if (claim && succeededRecovery) {
      await this.compactTerminalRecovery(claim, 'succeeded', succeededRecovery);
    }

    const outgoingMessage = input.message as
      (WAMessage & { key?: unknown; message?: unknown }) | undefined;

    if (!outgoingMessage?.key || !outgoingMessage?.message) {
      return;
    }

    try {
      await this.baileysIncomingMessageService.cacheOutgoingForwardableMessage(
        outgoingMessage
      );
    } catch {}
  }

  private async recoverSucceededUpdate(
    result: unknown,
    expectedPayload: IChatMessage,
    assertDispatchActive?: () => void
  ): Promise<void> {
    try {
      const expectedNoUpdate = buildMessageSendNoUpdateRequiredResult(
        expectedPayload,
        this.PROVIDER,
        baileysEnvironment.baileysWorkerId
      );
      if (
        expectedNoUpdate &&
        (result === null ||
          result === undefined ||
          isMessageSendNoUpdateRequiredResult(
            result,
            expectedPayload,
            this.PROVIDER,
            baileysEnvironment.baileysWorkerId
          ))
      ) {
        // Compatibility with v3 records created before no-update outcomes were
        // explicit. A succeeded delete crossed the provider boundary and has no
        // message update to republish.
        assertDispatchActive?.();
        return;
      }
      if (!result || typeof result !== 'object') {
        throw new Error('message_send_succeeded_recovery_missing');
      }
      const update = (result as { update_message?: unknown }).update_message;
      if (!update || typeof update !== 'object') {
        throw new Error('message_send_succeeded_update_missing');
      }

      assertDispatchActive?.();
      const currentScope =
        await this.baileysIncomingMessageService.captureActiveConnectionScope();
      assertDispatchActive?.();
      const messageUpdate = update as IUpdateMessage;
      const internalMessageId = messageUpdate.data?.message_id?.trim();
      const providerMessageId = messageUpdate.message?.key?.id?.trim();
      const storedEventId = messageUpdate.event_id?.trim();
      const expectedEventId = buildMessageUpdateEventId(messageUpdate);
      if (
        !currentScope ||
        currentScope.worker_id !== baileysEnvironment.baileysWorkerId ||
        currentScope.source_provider !== this.PROVIDER ||
        !this.payloadMatchesRuntime(expectedPayload) ||
        messageUpdate.data?.account?.id?.trim() !==
          baileysEnvironment.baileysAccountId ||
        messageUpdate.data?.worker?.id?.trim() !== currentScope.worker_id ||
        messageUpdate.worker_id?.trim() !== currentScope.worker_id ||
        messageUpdate.source_provider !== this.PROVIDER ||
        !internalMessageId ||
        internalMessageId !== expectedPayload.message_id.trim() ||
        messageUpdate.data?.chat_id?.trim() !==
          expectedPayload.chat_id.trim() ||
        !providerMessageId ||
        !storedEventId ||
        storedEventId !== expectedEventId
      ) {
        throw new Error('message_send_succeeded_recovery_identity_invalid');
      }
      const reboundUpdate: IUpdateMessage = {
        ...messageUpdate,
        runtime_generation: currentScope.runtime_generation,
        connection_epoch: currentScope.connection_epoch,
      };
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessage(),
        reboundUpdate,
        buildMessageUpdateKafkaKey(reboundUpdate),
        undefined,
        assertDispatchActive
      );
      assertDispatchActive?.();
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

  private async sendExternalIdUpdate(
    recovery: IProfileStatusExternalIdRecovery,
    assertPublisherActive: () => Promise<void>
  ): Promise<void> {
    try {
      await assertPublisherActive();
      const connectionScope =
        await this.baileysIncomingMessageService.captureActiveConnectionScope();
      await assertPublisherActive();
      if (
        !connectionScope ||
        connectionScope.worker_id !== recovery.worker_id ||
        connectionScope.source_provider !== recovery.provider
      ) {
        throw new Error('whatsapp_connection_scope_unavailable_or_stale');
      }

      const updateMessage: IUpdateProfileStatusExternalId = {
        worker_profile_status_id: recovery.worker_profile_status_id,
        external_id: recovery.external_id,
        event_id: recovery.event_id,
        account_id: recovery.account_id,
        worker_id: connectionScope.worker_id,
        source_provider: connectionScope.source_provider,
        runtime_generation: connectionScope.runtime_generation,
        connection_epoch: connectionScope.connection_epoch,
      };

      const topic =
        this.kafkaServiceQueueService.updateProfileStatusExternalId();
      await assertPublisherActive();
      await this.streamProducerService.send(
        topic,
        updateMessage,
        recovery.kafka_key,
        undefined,
        assertPublisherActive
      );
      await assertPublisherActive();
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
}
