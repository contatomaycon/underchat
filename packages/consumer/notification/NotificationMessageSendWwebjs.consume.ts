import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WwebjsMessageTextService } from '@core/services/wwebjs/methods/messageText.service';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';
import { WwebjsPhoneValidationService } from '@core/services/wwebjs/methods/phoneValidation.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import {
  MessageSendClaimResult,
  MessageSendIdempotencyService,
} from '@core/services/messageSendIdempotency.service';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import {
  IWhatsappRuntimeFence,
  WhatsappRuntimeFenceService,
} from '@core/services/whatsappRuntimeFence.service';
import {
  MessageUpdatePublishFailedError,
  isMessageUpdatePublishFailedError,
} from '@core/common/exceptions/MessageUpdatePublishFailedError';
import { isProviderInvocationInFlightError } from '@core/common/functions/providerInvocationSingleFlight';
import { isKafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import {
  buildNotificationSendAmbiguousRecovery,
  INotificationSendAmbiguousRecovery,
  normalizeNotificationSendAmbiguousRecovery,
} from '@core/common/functions/outboundAuxiliarySendRecovery';
import { resolveWwebjsSendMessageTimeoutMs } from '@core/services/wwebjs/util/providerSendTimeout';
import type { IProviderInvocationBoundary } from '@core/common/interfaces/IProviderInvocationBoundary';
import {
  buildNotificationPhoneJidRecovery,
  normalizeNotificationPhoneJidRecovery,
  type INotificationPhoneJidRecovery,
} from '@core/common/functions/providerCommandAuxiliaryRecovery';

@singleton()
export class NotificationMessageSendWwebjsConsume {
  private readonly providerInvocationLeaseMs =
    MessageSendIdempotencyService.providerInvocationLeaseMs(
      resolveWwebjsSendMessageTimeoutMs()
    );
  constructor(
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WwebjsMessageTextService)
    private readonly wwebjsMessageTextService: WwebjsMessageTextService,
    @inject(WwebjsPhoneValidationService)
    private readonly wwebjsPhoneValidationService: WwebjsPhoneValidationService,
    @inject(WwebjsIncomingMessageService)
    private readonly wwebjsIncomingMessageService: WwebjsIncomingMessageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(MessageSendIdempotencyService)
    private readonly messageSendIdempotencyService: MessageSendIdempotencyService
  ) {}

  public async handleJetStreamCommand(
    payload: unknown,
    assertActive: () => void,
    operationId: string
  ): Promise<void> {
    const data = this.parseNotificationMessage(
      Buffer.from(JSON.stringify(payload), 'utf8')
    );
    if (!data) {
      throw new Error('worker_command_notification_payload_invalid');
    }
    data.operation_id = operationId;
    await this.processNotificationMessage(data, assertActive);
  }

  private parseNotificationMessage(
    value: Buffer | null
  ): INotificationMessage | null {
    if (!value) return null;

    const raw = value.toString('utf8').trim();
    if (!raw) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      return this.isNotificationMessagePayload(parsed) ? parsed : null;
    } catch (error) {
      console.error('parseNotificationMessage: erro ao fazer parse:', error);

      return null;
    }
  }

  private isNotificationMessagePayload(
    value: unknown
  ): value is INotificationMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const payload = value as Record<string, unknown>;
    const messageKey = payload.message_key;
    if (
      !messageKey ||
      typeof messageKey !== 'object' ||
      Array.isArray(messageKey) ||
      !this.isNonEmptyString(payload.notification_id) ||
      !this.isNonEmptyString(payload.message_whatsapp)
    ) {
      return false;
    }

    if (
      !this.isOptionalString(payload.operation_id) ||
      !this.isOptionalString(payload.user_id)
    ) {
      return false;
    }

    const account = payload.account;
    if (
      account !== undefined &&
      account !== null &&
      (typeof account !== 'object' ||
        Array.isArray(account) ||
        !this.isOptionalString((account as Record<string, unknown>).id))
    ) {
      return false;
    }

    const destination = messageKey as Record<string, unknown>;
    if (
      !this.isOptionalString(destination.remote_jid) ||
      !this.isOptionalString(destination.phone_ddi) ||
      !this.isOptionalString(destination.phone_number)
    ) {
      return false;
    }

    return (
      this.isValidRemoteJid(destination.remote_jid) ||
      (this.hasPhoneDigits(destination.phone_ddi) &&
        this.hasPhoneDigits(destination.phone_number))
    );
  }

  private isOptionalString(value: unknown): boolean {
    return value === undefined || value === null || typeof value === 'string';
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isValidRemoteJid(value: unknown): value is string {
    return (
      this.isNonEmptyString(value) && /^[^\s@]+@[^\s@]+$/u.test(value.trim())
    );
  }

  private hasPhoneDigits(value: unknown): value is string {
    return (
      this.isNonEmptyString(value) && value.replaceAll(/\D/gu, '').length > 0
    );
  }

  private async processNotificationMessage(
    data: INotificationMessage,
    assertDispatchActive: () => void = () => undefined,
    consumerAssignmentEpoch?: number
  ): Promise<void> {
    if (!data.message_whatsapp) return;

    const connectionScope =
      await this.captureActiveConnectionScope(assertDispatchActive);
    if (!connectionScope) {
      throw new MessageUpdatePublishFailedError(
        new Error('notification_send_runtime_scope_unavailable')
      );
    }

    const claim = await this.claimNotificationSendAttempt(
      data,
      connectionScope,
      consumerAssignmentEpoch
    );
    if (!claim) {
      throw new Error('notification_send_idempotency_error');
    }
    if (claim.status === 'error') {
      if (claim.reason === 'identity_conflict') {
        console.error(
          '[NotificationMessageSendWwebjs] Conflicting immutable idempotency identity rejected',
          {
            notification_id: data.notification_id,
            destination: this.buildNotificationDestination(data),
          }
        );
        return;
      }
      throw new MessageUpdatePublishFailedError(
        new Error(`notification_send_idempotency_${claim.reason}`)
      );
    }
    if (claim.status === 'duplicate') {
      if (claim.compacted) {
        return;
      }
      await this.recoverDuplicateNotificationSend(
        claim,
        data,
        connectionScope,
        assertDispatchActive
      );
      return;
    }

    let target: Awaited<ReturnType<typeof this.resolveNotificationTarget>>;
    try {
      target = await this.resolveNotificationTarget(
        data,
        connectionScope,
        assertDispatchActive
      );
      assertDispatchActive();
    } catch (error) {
      await this.messageSendIdempotencyService
        .releaseReservation(claim)
        .catch(() => undefined);
      if (isMessageUpdatePublishFailedError(error)) {
        throw error;
      }
      throw new MessageUpdatePublishFailedError(error);
    }
    if (!target) {
      await this.messageSendIdempotencyService
        .releaseReservation(claim)
        .catch(() => undefined);
      return;
    }

    let providerInvoked = false;
    let providerInvocationTransitionUncertain = false;
    const ambiguousRecovery = this.buildNotificationAmbiguousRecovery(
      data,
      claim
    );
    const succeededRecovery = this.buildNotificationSucceededRecovery(
      data,
      claim,
      target
    );
    let providerInvocationPromise: Promise<void> | null = null;
    const beforeProviderInvoke: IProviderInvocationBoundary =
      (): Promise<void> => {
        assertDispatchActive();
        if (providerInvoked) {
          return Promise.resolve();
        }
        if (!providerInvocationPromise) {
          providerInvocationPromise = (async () => {
            await this.assertConnectionScopeActive(
              target.connectionScope,
              assertDispatchActive
            );
            providerInvocationTransitionUncertain = true;
            const invoked =
              await this.messageSendIdempotencyService.markProviderInvoked(
                claim,
                ambiguousRecovery,
                this.providerInvocationLeaseMs ??
                  MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS
              );
            if (invoked !== 'transitioned') {
              throw new MessageUpdatePublishFailedError(
                new Error(
                  `notification_send_idempotency_provider_invoked_${invoked}`
                )
              );
            }
            providerInvocationTransitionUncertain = false;
            providerInvoked = true;
            try {
              // No asynchronous work is allowed after the durable transition.
              // The helper performs the exact client assertion synchronously.
              assertDispatchActive();
            } catch (error) {
              const reverted =
                await this.messageSendIdempotencyService.revertProviderInvocationBeforeStart(
                  claim
                );
              if (reverted !== 'transitioned') {
                throw new MessageUpdatePublishFailedError(
                  new Error(
                    `notification_send_idempotency_provider_start_revert_${reverted}`
                  )
                );
              }
              providerInvoked = false;
              throw error;
            }
          })();
        }
        return providerInvocationPromise;
      };
    beforeProviderInvoke.assertActive = assertDispatchActive;
    beforeProviderInvoke.onStartRejected = async (): Promise<void> => {
      if (!providerInvoked) {
        return;
      }
      const reverted =
        await this.messageSendIdempotencyService.revertProviderInvocationBeforeStart(
          claim
        );
      if (reverted !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(
            `notification_send_idempotency_provider_start_revert_${reverted}`
          )
        );
      }
      providerInvoked = false;
    };

    let providerOutcomePersisted = false;
    try {
      assertDispatchActive();
      await this.sendNotificationMessage(data, target, beforeProviderInvoke);
      if (!providerInvoked) {
        throw new Error('notification_send_provider_boundary_not_reached');
      }
      const succeeded = await this.messageSendIdempotencyService.markSucceeded(
        claim,
        succeededRecovery
      );
      if (succeeded !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(`notification_send_idempotency_succeeded_${succeeded}`)
        );
      }
      providerOutcomePersisted = true;

      const projectionPublished = this.hasPhoneJidProjection(succeededRecovery);
      await this.sendPhoneJidRecoveryRequest(
        succeededRecovery,
        target.connectionScope,
        assertDispatchActive
      );
      if (projectionPublished) {
        await this.compactTerminalRecovery(
          claim,
          'succeeded',
          succeededRecovery
        );
      }
    } catch (error) {
      if (providerOutcomePersisted) {
        if (isMessageUpdatePublishFailedError(error)) {
          throw error;
        }
        throw new MessageUpdatePublishFailedError(error);
      }
      if (providerInvoked) {
        await this.terminalizeAmbiguousNotificationSend(
          claim,
          error,
          ambiguousRecovery
        );
        if (isKafkaConsumerDispatchRevokedError(error)) {
          throw error;
        }
        return;
      } else if (!providerInvocationTransitionUncertain) {
        await this.messageSendIdempotencyService
          .releaseReservation(claim)
          .catch(() => undefined);
      }
      if (isMessageUpdatePublishFailedError(error)) {
        throw error;
      }
      if (!providerInvoked && isProviderInvocationInFlightError(error)) {
        throw new MessageUpdatePublishFailedError(error);
      }
      if (!providerInvoked && this.isRuntimeFenceUnavailableError(error)) {
        throw new MessageUpdatePublishFailedError(error);
      }
      // The parser/target resolver has already terminally rejected malformed
      // payloads and invalid destinations. Any remaining failure before the
      // provider boundary is client/SDK/infrastructure availability and must
      // be redriven without acknowledging the JetStream command.
      throw new MessageUpdatePublishFailedError(error);
    }
  }

  private buildNotificationAmbiguousRecovery(
    data: INotificationMessage,
    claim: Pick<
      Extract<MessageSendClaimResult, { status: 'acquired' | 'duplicate' }>,
      'accountId' | 'operationId'
    >
  ): INotificationSendAmbiguousRecovery {
    return buildNotificationSendAmbiguousRecovery({
      provider: 'wwebjs',
      operationId: claim.operationId,
      notificationId: data.notification_id,
      destination: this.buildNotificationDestination(data),
      accountId: claim.accountId,
      workerId: wwebjsEnvironment.wwebjsWorkerId,
    });
  }

  private buildNotificationSucceededRecovery(
    data: INotificationMessage,
    claim: Pick<
      Extract<MessageSendClaimResult, { status: 'acquired' | 'duplicate' }>,
      'accountId' | 'operationId'
    >,
    target: {
      jid: string;
      resolvedFromPhone: boolean;
    }
  ): INotificationPhoneJidRecovery {
    const userId =
      target.resolvedFromPhone && this.isNonEmptyString(data.user_id)
        ? data.user_id
        : null;
    return buildNotificationPhoneJidRecovery({
      provider: 'wwebjs',
      operationId: claim.operationId,
      notificationId: data.notification_id,
      destination: this.buildNotificationDestination(data),
      accountId: claim.accountId,
      workerId: wwebjsEnvironment.wwebjsWorkerId,
      userId,
      phoneJid: userId ? target.jid : null,
    });
  }

  private normalizeNotificationSucceededRecovery(
    result: unknown,
    data: INotificationMessage,
    claim: Pick<
      Extract<MessageSendClaimResult, { status: 'duplicate' }>,
      'accountId' | 'operationId'
    >
  ): INotificationPhoneJidRecovery | null {
    if (!result || typeof result !== 'object') {
      return null;
    }
    const candidate = result as Partial<INotificationPhoneJidRecovery>;
    if (candidate.schema_version !== 'notification_phone_jid_recovery_v1') {
      return null;
    }
    const destination = this.buildNotificationDestination(data);
    const userId =
      destination.startsWith('phone:') && this.isNonEmptyString(data.user_id)
        ? data.user_id
        : null;
    if (
      (userId !== null && typeof candidate.phone_jid !== 'string') ||
      candidate.user_id !== userId
    ) {
      console.error(
        '[NotificationMessageSendWwebjs] Invalid succeeded phone-JID recovery discarded'
      );
      return null;
    }
    const recovery = normalizeNotificationPhoneJidRecovery(result, {
      provider: 'wwebjs',
      operationId: claim.operationId,
      notificationId: data.notification_id,
      destination,
      accountId: claim.accountId,
      workerId: wwebjsEnvironment.wwebjsWorkerId,
      userId,
      phoneJid: userId ? candidate.phone_jid : null,
    });
    if (!recovery) {
      console.error(
        '[NotificationMessageSendWwebjs] Conflicting succeeded phone-JID recovery discarded'
      );
    }
    return recovery;
  }

  private async recoverDuplicateNotificationSend(
    claim: Extract<MessageSendClaimResult, { status: 'duplicate' }>,
    data: INotificationMessage,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void
  ): Promise<void> {
    if (claim.state === 'reserved' || claim.state === 'provider_invoked') {
      throw new MessageUpdatePublishFailedError(
        new Error(`notification_send_idempotency_${claim.state}`)
      );
    }
    if (claim.state === 'succeeded') {
      const recovery = this.normalizeNotificationSucceededRecovery(
        claim.result,
        data,
        claim
      );
      if (recovery) {
        const projectionPublished = this.hasPhoneJidProjection(recovery);
        await this.sendPhoneJidRecoveryRequest(
          recovery,
          connectionScope,
          assertDispatchActive
        );
        if (projectionPublished) {
          await this.compactTerminalRecovery(claim, 'succeeded', claim.result);
        }
      }
      return;
    }
    if (claim.state !== 'ambiguous') {
      return;
    }

    const expected = this.buildNotificationAmbiguousRecovery(data, claim);
    const recovery = normalizeNotificationSendAmbiguousRecovery(claim.result, {
      provider: expected.provider,
      operationId: expected.operation_id,
      notificationId: expected.notification_id,
      destination: expected.destination,
      accountId: expected.account_id,
      workerId: expected.worker_id,
    });
    if (!recovery) {
      const legacyRecovery =
        await this.messageSendIdempotencyService.recoverLegacyAmbiguous(
          claim,
          expected,
          this.buildNotificationClaimMeta(data),
          [
            'runtime_generation',
            'connection_epoch',
            'consumer_assignment_epoch',
          ]
        );
      if (legacyRecovery === 'transitioned') {
        return;
      }
      if (legacyRecovery === 'identity_conflict') {
        console.error(
          '[NotificationMessageSendWwebjs] Legacy ambiguous recovery identity conflict discarded',
          {
            notification_id: data.notification_id,
            destination: this.buildNotificationDestination(data),
            operation_id: claim.operationId,
          }
        );
        return;
      }
      throw new MessageUpdatePublishFailedError(
        new Error(`notification_send_${claim.state}_recovery_${legacyRecovery}`)
      );
    }
  }

  private async terminalizeAmbiguousNotificationSend(
    claim: Extract<MessageSendClaimResult, { status: 'acquired' }>,
    error: unknown,
    recovery: INotificationSendAmbiguousRecovery
  ): Promise<void> {
    try {
      const transition = await this.messageSendIdempotencyService.markAmbiguous(
        claim,
        error,
        recovery
      );
      if (transition !== 'transitioned') {
        throw new MessageUpdatePublishFailedError(
          new Error(`notification_send_idempotency_ambiguous_${transition}`)
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
        new Error(`notification_send_idempotency_compaction_${compacted}`)
      );
    }
  }

  private async sendNotificationMessage(
    data: INotificationMessage,
    target: {
      jid: string;
      resolvedFromPhone: boolean;
      connectionScope: IWhatsappRuntimeFence;
    },
    beforeProviderInvoke: () => Promise<void>
  ): Promise<void> {
    await this.wwebjsMessageTextService.sendText(
      target.jid,
      data.message_whatsapp ?? '',
      undefined,
      beforeProviderInvoke
    );
  }

  private async resolveNotificationTarget(
    data: INotificationMessage,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void = () => undefined
  ): Promise<{
    jid: string;
    resolvedFromPhone: boolean;
    connectionScope: IWhatsappRuntimeFence;
  } | null> {
    const remoteJid = data.message_key?.remote_jid?.trim();
    if (this.isValidRemoteJid(remoteJid)) {
      return {
        jid: remoteJid,
        resolvedFromPhone: false,
        connectionScope,
      };
    }

    assertDispatchActive();
    const result = await this.wwebjsPhoneValidationService.validatePhone(
      data.message_key.phone_ddi,
      data.message_key.phone_number
    );
    assertDispatchActive();

    if (!result.valid || !result.jid) return null;
    await this.assertConnectionScopeActive(
      connectionScope,
      assertDispatchActive
    );

    return {
      jid: result.jid,
      resolvedFromPhone: true,
      connectionScope,
    };
  }

  private buildNotificationDestination(data: INotificationMessage): string {
    const remoteJid = data.message_key?.remote_jid?.trim();
    if (this.isValidRemoteJid(remoteJid)) {
      return `jid:${remoteJid}`;
    }

    const phoneDdi = data.message_key?.phone_ddi?.trim();
    const phoneNumber = data.message_key?.phone_number?.trim();
    if (phoneDdi && phoneNumber) {
      return `phone:${phoneDdi}:${phoneNumber}`;
    }

    return '';
  }

  private buildNotificationQueueKey(data: INotificationMessage): string {
    const destination = this.buildNotificationDestination(data);
    if (destination) {
      const accountId = data.account?.id?.trim() ?? 'unknown';
      return `chat:${accountId}:${destination}`;
    }

    return `notification:${data.notification_id?.trim() || 'unknown'}`;
  }

  private buildNotificationOperationId(data: INotificationMessage): string {
    const operationId = data.operation_id?.trim();
    if (operationId) {
      return operationId;
    }

    const notificationId = data.notification_id?.trim() ?? '';
    const destination = this.buildNotificationDestination(data);
    return `${notificationId}\0${destination}`;
  }

  private async claimNotificationSendAttempt(
    data: INotificationMessage,
    connectionScope: IWhatsappRuntimeFence,
    consumerAssignmentEpoch?: number
  ): Promise<MessageSendClaimResult | null> {
    let accountId = data.account?.id?.trim();
    if (!accountId) {
      try {
        accountId = wwebjsEnvironment.wwebjsAccountId.trim();
      } catch {
        return null;
      }
    }
    const notificationId = data.notification_id?.trim();
    const destination = this.buildNotificationDestination(data);

    if (!accountId || !notificationId || !destination) {
      return null;
    }

    return this.messageSendIdempotencyService.claimOperation({
      accountId,
      operationType: 'notification',
      operationId: this.buildNotificationOperationId(data),
      meta: this.buildNotificationClaimMeta(
        data,
        connectionScope,
        consumerAssignmentEpoch
      ),
      runtimeFenceKey: WhatsappRuntimeFenceService.key(
        connectionScope.worker_id
      ),
    });
  }

  private buildNotificationClaimMeta(
    data: INotificationMessage,
    connectionScope?: IWhatsappRuntimeFence,
    consumerAssignmentEpoch?: number
  ): Record<string, unknown> {
    return {
      provider: 'wwebjs',
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      notification_id: data.notification_id?.trim(),
      destination: this.buildNotificationDestination(data),
      ...(connectionScope
        ? {
            runtime_generation: connectionScope.runtime_generation,
            connection_epoch: connectionScope.connection_epoch,
            consumer_assignment_epoch: consumerAssignmentEpoch,
          }
        : {}),
    };
  }

  private async sendPhoneJidRecoveryRequest(
    recovery: INotificationPhoneJidRecovery,
    connectionScope: IWhatsappRuntimeFence,
    assertDispatchActive: () => void = () => undefined
  ): Promise<void> {
    if (
      !recovery.user_id ||
      !recovery.phone_jid ||
      !recovery.phone_jid_event_id
    ) {
      return;
    }
    try {
      assertDispatchActive();
      const currentScope =
        await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
      assertDispatchActive();
      if (
        !this.connectionScopesMatch(connectionScope, currentScope) ||
        connectionScope.worker_id !== recovery.worker_id ||
        connectionScope.source_provider !== recovery.provider
      ) {
        throw new Error('notification_send_runtime_fence_revoked');
      }

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.userPhoneJidUpdate(),
        {
          user_id: recovery.user_id,
          phone_jid: recovery.phone_jid,
          account_id: recovery.account_id,
          worker_id: recovery.worker_id,
          operation_id: recovery.operation_id,
          event_id: recovery.phone_jid_event_id,
          source_provider: connectionScope.source_provider,
          runtime_generation: connectionScope.runtime_generation,
          connection_epoch: connectionScope.connection_epoch,
        },
        recovery.user_id,
        undefined,
        assertDispatchActive
      );
      assertDispatchActive();
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

  private hasPhoneJidProjection(
    recovery: INotificationPhoneJidRecovery
  ): boolean {
    return Boolean(
      recovery.user_id && recovery.phone_jid && recovery.phone_jid_event_id
    );
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

  private async captureActiveConnectionScope(
    assertDispatchActive: () => void
  ): Promise<IWhatsappRuntimeFence | null> {
    try {
      assertDispatchActive();
      const scope =
        await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
      assertDispatchActive();
      return scope;
    } catch (error) {
      if (isKafkaConsumerDispatchRevokedError(error)) {
        throw error;
      }
      throw isMessageUpdatePublishFailedError(error)
        ? error
        : new MessageUpdatePublishFailedError(error);
    }
  }

  private async assertConnectionScopeActive(
    expected: IWhatsappRuntimeFence,
    assertDispatchActive: () => void
  ): Promise<void> {
    assertDispatchActive();
    const current =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    assertDispatchActive();
    if (!this.connectionScopesMatch(expected, current)) {
      throw new Error('notification_send_runtime_fence_revoked');
    }
  }

  private isRuntimeFenceUnavailableError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message === 'notification_send_runtime_fence_revoked'
    );
  }
}
