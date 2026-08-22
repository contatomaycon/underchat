import { createHash } from 'node:crypto';
import { buildUserPhoneJidUpdateEventId } from '@core/common/functions/userPhoneJidUpdateIdentity';

export type ProviderCommandAuxiliaryProvider = 'baileys' | 'wwebjs';

interface IProfileStatusExternalIdRecoveryInput {
  provider: ProviderCommandAuxiliaryProvider;
  accountId: string;
  workerId: string;
  workerProfileStatusId: string;
  externalId: string;
}

export interface IProfileStatusExternalIdRecovery {
  schema_version: 'profile_status_external_id_recovery_v1';
  provider: ProviderCommandAuxiliaryProvider;
  account_id: string;
  worker_id: string;
  worker_profile_status_id: string;
  external_id: string;
  event_id: string;
  kafka_key: string;
  outcome_digest: string;
}

interface INotificationPhoneJidRecoveryInput {
  provider: ProviderCommandAuxiliaryProvider;
  operationId: string;
  notificationId: string;
  destination: string;
  accountId: string;
  workerId: string;
  userId?: string | null;
  phoneJid?: string | null;
}

export interface INotificationPhoneJidRecovery {
  schema_version: 'notification_phone_jid_recovery_v1';
  provider: ProviderCommandAuxiliaryProvider;
  operation_id: string;
  notification_id: string;
  destination: string;
  account_id: string;
  worker_id: string;
  user_id: string | null;
  phone_jid: string | null;
  phone_jid_event_id: string | null;
  outcome_digest: string;
}

function normalized(value: string): string {
  return value.trim();
}

function normalizedOptional(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function digest(schemaVersion: string, values: Array<string | null>): string {
  return createHash('sha256')
    .update([schemaVersion, ...values.map((value) => value ?? '')].join('\0'))
    .digest('hex');
}

export function buildProfileStatusExternalIdRecovery(
  input: IProfileStatusExternalIdRecoveryInput
): IProfileStatusExternalIdRecovery {
  const accountId = normalized(input.accountId);
  const workerId = normalized(input.workerId);
  const workerProfileStatusId = normalized(input.workerProfileStatusId);
  const externalId = normalized(input.externalId);
  const recovery = {
    schema_version: 'profile_status_external_id_recovery_v1' as const,
    provider: input.provider,
    account_id: accountId,
    worker_id: workerId,
    worker_profile_status_id: workerProfileStatusId,
    external_id: externalId,
    event_id: [
      'profile-status-external-id',
      'v1',
      accountId,
      workerId,
      workerProfileStatusId,
      externalId,
    ].join(':'),
    kafka_key: `${accountId}:${workerId}:${workerProfileStatusId}`,
  };
  return {
    ...recovery,
    outcome_digest: digest(recovery.schema_version, [
      recovery.provider,
      recovery.account_id,
      recovery.worker_id,
      recovery.worker_profile_status_id,
      recovery.external_id,
      recovery.event_id,
      recovery.kafka_key,
    ]),
  };
}

export function normalizeProfileStatusExternalIdRecovery(
  value: unknown,
  expectedInput: IProfileStatusExternalIdRecoveryInput
): IProfileStatusExternalIdRecovery | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const expected = buildProfileStatusExternalIdRecovery(expectedInput);
  const candidate = value as Partial<IProfileStatusExternalIdRecovery>;
  return candidate.schema_version === expected.schema_version &&
    candidate.provider === expected.provider &&
    candidate.account_id === expected.account_id &&
    candidate.worker_id === expected.worker_id &&
    candidate.worker_profile_status_id === expected.worker_profile_status_id &&
    candidate.external_id === expected.external_id &&
    candidate.event_id === expected.event_id &&
    candidate.kafka_key === expected.kafka_key &&
    candidate.outcome_digest === expected.outcome_digest
    ? expected
    : null;
}

export function buildNotificationPhoneJidRecovery(
  input: INotificationPhoneJidRecoveryInput
): INotificationPhoneJidRecovery {
  const accountId = normalized(input.accountId);
  const workerId = normalized(input.workerId);
  const operationId = normalized(input.operationId);
  const userId = normalizedOptional(input.userId);
  const phoneJid = normalizedOptional(input.phoneJid);
  const recovery = {
    schema_version: 'notification_phone_jid_recovery_v1' as const,
    provider: input.provider,
    operation_id: operationId,
    notification_id: normalized(input.notificationId),
    destination: normalized(input.destination),
    account_id: accountId,
    worker_id: workerId,
    user_id: userId,
    phone_jid: phoneJid,
    phone_jid_event_id:
      userId && phoneJid
        ? buildUserPhoneJidUpdateEventId({
            account_id: accountId,
            worker_id: workerId,
            operation_id: operationId,
            user_id: userId,
            phone_jid: phoneJid,
          })
        : null,
  };
  return {
    ...recovery,
    outcome_digest: digest(recovery.schema_version, [
      recovery.provider,
      recovery.operation_id,
      recovery.notification_id,
      recovery.destination,
      recovery.account_id,
      recovery.worker_id,
      recovery.user_id,
      recovery.phone_jid,
      recovery.phone_jid_event_id,
    ]),
  };
}

export function normalizeNotificationPhoneJidRecovery(
  value: unknown,
  expectedInput: INotificationPhoneJidRecoveryInput
): INotificationPhoneJidRecovery | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const expected = buildNotificationPhoneJidRecovery(expectedInput);
  const candidate = value as Partial<INotificationPhoneJidRecovery>;
  return candidate.schema_version === expected.schema_version &&
    candidate.provider === expected.provider &&
    candidate.operation_id === expected.operation_id &&
    candidate.notification_id === expected.notification_id &&
    candidate.destination === expected.destination &&
    candidate.account_id === expected.account_id &&
    candidate.worker_id === expected.worker_id &&
    candidate.user_id === expected.user_id &&
    candidate.phone_jid === expected.phone_jid &&
    candidate.phone_jid_event_id === expected.phone_jid_event_id &&
    candidate.outcome_digest === expected.outcome_digest
    ? expected
    : null;
}
