import { createHash } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import type { PermanentWorkerTopicDeletionRequest } from '@core/common/interfaces/IWorkerTopicLifecycle';

const DELETE_PROOF_FIELD = 'permanent_delete_proof_v1';
const DELETE_PROOF_FINALIZED_FIELD = 'permanent_delete_finalized_v1';
const DELETE_PROOF_VERSION = 1;
const DELETE_FINALIZER_PENDING_KEY =
  'underchat:worker:deletion-finalizer:pending:v1';
const DELETE_FINALIZER_QUARANTINE_KEY =
  'underchat:worker:deletion-finalizer:quarantine:v1';
const configuredCompletedProofRetentionSeconds = Number(
  process.env.WORKER_DELETION_PROOF_AUDIT_TTL_SECONDS
);
const COMPLETED_PROOF_RETENTION_SECONDS = Math.max(
  24 * 60 * 60,
  Number.isFinite(configuredCompletedProofRetentionSeconds) &&
    configuredCompletedProofRetentionSeconds > 0
    ? Math.floor(configuredCompletedProofRetentionSeconds)
    : 30 * 24 * 60 * 60
);

const STORE_DELETE_PROOF_SCRIPT = `
local finalized = redis.call('HGET', KEYS[1], ARGV[5])
if finalized then
  if finalized == ARGV[2] then
    return 2
  end
  return -1
end
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  if current == ARGV[2] then
    redis.call('PERSIST', KEYS[1])
    redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
    return 0
  end
  return -1
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PERSIST', KEYS[1])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
return 1
`;

const COMPLETE_DELETE_PROOF_SCRIPT = `
local pending_member = ARGV[1]
local expected_proof = ARGV[2]
local retention_seconds = tonumber(ARGV[3]) or 0
if not redis.call('ZSCORE', KEYS[2], pending_member) then
  return 0
end
local current_proof = redis.call('HGET', KEYS[1], ARGV[4])
if not current_proof or current_proof ~= expected_proof then
  return -1
end
local proof_ok, proof = pcall(cjson.decode, current_proof)
local pending_ok, pending = pcall(cjson.decode, pending_member)
if not proof_ok or not pending_ok
  or tostring(proof.worker_id or '') ~= tostring(pending.worker_id or '')
  or tostring(proof.account_id or '') ~= tostring(pending.account_id or '')
  or tostring(proof.operation_id or '') ~= tostring(pending.operation_id or '')
  or tostring(proof.action or '') ~= 'delete'
  or tostring(pending.action or '') ~= 'delete'
  or tonumber(proof.version) ~= 1
  or tonumber(pending.version) ~= 1 then
  return -2
end
if redis.call('ZREM', KEYS[2], pending_member) ~= 1 then
  return -3
end
redis.call('HSET', KEYS[1], ARGV[5], expected_proof)
if retention_seconds > 0 then
  redis.call('EXPIRE', KEYS[1], retention_seconds)
end
return 1
`;

const QUARANTINE_PENDING_ENTRY_SCRIPT = `
if redis.call('ZREM', KEYS[1], ARGV[1]) ~= 1 then
  return 0
end
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
return 1
`;

export interface PermanentWorkerDeletionProof {
  version: 1;
  worker_id: string;
  account_id: string;
  operation_id: string;
  action: 'delete';
  payload_sha256: string;
  payload: string;
}

interface PermanentWorkerDeletionPendingEntry {
  version: 1;
  worker_id: string;
  account_id: string;
  operation_id: string;
  action: 'delete';
}

export class WorkerDeletionProofError extends Error {
  constructor(readonly reason: string) {
    super(`worker_deletion_proof_invalid:${reason}`);
    this.name = 'WorkerDeletionProofError';
    Object.setPrototypeOf(this, WorkerDeletionProofError.prototype);
  }
}

export function workerLifecycleJournalKey(
  workerId: string,
  operationId: string
): string {
  return `underchat:worker:lifecycle:journal:v1:${workerId}:${operationId}`;
}

