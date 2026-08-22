import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
import { WwebjsMessageTextService } from '@core/services/wwebjs/methods/messageText.service';
import { WwebjsMessageMediaService } from '@core/services/wwebjs/methods/messageMedia.service';
import { WwebjsMessageReactionsInteractionsService } from '@core/services/wwebjs/methods/messageReactionsInteractions.service';
import { WwebjsMessageEditDeleteService } from '@core/services/wwebjs/methods/messageEditDelete.service';
import { WwebjsMessageLocationContactService } from '@core/services/wwebjs/methods/messageLocationContact.service';
import { WwebjsMessageStatusStoriesService } from '@core/services/wwebjs/methods/messageStatusStories.service';
import { WwebjsProfileService } from '@core/services/wwebjs/methods/profile.service';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IProfileStatusMessage } from '@core/common/interfaces/IProfileStatusMessage';
import { IProfileStatusDeleteMessage } from '@core/common/interfaces/IProfileStatusDeleteMessage';
import { IProfileInfoMessage } from '@core/common/interfaces/IProfileInfoMessage';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { selectJidChatWwebjs } from '@core/common/functions/selectJidChatWwebjs';
import { convertWaveformBase64ToUint8Array } from '@core/common/functions/convertWaveform';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { createHash, webcrypto } from 'node:crypto';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { MessageKeyLookupService } from '@core/services/messageKeyLookup.service';
import { buildForwardExtraOptions } from '@core/services/wwebjs/util/buildForwardExtraOptions';
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
import type { WAMessageKey } from '@whiskeysockets/baileys';
import type { IMessageSendTerminalFailureRecovery } from '@core/common/interfaces/IMessageSendTerminalFailureRecovery';
import type { IMessageSendAmbiguousTerminalRecovery } from '@core/common/interfaces/IMessageSendAmbiguousTerminalRecovery';
import {
  buildMessageSendNoUpdateRequiredResult,
  isMessageSendNoUpdateRequiredResult,
} from '@core/common/functions/messageSendNoUpdateRequired';
import { resolveWwebjsSendMessageTimeoutMs } from '@core/services/wwebjs/util/providerSendTimeout';
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
export class MessageSendWwebjsConsume {
  private readonly PROVIDER = 'wwebjs';
  private readonly MAX_PROCESS_ATTEMPTS = 5;
  private readonly RETRY_BASE_MS = 500;
  private readonly RETRY_MAX_MS = 8000;
  private readonly FORWARD_SOURCE_KEY_MAX_WAIT_MS = 4000;
  private readonly FORWARD_SOURCE_KEY_POLL_INTERVAL_MS = 300;
  private readonly PROVIDER_SEND_TIMEOUT_MS =
    resolveWwebjsSendMessageTimeoutMs();
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
    @inject(WwebjsMessageTextService)
    private readonly wwebjsMessageTextService: WwebjsMessageTextService,
    @inject(WwebjsMessageMediaService)
    private readonly wwebjsMessageMediaService: WwebjsMessageMediaService,
    @inject(WwebjsMessageReactionsInteractionsService)
    private readonly wwebjsMessageReactionsInteractionsService: WwebjsMessageReactionsInteractionsService,
    @inject(WwebjsMessageEditDeleteService)
    private readonly wwebjsMessageEditDeleteService: WwebjsMessageEditDeleteService,
    @inject(WwebjsMessageLocationContactService)
    private readonly wwebjsMessageLocationContactService: WwebjsMessageLocationContactService,
    @inject(WwebjsMessageStatusStoriesService)
    private readonly wwebjsMessageStatusStoriesService: WwebjsMessageStatusStoriesService,
    @inject(WwebjsProfileService)
    private readonly wwebjsProfileService: WwebjsProfileService,
    @inject(WwebjsIncomingMessageService)
    private readonly wwebjsIncomingMessageService: WwebjsIncomingMessageService,
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
        worker_id: wwebjsEnvironment.wwebjsWorkerId,
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

