import { createHash } from 'node:crypto';
import { buildMessageUpdateKafkaKey } from './messageUpdateIdentity';
import {
  buildScheduleStatusKafkaKey,
  ensureScheduleStatusEventId,
} from './scheduleStatusIdentity';
import { canonicalMessageStatusMessageId } from './messageStatusIdentity';
import type { MessageSendOperationType } from '@core/services/messageSendIdempotency.service';

export const MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS = Object.freeze({
  updateMessage: 'update.message',
  updateMessageStatus: 'update.message.status',
  upsertMessage: 'upsert.message',
  scheduleStatusUpdate: 'schedule.status.update',
  updateProfileStatusExternalId: 'update.profile.status.external.id',
  userPhoneJidUpdate: 'user.phone.jid.update',
});

const ALLOWED_TOPICS = new Set<string>(
  Object.values(MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS)
);

export type MessageSendRecoveryOperationalState =
  'pre_provider_failed' | 'provider_rejected' | 'ambiguous' | 'succeeded';

export interface IMessageSendRecoveryKafkaPublicationV1 {
  kind: 'kafka_publication_v1';
  publication_id: string;
  topic: string;
  key: string;
  payload: Record<string, unknown>;
}

export interface IMessageSendRecoveryScheduleStateV1 {
  kind: 'schedule_operational_state_v1';
  step_id: string;
  schedule_id: string;
  account_id: string;
  worker_id: string;
  message_id: string;
  attempt_id: string;
  ledger_operation_id: string;
  state: MessageSendRecoveryOperationalState;
}

export type MessageSendRecoveryStepV1 =
  IMessageSendRecoveryScheduleStateV1 | IMessageSendRecoveryKafkaPublicationV1;

export interface IMessageSendRecoveryLaneV1 {
  account_id: string;
  worker_id: string;
  entity_key: string;
  operation_id: string;
  command_id: string;
}

interface IMessageSendRecoveryPlanBaseV1 {
  schema_version: 'message_send_global_recovery_v1';
  account_id: string;
  worker_id: string;
  operation_type: MessageSendOperationType;
  operation_id: string;
  terminal_state: 'succeeded' | 'failed' | 'expired' | 'ambiguous';
  lane: IMessageSendRecoveryLaneV1 | null;
  created_at: string;
  steps: MessageSendRecoveryStepV1[];
}

/**
 * All durable effects needed by the Baileys/WWebJS worker outcome are
 * represented by the steps, so a recovery drainer may compact the ledger
 * after every step has completed and every Kafka delivery has been acked.
 */
export interface IMessageSendWorkerRecoveryPlanV1 extends IMessageSendRecoveryPlanBaseV1 {
  kind: 'worker_global_publications_v1';
}

/**
 * Official WhatsApp also has database/window/annotation effects owned by its
 * Kafka handler. The drainer may restore the listed global projections, but
 * must leave the ledger payload for the source-handler redelivery to finish
 * those effects and compact it.
 */
export interface IMessageSendOfficialHandlerRecoveryPlanV1 extends IMessageSendRecoveryPlanBaseV1 {
  kind: 'official_handler_recovery_v1';
}

export type MessageSendRecoveryPlanV1 =
  IMessageSendWorkerRecoveryPlanV1 | IMessageSendOfficialHandlerRecoveryPlanV1;

