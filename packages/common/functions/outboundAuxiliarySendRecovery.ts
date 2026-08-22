import { createHash } from 'node:crypto';

export type AuxiliaryWhatsappProvider = 'baileys' | 'wwebjs' | 'official';

export interface INotificationSendAmbiguousRecovery {
  schema_version: 'notification_send_ambiguous_recovery_v1';
  provider: AuxiliaryWhatsappProvider;
  operation_id: string;
  notification_id: string;
  destination: string;
  account_id: string;
  worker_id: string;
  outcome_digest: string;
}

export interface IScheduleSendAmbiguousRecovery {
  schema_version: 'schedule_send_ambiguous_recovery_v1';
  provider: AuxiliaryWhatsappProvider;
  operation_id: string;
  schedule_id: string;
  contact_id: string;
  message_id: string;
  attempt_id: string;
  account_id: string;
  worker_id: string;
  outcome_digest: string;
}

interface INotificationSendAmbiguousRecoveryInput {
  provider: AuxiliaryWhatsappProvider;
  operationId: string;
  notificationId: string;
  destination: string;
  accountId: string;
  workerId: string;
}

interface IScheduleSendAmbiguousRecoveryInput {
  provider: AuxiliaryWhatsappProvider;
  operationId: string;
  scheduleId: string;
  contactId: string;
  messageId: string;
  attemptId: string;
  accountId: string;
  workerId: string;
}

function normalized(value: string): string {
  return value.trim();
}

function outcomeDigest(schemaVersion: string, values: string[]): string {
  return createHash('sha256')
    .update([schemaVersion, ...values.map(normalized)].join('\0'))
    .digest('hex');
}

export function buildNotificationSendAmbiguousRecovery(
  input: INotificationSendAmbiguousRecoveryInput
): INotificationSendAmbiguousRecovery {
  const recovery = {
    schema_version: 'notification_send_ambiguous_recovery_v1' as const,
    provider: input.provider,
    operation_id: normalized(input.operationId),
    notification_id: normalized(input.notificationId),
    destination: normalized(input.destination),
    account_id: normalized(input.accountId),
    worker_id: normalized(input.workerId),
  };

  return {
    ...recovery,
    outcome_digest: outcomeDigest(recovery.schema_version, [
      recovery.provider,
      recovery.operation_id,
      recovery.notification_id,
      recovery.destination,
      recovery.account_id,
      recovery.worker_id,
    ]),
  };
}

export function normalizeNotificationSendAmbiguousRecovery(
  value: unknown,
  expectedInput: INotificationSendAmbiguousRecoveryInput
): INotificationSendAmbiguousRecovery | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const expected = buildNotificationSendAmbiguousRecovery(expectedInput);
  const candidate = value as Partial<INotificationSendAmbiguousRecovery>;
  return candidate.schema_version === expected.schema_version &&
    candidate.provider === expected.provider &&
    candidate.operation_id === expected.operation_id &&
    candidate.notification_id === expected.notification_id &&
    candidate.destination === expected.destination &&
    candidate.account_id === expected.account_id &&
    candidate.worker_id === expected.worker_id &&
    candidate.outcome_digest === expected.outcome_digest
    ? expected
    : null;
}

export function buildScheduleSendAmbiguousRecovery(
  input: IScheduleSendAmbiguousRecoveryInput
): IScheduleSendAmbiguousRecovery {
  const recovery = {
    schema_version: 'schedule_send_ambiguous_recovery_v1' as const,
    provider: input.provider,
    operation_id: normalized(input.operationId),
    schedule_id: normalized(input.scheduleId),
    contact_id: normalized(input.contactId),
    message_id: normalized(input.messageId),
    attempt_id: normalized(input.attemptId),
    account_id: normalized(input.accountId),
    worker_id: normalized(input.workerId),
  };

  return {
    ...recovery,
    outcome_digest: outcomeDigest(recovery.schema_version, [
      recovery.provider,
      recovery.operation_id,
      recovery.schedule_id,
      recovery.contact_id,
      recovery.message_id,
      recovery.attempt_id,
      recovery.account_id,
      recovery.worker_id,
    ]),
  };
}

export function normalizeScheduleSendAmbiguousRecovery(
  value: unknown,
  expectedInput: IScheduleSendAmbiguousRecoveryInput
): IScheduleSendAmbiguousRecovery | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const expected = buildScheduleSendAmbiguousRecovery(expectedInput);
  const candidate = value as Partial<IScheduleSendAmbiguousRecovery>;
  if (
    typeof candidate.attempt_id !== 'string' ||
    candidate.attempt_id.trim().length === 0
  ) {
    return null;
  }
  const canonicalCandidate = buildScheduleSendAmbiguousRecovery({
    provider: candidate.provider ?? expected.provider,
    operationId: candidate.operation_id ?? '',
    scheduleId: candidate.schedule_id ?? '',
    contactId: candidate.contact_id ?? '',
    messageId: candidate.message_id ?? '',
    attemptId: candidate.attempt_id,
    accountId: candidate.account_id ?? '',
    workerId: candidate.worker_id ?? '',
  });

  return candidate.schema_version === expected.schema_version &&
    candidate.provider === expected.provider &&
    candidate.operation_id === expected.operation_id &&
    candidate.schedule_id === expected.schedule_id &&
    candidate.contact_id === expected.contact_id &&
    candidate.message_id === expected.message_id &&
    candidate.account_id === expected.account_id &&
    candidate.worker_id === expected.worker_id &&
    candidate.outcome_digest === canonicalCandidate.outcome_digest
    ? canonicalCandidate
    : null;
}
