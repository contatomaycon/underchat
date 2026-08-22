import { createHash } from 'node:crypto';
import {
  WORKER_DEFERRED_READY_SUBJECT_PREFIX,
  WORKER_DEFERRED_SCHEDULE_SUBJECT_PREFIX,
} from '@core/common/constants/workerCommandTransport';
import { workerCommandSubject } from '@core/common/functions/workerCommandEnvelope';

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export interface WorkerCommandDeferredIdentity {
  workerId: string;
  scheduleId: string;
  scheduleSubject: string;
  readySubject: string;
  scheduleMessageId: string;
  relayMessageId: string;
}

export function workerCommandDeferredIdentity(
  workerId: string,
  commandId: string,
  sourceStreamSequence: number
): WorkerCommandDeferredIdentity {
  // Reuse the command-subject validator so worker tokens stay interoperable
  // across the commands, schedules and ready subjects.
  workerCommandSubject(workerId);
  const normalizedCommandId = commandId.trim();
  if (!normalizedCommandId || normalizedCommandId !== commandId) {
    throw new Error('worker_command_deferred_command_id_invalid');
  }
  if (!Number.isSafeInteger(sourceStreamSequence) || sourceStreamSequence < 1) {
    throw new Error('worker_command_deferred_source_sequence_invalid');
  }
  const scheduleId = createHash('sha256')
    .update(`${commandId}:${sourceStreamSequence}`)
    .digest('hex');
  return {
    workerId,
    scheduleId,
    scheduleSubject: `${WORKER_DEFERRED_SCHEDULE_SUBJECT_PREFIX}.${workerId}.${scheduleId}`,
    readySubject: `${WORKER_DEFERRED_READY_SUBJECT_PREFIX}.${workerId}`,
    scheduleMessageId: `worker-deferred-schedule-v1:${scheduleId}`,
    relayMessageId: `worker-deferred-relay-v1:${scheduleId}`,
  };
}

export function parseWorkerCommandDeferredReadySubject(
  subject: string
): string | null {
  const prefix = `${WORKER_DEFERRED_READY_SUBJECT_PREFIX}.`;
  if (!subject.startsWith(prefix)) return null;
  const workerId = subject.slice(prefix.length);
  if (!workerId || workerId.includes('.')) return null;
  try {
    workerCommandSubject(workerId);
    return workerId;
  } catch {
    return null;
  }
}

export function parseWorkerCommandDeferredScheduleSubject(
  subject: string,
  expectedWorkerId: string
): WorkerCommandDeferredIdentity | null {
  const prefix = `${WORKER_DEFERRED_SCHEDULE_SUBJECT_PREFIX}.${expectedWorkerId}.`;
  if (!subject.startsWith(prefix)) return null;
  const scheduleId = subject.slice(prefix.length);
  if (!SHA256_HEX.test(scheduleId)) return null;
  try {
    workerCommandSubject(expectedWorkerId);
  } catch {
    return null;
  }
  return {
    workerId: expectedWorkerId,
    scheduleId,
    scheduleSubject: subject,
    readySubject: `${WORKER_DEFERRED_READY_SUBJECT_PREFIX}.${expectedWorkerId}`,
    scheduleMessageId: `worker-deferred-schedule-v1:${scheduleId}`,
    relayMessageId: `worker-deferred-relay-v1:${scheduleId}`,
  };
}