    console.error(
      '[MessageSendWwebjs] Failed to publish terminal status update:',
      {
        message_id: payload.message_id,
        event_id: eventId,
        attempts: FAILURE_STATUS_PUBLISH_MAX_ATTEMPTS,
        error: lastError,
      }
    );
    throw new MessageUpdatePublishFailedError(lastError);
  }

  private buildTerminalFailureRecovery(
    payload: IChatMessage
  ): IMessageSendTerminalFailureRecovery {
    const operationId =
      resolveMessageSendOperationId(payload) ?? payload.message_id.trim();
    const statusUpdate: IMessageStatusUpdate = {
      account_id: wwebjsEnvironment.wwebjsAccountId,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      source_provider: 'wwebjs',
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
      provider: 'wwebjs',
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
      recovery.provider !== 'wwebjs' ||
      recovery.operation_id !== expected.operation_id ||
      recovery.outcome_digest !== expected.outcome_digest ||
      !statusUpdate ||
      typeof statusUpdate !== 'object' ||
      statusUpdate.failed !== true ||
      statusUpdate.terminal_failure_schema !==
        'message_send_terminal_failure_recovery_v1' ||
      statusUpdate.internal_message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.message_id?.trim() !== payload.message_id.trim() ||
      statusUpdate.account_id?.trim() !== wwebjsEnvironment.wwebjsAccountId ||
      statusUpdate.worker_id?.trim() !== wwebjsEnvironment.wwebjsWorkerId ||
      statusUpdate.source_provider !== 'wwebjs' ||
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
          'wwebjs',
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
      account_id: wwebjsEnvironment.wwebjsAccountId,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      source_provider: 'wwebjs',
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
      provider: 'wwebjs',
      operation_id: operationId,
      outcome_digest: createHash('sha256')
        .update(
          [
            'message_send_ambiguous_terminal_v1',
            'wwebjs',
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
      recovery.provider !== 'wwebjs' ||
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
      statusUpdate.account_id?.trim() !== wwebjsEnvironment.wwebjsAccountId ||
      statusUpdate.worker_id?.trim() !== wwebjsEnvironment.wwebjsWorkerId ||
      statusUpdate.source_provider !== 'wwebjs' ||
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
      payload.account?.id?.trim() === wwebjsEnvironment.wwebjsAccountId &&
      payload.worker?.id?.trim() === wwebjsEnvironment.wwebjsWorkerId
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
          payload.account?.id?.trim() || wwebjsEnvironment.wwebjsAccountId;
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

        const terminalReason = this.resolveTerminalReason(error);

        if (terminalReason) {
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
          '[MessageSendWwebjs] Send payload without chatId. Message skipped.'
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
            '[MessageSendWwebjs] Conflicting immutable idempotency identity rejected',
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
            wwebjsEnvironment.wwebjsWorkerId
          );
          if (!noUpdateRequired) {
            throw this.nonRetryableError(
              'message_send_succeeded_recovery_missing'
            );
          }
          const succeeded =
            await this.messageSendIdempotencyService.markSucceeded(
              claim,
              noUpdateRequired
            );
          if (succeeded !== 'transitioned') {
            throw this.nonRetryableError(
              `message_send_idempotency_${succeeded}`
            );
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

    console.warn(
      '[MessageSendWwebjs] Unsupported payload type. Message skipped.'
    );
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
      accountId !== wwebjsEnvironment.wwebjsAccountId ||
      payload.worker_id?.trim() !== wwebjsEnvironment.wwebjsWorkerId
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
          '[MessageSendWwebjs] Conflicting provider-command idempotency identity rejected',
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
    let providerInvocationPromise: Promise<void> | null = null;
    const beforeProviderInvoke = async (): Promise<void> => {
      if (providerStartRejected !== null) {
        throw providerStartRejected;
      }
      if (providerInvoked) {
        return;
      }
      await assertPublisherActive();
      if (!providerInvocationPromise) {
        providerInvocationPromise = (async () => {
          let invoked: Awaited<
            ReturnType<MessageSendIdempotencyService['markProviderInvoked']>
          >;
          try {
            invoked =
              await this.messageSendIdempotencyService.markProviderInvoked(
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
            // No asynchronous work is permitted between the durable
            // transition and the provider invocation. The helper performs
            // the exact provider/client assertion synchronously.
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
        })();
      }
      await providerInvocationPromise;
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
        throw this.nonRetryableError(`message_send_idempotency_${succeeded}`);
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
        '[MessageSendWwebjs] Invalid succeeded profile-status auxiliary recovery discarded'
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
        '[MessageSendWwebjs] Conflicting succeeded profile-status auxiliary recovery discarded'
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
      wwebjsEnvironment.wwebjsAccountId,
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
    console.error('[MessageSendWwebjs] Discarding terminal send failure:', {
      provider: this.PROVIDER,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
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
      message === 'Official interactive message has no fallback text' ||
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
          await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
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
      scope.worker_id !== wwebjsEnvironment.wwebjsWorkerId ||
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
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    if (!this.connectionScopesMatch(expected, current)) {
      throw this.nonRetryableError('whatsapp_connection_scope_revoked');
    }
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

  private getQuotedKey(data: IChatMessage):
    | {
        key: {
          id: string;
          remote_jid?: string | null;
          remote_jid_alt?: string | null;
          from_me?: boolean | null;
          participant?: string | null;
          participant_alt?: string | null;
        };
      }
    | undefined {
    const quotedKey = data.content?.quoted?.key;
    const id = quotedKey?.id;
    if (!id) return undefined;

    return {
      key: {
        id,
        remote_jid: quotedKey.remote_jid ?? null,
        remote_jid_alt: quotedKey.remote_jid_alt ?? null,
        from_me: quotedKey.from_me ?? null,
        participant: quotedKey.participant ?? null,
        participant_alt: quotedKey.participant_alt ?? null,
      },
    };
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
      nativeResolution?: 'direct' | 'snapshot_poll' | 'unresolved';
    }
  ): void {
    console.info('[MessageSendWwebjs] Forward processed', {
      source_message_id: data.content?.forward?.source_message_id ?? null,
      target_chat_id: data.chat_id,
      provider: 'wwebjs',
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

  private buildForwardSourceKey(data: IChatMessage): {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  } | null {
    const sourceKey = data.content?.forward?.source_message_key;
    if (!sourceKey?.id) {
      return null;
    }

    const parsed = parseSerializedMessageId(sourceKey.id);
    const remoteJid = sourceKey.remote_jid ?? parsed?.remoteJid ?? '';
    if (!remoteJid) {
      return null;
    }

    return {
      remoteJid,
      fromMe: sourceKey.from_me ?? parsed?.fromMe ?? false,
      id: sourceKey.id,
      participant: sourceKey.participant ?? undefined,
    };
  }

  private async processForwardFallback(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    hasQuoted: boolean,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      await this.processOfficialCtaUrlMessage(
        data,
        jid,
        chatId,
        currentType,
        hasQuoted,
        forwardExtra
      )
    )
      return true;

    if (
      await this.processTextOrSystemMessage(
        data,
        jid,
        chatId,
        currentType,
        hasQuoted,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processImageMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processDocumentMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processAudioMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processVideoMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processStickerMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processLocationMessage(
        data,
        jid,
        chatId,
        currentType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processContactCardMessage(
        data,
        jid,
        chatId,
        currentType,
        forwardExtra
      )
    )
      return true;
    if (
      await this.processContactsMessage(
        data,
        jid,
        chatId,
        currentType,
        forwardExtra
      )
    )
      return true;

    return false;
  }

  private async processForwardMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    hasQuoted: boolean
  ): Promise<boolean> {
    if (!data.content?.forward) {
      return false;
    }

    await this.hydrateForwardSourceKey(data);

    const sourceKey = this.buildForwardSourceKey(data);

    if (sourceKey) {
      try {
        const nativeResult =
          await this.wwebjsMessageEditDeleteService.forwardMessage(
            jid,
            sourceKey,
            this.providerInvocationBoundary(data)
          );
        if (nativeResult.sent) {
          if (nativeResult.messageKey) {
            await this.pushUpdate({ message: nativeResult.messageKey, data });
          }
          if (currentType) {
            this.lastMessageTypeByChatId.set(chatId, currentType);
          }
          this.logForwardResult(data, 'native', 'success', {
            nativeResolution: nativeResult.resolution_path,
          });
          return true;
        }
        this.logForwardResult(data, 'native', 'failed', {
          reason: 'source_not_found_cache_or_store',
          error: nativeResult.error,
          nativeResolution: nativeResult.resolution_path,
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
    } else {
      this.logForwardResult(data, 'native', 'failed', {
        reason: this.resolveMissingSourceReason(data),
      });
    }

    const forwardExtra = buildForwardExtraOptions(data);
    const fallbackResult = await this.processForwardFallback(
      data,
      jid,
      chatId,
      currentType,
      lastType,
      hasQuoted,
      forwardExtra
    );

    if (!fallbackResult) {
      this.logForwardResult(data, 'fallback', 'failed', {
        reason: 'fallback_handler_unavailable',
      });
      throw new Error('Failed to resolve forward fallback handler');
    }

    this.logForwardResult(data, 'fallback', 'success');
    return true;
  }

  private isIdempotencyBoundaryError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.startsWith('message_send_idempotency_')
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
    const jid = selectJidChatWwebjs(data);
    if (!jid) throw new Error('Received message without remoteJid');
    const chatId = this.resolveChatId(data);
    if (!chatId) throw new Error('Received message without chatId');
    const currentType = data?.content?.type;
    const lastType = this.lastMessageTypeByChatId.get(chatId);
    const hasQuoted = !!data.content?.quoted || data.has_quoted === true;

    if (!this.canInvokeProviderForMessage(data, currentType)) {
      throw this.nonRetryableError('message_send_handler_unavailable');
    }
    if (
      await this.processForwardMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType,
        hasQuoted
      )
    )
      return;

    if (
      await this.processOfficialCtaUrlMessage(
        data,
        jid,
        chatId,
        currentType,
        hasQuoted
      )
    )
      return;

    if (
      await this.processTextOrSystemMessage(
        data,
        jid,
        chatId,
        currentType,
        hasQuoted
      )
    )
      return;
    if (
      await this.processImageMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processDocumentMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType
      )
    )
      return;
    if (
      await this.processAudioMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processVideoMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processStickerMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (await this.processLocationMessage(data, jid, chatId, currentType))
      return;
    if (await this.processContactCardMessage(data, jid, chatId, currentType))
      return;
    if (await this.processContactsMessage(data, jid, chatId, currentType))
      return;
    if (await this.processDeleteMessage(data, jid, chatId, currentType)) return;
    if (currentType === EMessageType.react && Boolean(data.message_key?.id)) {
      await this.processReactMessage(data, jid, chatId, currentType);
      return;
    }
    throw this.nonRetryableError('message_send_handler_unavailable');
  }

  private canInvokeProviderForMessage(
    data: IChatMessage,
    currentType: EMessageType | undefined
  ): boolean {
    if (data.content?.forward) return true;
    if (!currentType) return false;

    switch (currentType) {
      case EMessageType.official_interactive:
        return this.isOfficialCtaUrlMessage(data);
      case EMessageType.text:
      case EMessageType.system:
        return true;
      case EMessageType.image:
        return Boolean(data.content?.image?.url);
      case EMessageType.document:
        return Boolean(data.content?.document?.url);
      case EMessageType.audio:
        return Boolean(data.content?.audio?.url);
      case EMessageType.video:
      case EMessageType.video_note:
        return Boolean(data.content?.video?.url);
      case EMessageType.sticker:
        return Boolean(data.content?.sticker?.url);
      case EMessageType.location:
        return Boolean(data.content?.location);
      case EMessageType.contact_card:
        return Boolean(data.content?.contact);
      case EMessageType.contacts:
        return Boolean(data.content?.contacts?.length);
      case EMessageType.delete_message:
      case EMessageType.react:
        return Boolean(data.message_key?.id);
      default:
        return false;
    }
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
        throw this.nonRetryableError(
          'message_send_idempotency_active_claim_missing'
        );
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
          // validates the exact provider/client before starting the SDK call.
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

  private isOfficialCtaUrlMessage(data: IChatMessage): boolean {
    const display = data.content?.official?.display;
    if (display?.kind === 'cta_url') {
      return true;
    }

    const raw = data.content?.official?.raw;
    const rawType = typeof raw?.type === 'string' ? raw.type : null;
    if (rawType?.toLowerCase() === 'cta_url') {
      return true;
    }

    const interactive = raw?.interactive;
    if (!interactive || typeof interactive !== 'object') {
      return false;
    }

    const interactiveType = (interactive as { type?: unknown }).type;
    return (
      typeof interactiveType === 'string' &&
      interactiveType.toLowerCase() === 'cta_url'
    );
  }

  private resolveOfficialCtaUrlFallbackText(data: IChatMessage): string {
    const display = data.content?.official?.display;
    const firstAction = display?.actions?.find(
      (action) =>
        !!action.title?.trim() ||
        !!action.description?.trim() ||
        !!action.url?.trim()
    );

    return (
      data.content?.message?.trim() ||
      display?.body?.trim() ||
      display?.title?.trim() ||
      display?.action_label?.trim() ||
      firstAction?.title?.trim() ||
      firstAction?.description?.trim() ||
      firstAction?.url?.trim() ||
      ''
    );
  }

  private async processOfficialCtaUrlMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    hasQuoted: boolean,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      currentType !== EMessageType.official_interactive ||
      !this.isOfficialCtaUrlMessage(data)
    ) {
      return false;
    }

    const text = this.resolveOfficialCtaUrlFallbackText(data);
    if (!text) {
      throw this.nonRetryableError(
        'Official interactive message has no fallback text'
      );
    }

    const quotedKey = this.getQuotedKey(data);

    if (hasQuoted && quotedKey) {
      const result = await this.wwebjsMessageTextService.sendTextQuoted(
        jid,
        text,
        quotedKey,
        { extra: forwardExtra },
        this.providerInvocationBoundary(data)
      );
      if (result) await this.pushUpdate({ message: result, data });
      this.lastMessageTypeByChatId.set(
        chatId,
        EMessageType.official_interactive
      );
      return true;
    }

    if (hasQuoted && !quotedKey) {
      console.warn(
        '[MessageSendWwebjs] Quoted flag is true but quoted key is missing. Sending official interactive fallback as regular text.'
      );
    }

    const result = await this.wwebjsMessageTextService.sendText(
      jid,
      text,
      {
        extra: forwardExtra,
      },
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.official_interactive);
    return true;
  }

  private async processTextOrSystemMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    hasQuoted: boolean,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      currentType !== EMessageType.text &&
      currentType !== EMessageType.system
    ) {
      return false;
    }

    const hasVersions = !!data.content?.version?.length;
    const messageKey = data.message_key;
    const hasMessageKey = !!messageKey?.id;

    if (currentType === EMessageType.text && hasVersions && hasMessageKey) {
      if (messageKey?.from_me !== true) {
        throw this.nonRetryableError(
          'Message edit is not allowed for non-own message'
        );
      }

      const latestVersion = data.content?.version
        ? [...data.content.version].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0]
        : null;

      const newText = latestVersion?.message ?? data.content?.message ?? '';

      const result = await this.wwebjsMessageEditDeleteService.editText(
        newText,
        {
          remoteJid: messageKey?.remote_jid ?? jid,
          remoteJidAlt: messageKey?.remote_jid_alt ?? undefined,
          fromMe: messageKey?.from_me ?? false,
          id: messageKey?.id ?? '',
          participant: messageKey?.participant ?? undefined,
          participant_alt: messageKey?.participant_alt ?? undefined,
        },
        this.providerInvocationBoundary(data)
      );

      if (!result) {
        throw this.nonRetryableError('Failed to edit message');
      }

      await this.pushUpdate({ message: result, data });
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return true;
    }

    const quotedKey = this.getQuotedKey(data);

    if (hasQuoted && quotedKey) {
      const result = await this.wwebjsMessageTextService.sendTextQuoted(
        jid,
        data.content?.message ?? '',
        quotedKey,
        { extra: forwardExtra },
        this.providerInvocationBoundary(data)
      );
      if (result) await this.pushUpdate({ message: result, data });
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return true;
    }

    if (hasQuoted && !quotedKey) {
      console.warn(
        '[MessageSendWwebjs] Quoted flag is true but quoted key is missing. Sending as regular text.'
      );
    }

    const result = await this.wwebjsMessageTextService.sendText(
      jid,
      data.content?.message ?? '',
      {
        linkPreview: data.content?.link_preview as {
          title?: string;
          description?: string;
        } | null,
        extra: forwardExtra,
      },
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
    return true;
  }

  private async processImageMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.image || !data.content?.image?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendImage(
      jid,
      { url: data.content.image.url },
      {
        caption: data.content.image.caption ?? undefined,
        extra: forwardExtra,
      },
      this.getQuotedKey(data),
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.image);
    return true;
  }

  private async processDocumentMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.document || !data.content?.document?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendDocument(
      jid,
      {
        url: data.content.document.url,
        mimetype: data.content.document.mimetype ?? undefined,
        filename: data.content.document.name ?? undefined,
        filesize: data.content.document.size ?? undefined,
      },
      {
        mimetype: data.content.document.mimetype ?? 'application/octet-stream',
        fileName: data.content.document.name ?? undefined,
        caption: data.content?.message ?? undefined,
        extra: forwardExtra,
      },
      this.getQuotedKey(data),
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.document);
    return true;
  }

  private async processAudioMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.audio || !data.content?.audio?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const waveform =
      data.content.audio.ptt && data.content.audio.waveform
        ? convertWaveformBase64ToUint8Array(data.content.audio.waveform)
        : undefined;
    const result = await this.wwebjsMessageMediaService.sendAudio(
      jid,
      {
        url: data.content.audio.url,
        mimetype: data.content.audio.mimetype ?? undefined,
        filename: data.content.audio.name ?? undefined,
        filesize: data.content.audio.size ?? undefined,
      },
      {
        ptt: data.content.audio.ptt ?? true,
        seconds: data.content.audio.duration ?? undefined,
        mimetype: data.content.audio.mimetype ?? undefined,
        fileName: data.content.audio.name ?? undefined,
        filesize: data.content.audio.size ?? undefined,
        viewOnce:
          data.message_key?.is_view_once ??
          data.content.audio.view_once ??
          undefined,
        waveform,
        extra: forwardExtra,
      },
      this.getQuotedKey(data),
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.audio);
    return true;
  }

  private async processVideoMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      (currentType !== EMessageType.video &&
        currentType !== EMessageType.video_note) ||
      !data.content?.video?.url
    )
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendVideo(
      jid,
      {
        url: data.content.video.url,
        mimetype: data.content.video.mimetype ?? undefined,
        filename: data.content.video.name ?? undefined,
        filesize: data.content.video.size ?? undefined,
      },
      {
        caption:
          data.content.video.caption ?? data.content?.message ?? undefined,
        seconds: data.content.video.duration ?? undefined,
        mimetype: data.content.video.mimetype ?? undefined,
        fileName: data.content.video.name ?? undefined,
        filesize: data.content.video.size ?? undefined,
        extra: forwardExtra,
      },
      this.getQuotedKey(data),
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, currentType);
    return true;
  }

  private async processStickerMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.sticker || !data.content?.sticker?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendSticker(
      jid,
      { url: data.content.sticker.url },
      this.getQuotedKey(data),
      forwardExtra,
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.sticker);
    return true;
  }

  private async processLocationMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.location || !data.content?.location)
      return false;
    const loc = data.content.location;
    const result = await this.wwebjsMessageLocationContactService.sendLocation(
      jid,
      {
        degreesLatitude: loc.latitude ?? 0,
        degreesLongitude: loc.longitude ?? 0,
        name: loc.name ?? undefined,
        address: loc.address ?? undefined,
      },
      this.getQuotedKey(data),
      forwardExtra,
      this.providerInvocationBoundary(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.location);
    return true;
  }

  private async processContactCardMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (currentType !== EMessageType.contact_card || !data.content?.contact)
      return false;
    const contactData = data.content.contact;
    const vcardLines = ['BEGIN:VCARD', 'VERSION:3.0'];
    const fullName = [contactData.name, contactData.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) {
      vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
    }
    if (contactData.phone) vcardLines.push(`TEL:${contactData.phone}`);
    if (contactData.email) vcardLines.push(`EMAIL:${contactData.email}`);
    vcardLines.push('END:VCARD');
    const vcard = vcardLines.join('\n');
    const result =
      await this.wwebjsMessageLocationContactService.sendContactCard(
        jid,
        vcard,
        this.getQuotedKey(data),
        forwardExtra,
        this.providerInvocationBoundary(data)
      );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.contact_card);
    return true;
  }

  private async processContactsMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    forwardExtra?: Record<string, unknown>
  ): Promise<boolean> {
    if (
      currentType !== EMessageType.contacts ||
      !data.content?.contacts?.length
    )
      return false;

    const firstContact = data.content.contacts[0];
    const vcardLines = ['BEGIN:VCARD', 'VERSION:3.0'];
    const fullName = [firstContact.name, firstContact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (fullName) {
      vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
    }
    if (firstContact.phone) vcardLines.push(`TEL:${firstContact.phone}`);
    if (firstContact.email) vcardLines.push(`EMAIL:${firstContact.email}`);
    vcardLines.push('END:VCARD');

    const result =
      await this.wwebjsMessageLocationContactService.sendContactCard(
        jid,
        vcardLines.join('\n'),
        this.getQuotedKey(data),
        forwardExtra,
        this.providerInvocationBoundary(data)
      );

    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.contacts);
    return true;
  }

  private async processDeleteMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.delete_message || !data.message_key?.id) {
      return false;
    }
    const key = {
      remoteJid: data.message_key.remote_jid ?? jid,
      remoteJidAlt: data.message_key.remote_jid_alt ?? undefined,
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
      participant_alt: data.message_key.participant_alt ?? undefined,
    };
    await this.wwebjsMessageEditDeleteService.deleteMessage(
      key,
      this.providerInvocationBoundary(data)
    );
    this.lastMessageTypeByChatId.set(chatId, EMessageType.delete_message);
    return true;
  }

  private async processReactMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<void> {
    if (currentType !== EMessageType.react || !data.message_key?.id) {
      return;
    }

    const emojiFromMessage =
      typeof data.content?.message === 'string' ? data.content.message : null;
    const lastReaction = data.content?.reactions?.at(-1);
    const emoji = emojiFromMessage ?? lastReaction?.emoji;
    if (emoji === undefined) {
      return;
    }

    const key = {
      remoteJid: jid,
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
    };

    const result = await this.wwebjsMessageReactionsInteractionsService.react(
      key,
      emoji,
      this.providerInvocationBoundary(data)
    );
    if (!result) {
      throw new Error('Failed to send reaction');
    }

    this.lastMessageTypeByChatId.set(chatId, EMessageType.react);
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

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.text) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusText(
          jid,
          data.value,
          beforeProviderInvoke
        );
      return this.buildStatusExternalIdPublisher(
        result,
        data.worker_profile_status_id
      );
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.image) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusImage(
          jid,
          { url },
          { caption },
          beforeProviderInvoke
        );
      return this.buildStatusExternalIdPublisher(
        result,
        data.worker_profile_status_id
      );
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.video) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusVideo(
          jid,
          { url },
          { caption },
          beforeProviderInvoke
        );
      return this.buildStatusExternalIdPublisher(
        result,
        data.worker_profile_status_id
      );
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.audio) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusAudio(
          jid,
          { url },
          { caption },
          beforeProviderInvoke
        );
      return this.buildStatusExternalIdPublisher(
        result,
        data.worker_profile_status_id
      );
    }
    return undefined;
  }

  private buildStatusExternalIdPublisher(
    result: { key?: { id?: string | null } | null } | null | undefined,
    workerProfileStatusId: string
  ): ProviderCommandAfterDurableSuccess {
    const externalId = result?.key?.id?.trim();
    if (!externalId) {
      // The provider invocation already crossed its point of no return. An
      // acknowledgement without an external id cannot be reconciled safely,
      // so persist an ambiguous outcome instead of a false succeeded record.
      throw new Error('profile_status_external_id_missing_after_provider_send');
    }
    const recovery = buildProfileStatusExternalIdRecovery({
      provider: this.PROVIDER,
      accountId: wwebjsEnvironment.wwebjsAccountId,
      workerId: wwebjsEnvironment.wwebjsWorkerId,
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

  private async processDeleteStatus(
    data: IProfileStatusDeleteMessage,
    beforeProviderInvoke: () => Promise<void>
  ): Promise<void> {
    await this.wwebjsMessageStatusStoriesService.deleteStatus(
      data.external_id,
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
          this.wwebjsProfileService.updateProfileName(
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
          this.wwebjsProfileService.updateProfileStatus(
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
          this.wwebjsProfileService.removeProfilePicture(beforeProviderInvoke),
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
          this.wwebjsProfileService.updateProfilePicture(
            profilePhoto,
            beforeProviderInvoke
          ),
        'profile-info:photo'
      );
    }
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
        throw this.nonRetryableError(`message_send_idempotency_${succeeded}`);
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
      console.error('[MessageSendWwebjs] Failed to publish message update:', {
        message_id: input.data?.message_id,
        error,
      });
      throw new MessageUpdatePublishFailedError(error);
    }
    if (claim && succeededRecovery) {
      await this.compactTerminalRecovery(claim, 'succeeded', succeededRecovery);
    }
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
        wwebjsEnvironment.wwebjsWorkerId
      );
      if (
        expectedNoUpdate &&
        (result === null ||
          result === undefined ||
          isMessageSendNoUpdateRequiredResult(
            result,
            expectedPayload,
            this.PROVIDER,
            wwebjsEnvironment.wwebjsWorkerId
          ))
      ) {
        // Compatibility with v3 records created before no-update outcomes were
        // explicit. Succeeded deletes/reactions have no message update to
        // republish.
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
        await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
      assertDispatchActive?.();
      const messageUpdate = update as IUpdateMessage;
      const internalMessageId = messageUpdate.data?.message_id?.trim();
      const providerMessageId = messageUpdate.message?.key?.id?.trim();
      const storedEventId = messageUpdate.event_id?.trim();
      const expectedEventId = buildMessageUpdateEventId(messageUpdate);
      if (
        !currentScope ||
        currentScope.worker_id !== wwebjsEnvironment.wwebjsWorkerId ||
        currentScope.source_provider !== this.PROVIDER ||
        !this.payloadMatchesRuntime(expectedPayload) ||
        messageUpdate.data?.account?.id?.trim() !==
          wwebjsEnvironment.wwebjsAccountId ||
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
        await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
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