function payloadHash(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

@injectable()
export class WorkerDeletionProofService {
  constructor(
    @inject('Redis') private readonly redis: Redis | undefined = undefined
  ) {}

  async prepare(
    payload: IWorkerLifecycleQueueMessage,
    retentionTtlSeconds: number
  ): Promise<void> {
    // Kept in the public contract for callers that configure audit retention.
    // Pending proof is intentionally persistent; this TTL applies only after
    // atomic completion and must never be set during prepare.
    void retentionTtlSeconds;
    this.assertDeletionPayload(payload);
    const serializedPayload = JSON.stringify(payload);
    const proof: PermanentWorkerDeletionProof = {
      version: DELETE_PROOF_VERSION,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      operation_id: payload.operation_id,
      action: 'delete',
      payload_sha256: payloadHash(serializedPayload),
      payload: serializedPayload,
    };
    const pendingEntry: PermanentWorkerDeletionPendingEntry = {
      version: DELETE_PROOF_VERSION,
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      operation_id: payload.operation_id,
      action: 'delete',
    };
    const result = Number(
      await this.requiredRedis().eval(
        STORE_DELETE_PROOF_SCRIPT,
        2,
        workerLifecycleJournalKey(payload.worker_id, payload.operation_id),
        DELETE_FINALIZER_PENDING_KEY,
        DELETE_PROOF_FIELD,
        JSON.stringify(proof),
        String(Date.now()),
        JSON.stringify(pendingEntry),
        DELETE_PROOF_FINALIZED_FIELD
      )
    );

    if (result !== 0 && result !== 1 && result !== 2) {
      throw new WorkerDeletionProofError('immutable_conflict');
    }
  }

  async load(
    workerId: string,
    operationId: string
  ): Promise<IWorkerLifecycleQueueMessage | null> {
    const record = await this.loadRecord(workerId, operationId);
    return record?.payload ?? null;
  }

  private async loadRecord(
    workerId: string,
    operationId: string
  ): Promise<{
    payload: IWorkerLifecycleQueueMessage;
    serializedProof: string;
    proof: PermanentWorkerDeletionProof;
  } | null> {
    const stored = await this.requiredRedis().hget(
      workerLifecycleJournalKey(workerId, operationId),
      DELETE_PROOF_FIELD
    );
    if (!stored) {
      return null;
    }

    let proof: PermanentWorkerDeletionProof;
    try {
      proof = JSON.parse(stored) as PermanentWorkerDeletionProof;
    } catch {
      throw new WorkerDeletionProofError('malformed_record');
    }

    if (
      proof.version !== DELETE_PROOF_VERSION ||
      proof.worker_id !== workerId ||
      proof.operation_id !== operationId ||
      proof.action !== 'delete' ||
      typeof proof.account_id !== 'string' ||
      !proof.account_id ||
      typeof proof.payload !== 'string' ||
      typeof proof.payload_sha256 !== 'string' ||
      payloadHash(proof.payload) !== proof.payload_sha256
    ) {
      throw new WorkerDeletionProofError('record_integrity_mismatch');
    }

    let payload: IWorkerLifecycleQueueMessage;
    try {
      payload = JSON.parse(proof.payload) as IWorkerLifecycleQueueMessage;
    } catch {
      throw new WorkerDeletionProofError('malformed_payload');
    }
    this.assertDeletionPayload(payload);
    if (
      payload.worker_id !== proof.worker_id ||
      payload.account_id !== proof.account_id ||
      payload.operation_id !== proof.operation_id ||
      payload.action !== proof.action
    ) {
      throw new WorkerDeletionProofError('payload_identity_mismatch');
    }
    return { payload, serializedProof: stored, proof };
  }

  async assert(
    request: PermanentWorkerTopicDeletionRequest
  ): Promise<IWorkerLifecycleQueueMessage> {
    const payload = await this.load(
      request.worker_id,
      request.lifecycle_operation_id
    );
    if (!payload) {
      throw new WorkerDeletionProofError('missing');
    }
    if (payload.account_id !== request.account_id) {
      throw new WorkerDeletionProofError('account_mismatch');
    }
    if (payload.debug_trace_id !== request.debug_trace_id) {
      throw new WorkerDeletionProofError('debug_trace_mismatch');
    }
    return payload;
  }

  async listPending(limit = 100): Promise<IWorkerLifecycleQueueMessage[]> {
    const normalizedLimit =
      Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
    const entries = await this.requiredRedis().zrange(
      DELETE_FINALIZER_PENDING_KEY,
      0,
      normalizedLimit - 1
    );
    const pending: IWorkerLifecycleQueueMessage[] = [];
    for (const entry of entries) {
      let parsed: PermanentWorkerDeletionPendingEntry;
      try {
        parsed = JSON.parse(entry) as PermanentWorkerDeletionPendingEntry;
      } catch {
        await this.quarantinePendingEntry(entry, 'malformed_pending_entry');
        continue;
      }
      if (
        parsed.version !== DELETE_PROOF_VERSION ||
        parsed.action !== 'delete' ||
        !parsed.worker_id ||
        !parsed.account_id ||
        !parsed.operation_id
      ) {
        await this.quarantinePendingEntry(entry, 'invalid_pending_entry');
        continue;
      }
      let payload: IWorkerLifecycleQueueMessage | null;
      try {
        payload = await this.load(parsed.worker_id, parsed.operation_id);
      } catch (error) {
        if (!(error instanceof WorkerDeletionProofError)) {
          throw error;
        }
        await this.quarantinePendingEntry(
          entry,
          `invalid_pending_proof:${error.reason}`
        );
        continue;
      }
      if (!payload) {
        await this.quarantinePendingEntry(entry, 'pending_proof_missing');
        continue;
      }
      if (payload.account_id !== parsed.account_id) {
        await this.quarantinePendingEntry(entry, 'pending_identity_mismatch');
        continue;
      }
      pending.push(payload);
    }
    return pending;
  }

  async complete(
    workerId: string,
    accountId: string,
    operationId: string
  ): Promise<boolean> {
    const record = await this.loadRecord(workerId, operationId);
    if (!record) {
      throw new WorkerDeletionProofError('completion_proof_missing');
    }
    if (
      record.payload.account_id !== accountId ||
      record.proof.account_id !== accountId
    ) {
      throw new WorkerDeletionProofError('completion_identity_mismatch');
    }
    const entry: PermanentWorkerDeletionPendingEntry = {
      version: DELETE_PROOF_VERSION,
      worker_id: workerId,
      account_id: accountId,
      operation_id: operationId,
      action: 'delete',
    };
    const result = Number(
      await this.requiredRedis().eval(
        COMPLETE_DELETE_PROOF_SCRIPT,
        2,
        workerLifecycleJournalKey(workerId, operationId),
        DELETE_FINALIZER_PENDING_KEY,
        JSON.stringify(entry),
        record.serializedProof,
        String(COMPLETED_PROOF_RETENTION_SECONDS),
        DELETE_PROOF_FIELD,
        DELETE_PROOF_FINALIZED_FIELD
      )
    );
    if (result < 0) {
      throw new WorkerDeletionProofError(
        result === -1
          ? 'completion_proof_changed'
          : result === -2
            ? 'completion_identity_mismatch'
            : 'completion_pending_race'
      );
    }
    return result === 1;
  }

  private async quarantinePendingEntry(
    entry: string,
    reason: string
  ): Promise<void> {
    const quarantineRecord = JSON.stringify({
      version: 1,
      quarantined_at: new Date().toISOString(),
      reason,
      pending_entry: entry,
    });
    try {
      await this.requiredRedis().eval(
        QUARANTINE_PENDING_ENTRY_SCRIPT,
        2,
        DELETE_FINALIZER_PENDING_KEY,
        DELETE_FINALIZER_QUARANTINE_KEY,
        entry,
        String(Date.now()),
        quarantineRecord
      );
    } catch (error) {
      console.error(
        '[worker-deletion-proof-audit]',
        JSON.stringify({
          event: 'worker_deletion_pending_quarantine_failed',
          reason,
          pending_entry: entry,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return;
    }
    console.warn(
      '[worker-deletion-proof-audit]',
      JSON.stringify({
        event: 'worker_deletion_pending_quarantined',
        reason,
        pending_entry: entry,
      })
    );
  }

  private requiredRedis(): Redis {
    if (!this.redis) {
      throw new WorkerDeletionProofError('redis_unavailable');
    }
    return this.redis;
  }

  private assertDeletionPayload(
    payload: IWorkerLifecycleQueueMessage
  ): asserts payload is IWorkerLifecycleQueueMessage & { action: 'delete' } {
    if (payload.action !== 'delete') {
      throw new WorkerDeletionProofError('invalid_action');
    }
    if (
      !payload.worker_id?.trim() ||
      !payload.account_id?.trim() ||
      !payload.operation_id?.trim() ||
      !payload.request_id?.trim() ||
      !payload.server_id?.trim() ||
      !payload.worker_type_id ||
      payload.worker_status_id !== EWorkerStatus.deleting ||
      !payload.debug_trace_id?.trim() ||
      !payload.requested_at?.trim()
    ) {
      throw new WorkerDeletionProofError('incomplete_payload');
    }
  }
}