export interface IMessageSendRecoveryPlanBuildInput {
  accountId: string;
  operationType: MessageSendOperationType;
  operationId: string;
  expectedState: string;
  targetState: string;
  recovery: unknown;
  meta?: Record<string, unknown>;
  lane?: {
    accountId: string;
    workerId: string;
    entityKey: string;
    operationId: string;
    commandId: string;
  } | null;
  now?: Date;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function publicationId(
  topic: string,
  key: string,
  payload: Record<string, unknown>
): string {
  return `message_send_recovery_v1_${createHash('sha256')
    .update([topic, key, JSON.stringify(payload)].join('\0'))
    .digest('hex')}`;
}

function scheduleStepId(input: {
  schedule_id: string;
  account_id: string;
  worker_id: string;
  message_id: string;
  attempt_id: string;
  ledger_operation_id: string;
  state: MessageSendRecoveryOperationalState;
}): string {
  return `message_send_schedule_recovery_v1_${createHash('sha256')
    .update(
      [
        input.schedule_id,
        input.account_id,
        input.worker_id,
        input.message_id,
        input.attempt_id,
        input.ledger_operation_id,
        input.state,
      ].join('\0')
    )
    .digest('hex')}`;
}

function messageStatusKey(payload: Record<string, unknown>): string | null {
  const accountId = text(payload.account_id);
  const workerId = text(payload.worker_id);
  const messageId = text(payload.message_id);
  if (!accountId || !messageId) {
    return null;
  }
  return workerId
    ? `${accountId}:${workerId}:${canonicalMessageStatusMessageId(messageId) ?? messageId}`
    : `${accountId}:${canonicalMessageStatusMessageId(messageId) ?? messageId}`;
}

function providerFrom(input: IMessageSendRecoveryPlanBuildInput): string {
  const recovery = record(input.recovery);
  return (
    text(input.meta?.provider) ??
    text(recovery?.provider) ??
    (recovery?.schema_version === 'official_whatsapp_send_recovery_v1'
      ? 'official-whatsapp'
      : '')
  );
}

function workerIdFrom(input: IMessageSendRecoveryPlanBuildInput): string {
  const recovery = record(input.recovery);
  const candidates = [
    input.meta?.worker_id,
    recovery?.worker_id,
    input.lane?.workerId,
    record(recovery?.status_update)?.worker_id,
    record(recovery?.message_status_update)?.worker_id,
    record(recovery?.schedule_status_update)?.worker_id,
    record(recovery?.update_message)?.worker_id,
    record(record(recovery?.update_message)?.data)?.worker,
  ];
  for (const candidate of candidates) {
    const nested = record(candidate);
    const value = text(nested?.id) ?? text(candidate);
    if (value) return value;
  }
  return '';
}

function addPublication(
  steps: MessageSendRecoveryStepV1[],
  seen: Set<string>,
  topic: string,
  key: string | null,
  payload: unknown
): void {
  const normalizedPayload = record(payload);
  const normalizedKey = text(key);
  if (!ALLOWED_TOPICS.has(topic) || !normalizedKey || !normalizedPayload) {
    return;
  }
  const id = publicationId(topic, normalizedKey, normalizedPayload);
  if (seen.has(id)) return;
  seen.add(id);
  steps.push({
    kind: 'kafka_publication_v1',
    publication_id: id,
    topic,
    key: normalizedKey,
    payload: normalizedPayload,
  });
}

function scheduleStateFor(
  expectedState: string,
  targetState: string
): MessageSendRecoveryOperationalState | null {
  if (targetState === 'succeeded') return 'succeeded';
  if (targetState === 'ambiguous') return 'ambiguous';
  if (targetState === 'failed') {
    return expectedState === 'provider_invoked'
      ? 'provider_rejected'
      : 'pre_provider_failed';
  }
  return null;
}

export function buildMessageSendRecoveryPlan(
  input: IMessageSendRecoveryPlanBuildInput
): MessageSendRecoveryPlanV1 | null {
  const accountId = text(input.accountId);
  const operationId = text(input.operationId);
  const workerId = workerIdFrom(input);
  if (!accountId || !operationId || !/^[A-Za-z0-9._-]{1,128}$/u.test(workerId))
    return null;

  const recovery = record(input.recovery);
  const steps: MessageSendRecoveryStepV1[] = [];
  const seen = new Set<string>();
  const createdAt = (input.now ?? new Date()).toISOString();
  const terminalState =
    input.targetState === 'provider_invoked' ? 'ambiguous' : input.targetState;
  if (
    !['succeeded', 'failed', 'expired', 'ambiguous'].includes(terminalState)
  ) {
    return null;
  }
  const lane: IMessageSendRecoveryLaneV1 | null = input.lane
    ? {
        account_id: text(input.lane.accountId) ?? '',
        worker_id: text(input.lane.workerId) ?? '',
        entity_key: text(input.lane.entityKey) ?? '',
        operation_id: text(input.lane.operationId) ?? '',
        command_id: text(input.lane.commandId) ?? '',
      }
    : null;
  if (
    lane &&
    (lane.account_id !== accountId ||
      lane.worker_id !== workerId ||
      lane.operation_id !== operationId ||
      !lane.entity_key ||
      Buffer.byteLength(lane.entity_key, 'utf8') > 1024 ||
      !lane.command_id)
  ) {
    return null;
  }

  if (input.operationType === 'schedule') {
    const scheduleId =
      text(input.meta?.schedule_id) ?? text(recovery?.schedule_id);
    const messageId =
      text(input.meta?.message_id) ?? text(recovery?.message_id) ?? operationId;
    const attemptId =
      text(input.meta?.attempt_id) ??
      text(recovery?.attempt_id) ??
      text(record(recovery?.schedule_status_update)?.attempt_id) ??
      `legacy:${messageId}`;
    const operationalState = scheduleStateFor(
      input.expectedState,
      input.targetState
    );
    if (scheduleId && operationalState) {
      const scheduleStep = {
        kind: 'schedule_operational_state_v1',
        schedule_id: scheduleId,
        account_id: accountId,
        worker_id: workerId,
        message_id: messageId,
        attempt_id: attemptId,
        ledger_operation_id: operationId,
        state: operationalState,
      } as const;
      steps.push({
        ...scheduleStep,
        step_id: scheduleStepId(scheduleStep),
      });
    }
  }

  const updateMessage = record(recovery?.update_message);
  if (updateMessage) {
    addPublication(
      steps,
      seen,
      MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.updateMessage,
      buildMessageUpdateKafkaKey(updateMessage as never),
      updateMessage
    );
  }

  if (
    recovery?.schema_version === 'call_auto_reply_system_upsert_recovery_v1'
  ) {
    addPublication(
      steps,
      seen,
      MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.upsertMessage,
      text(recovery.kafka_key),
      recovery.call_auto_reply_system_upsert
    );
  }

  for (const statusPayload of [
    recovery?.status_update,
    recovery?.message_status_update,
  ]) {
    const status = record(statusPayload);
    addPublication(
      steps,
      seen,
      MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.updateMessageStatus,
      status ? messageStatusKey(status) : null,
      status
    );
  }

  let scheduleStatus = record(recovery?.schedule_status_update);
  if (
    !scheduleStatus &&
    input.operationType === 'schedule' &&
    (input.targetState === 'succeeded' || input.targetState === 'failed')
  ) {
    const scheduleId =
      text(input.meta?.schedule_id) ?? text(recovery?.schedule_id);
    const contactId =
      text(input.meta?.contact_id) ?? text(recovery?.contact_id);
    const messageId =
      text(input.meta?.message_id) ?? text(recovery?.message_id) ?? operationId;
    if (scheduleId && contactId) {
      scheduleStatus = {
        attempt_id:
          text(input.meta?.attempt_id) ??
          text(recovery?.attempt_id) ??
          `legacy:${messageId}`,
        account_id: accountId,
        worker_id: workerId,
        source_provider:
          providerFrom(input) === 'official-whatsapp'
            ? 'official_whatsapp'
            : providerFrom(input),
        schedule_id: scheduleId,
        contact_id: contactId,
        message_id: messageId,
        processed_at: createdAt,
        status: input.targetState === 'succeeded' ? 'sent' : 'failed',
      };
      ensureScheduleStatusEventId(scheduleStatus as never);
    }
  }
  addPublication(
    steps,
    seen,
    MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.scheduleStatusUpdate,
    scheduleStatus
      ? buildScheduleStatusKafkaKey(scheduleStatus as never)
      : null,
    scheduleStatus
  );

  if (recovery?.schema_version === 'profile_status_external_id_recovery_v1') {
    const payload = {
      worker_profile_status_id: recovery.worker_profile_status_id,
      external_id: recovery.external_id,
      event_id: recovery.event_id,
      account_id: recovery.account_id,
      worker_id: recovery.worker_id,
      source_provider: recovery.provider,
      runtime_generation: input.meta?.runtime_generation,
      connection_epoch: input.meta?.connection_epoch,
    };
    addPublication(
      steps,
      seen,
      MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.updateProfileStatusExternalId,
      text(recovery.kafka_key),
      payload
    );
  }

  if (
    recovery?.schema_version === 'notification_phone_jid_recovery_v1' &&
    text(recovery.user_id) &&
    text(recovery.phone_jid) &&
    text(recovery.phone_jid_event_id)
  ) {
    addPublication(
      steps,
      seen,
      MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.userPhoneJidUpdate,
      text(recovery.user_id),
      {
        user_id: recovery.user_id,
        phone_jid: recovery.phone_jid,
        account_id: recovery.account_id,
        worker_id: recovery.worker_id,
        operation_id: recovery.operation_id,
        event_id: recovery.phone_jid_event_id,
        source_provider: recovery.provider,
        runtime_generation: input.meta?.runtime_generation,
        connection_epoch: input.meta?.connection_epoch,
      }
    );
  }

  if (steps.length === 0 && !lane) return null;
  const official = providerFrom(input) === 'official-whatsapp';
  return {
    schema_version: 'message_send_global_recovery_v1',
    kind: official
      ? 'official_handler_recovery_v1'
      : 'worker_global_publications_v1',
    account_id: accountId,
    worker_id: workerId,
    operation_type: input.operationType,
    operation_id: operationId,
    terminal_state:
      terminalState as MessageSendRecoveryPlanV1['terminal_state'],
    lane,
    created_at: createdAt,
    steps,
  };
}

export function parseMessageSendRecoveryPlan(
  value: unknown
): MessageSendRecoveryPlanV1 | null {
  const candidate = record(value);
  if (
    candidate?.schema_version !== 'message_send_global_recovery_v1' ||
    (candidate.kind !== 'worker_global_publications_v1' &&
      candidate.kind !== 'official_handler_recovery_v1') ||
    !text(candidate.account_id) ||
    !text(candidate.worker_id) ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(String(candidate.worker_id)) ||
    !text(candidate.operation_id) ||
    !['succeeded', 'failed', 'expired', 'ambiguous'].includes(
      String(candidate.terminal_state)
    ) ||
    !['direct', 'schedule', 'notification', 'notification_email'].includes(
      String(candidate.operation_type)
    ) ||
    !text(candidate.created_at) ||
    !Array.isArray(candidate.steps) ||
    candidate.steps.length > 8
  ) {
    return null;
  }
  if (candidate.lane !== null) {
    const lane = record(candidate.lane);
    if (
      !lane ||
      text(lane.account_id) !== text(candidate.account_id) ||
      text(lane.worker_id) !== text(candidate.worker_id) ||
      text(lane.operation_id) !== text(candidate.operation_id) ||
      !text(lane.entity_key) ||
      Buffer.byteLength(String(lane.entity_key), 'utf8') > 1024 ||
      !text(lane.command_id)
    ) {
      return null;
    }
  }
  if (candidate.steps.length === 0 && candidate.lane === null) return null;

  for (const rawStep of candidate.steps) {
    const step = record(rawStep);
    if (!step) return null;
    if (step.kind === 'kafka_publication_v1') {
      const topic = text(step.topic);
      const key = text(step.key);
      const payload = record(step.payload);
      if (
        !topic ||
        !ALLOWED_TOPICS.has(topic) ||
        !key ||
        key.length > 512 ||
        !payload ||
        text(step.publication_id) !== publicationId(topic, key, payload)
      ) {
        return null;
      }
      continue;
    }
    if (
      step.kind !== 'schedule_operational_state_v1' ||
      !text(step.schedule_id) ||
      !text(step.account_id) ||
      !text(step.worker_id) ||
      !text(step.message_id) ||
      !text(step.attempt_id) ||
      !text(step.ledger_operation_id) ||
      ![
        'pre_provider_failed',
        'provider_rejected',
        'ambiguous',
        'succeeded',
      ].includes(String(step.state))
    ) {
      return null;
    }
    if (
      text(step.step_id) !==
      scheduleStepId(step as unknown as IMessageSendRecoveryScheduleStateV1)
    ) {
      return null;
    }
  }
  return value as MessageSendRecoveryPlanV1;
}
