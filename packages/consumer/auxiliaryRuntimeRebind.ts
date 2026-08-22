import type { KafkaConsumerEffectLease } from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import {
  type IWhatsappRuntimeFencedEvent,
  WhatsappRuntimeFenceService,
} from '@core/services/whatsappRuntimeFence.service';

export class UnrecoverableAuxiliaryRuntimeEventError extends Error {
  public readonly reason = 'auxiliary_runtime_event_unrecoverable' as const;

  constructor(public readonly detail: string) {
    super(`auxiliary_runtime_event_unrecoverable:${detail}`);
    this.name = 'UnrecoverableAuxiliaryRuntimeEventError';
  }
}

export class AuxiliaryRuntimeLeaseRaceError extends Error {
  public readonly reason = 'auxiliary_runtime_lease_race' as const;

  constructor(
    public readonly detail:
      'runtime_activating' | 'runtime_rotated' = 'runtime_rotated'
  ) {
    super(`auxiliary_runtime_lease_race:${detail}`);
    this.name = 'AuxiliaryRuntimeLeaseRaceError';
  }
}

type MutableAuxiliaryRuntimeEvent = IWhatsappRuntimeFencedEvent & {
  account_id?: string | null;
  event_id?: string | null;
};

export type AuxiliaryRuntimeRecoveryReason =
  | 'runtime_fence_missing'
  | 'runtime_fence_invalid'
  | 'runtime_activating'
  | 'runtime_rotated'
  | 'worker_provider_mismatch';

export interface IAuxiliaryRuntimeLeaseRecovery {
  lease: KafkaConsumerEffectLease;
  worker_id: string;
  source_provider: string;
  runtime_generation: number;
  connection_epoch: string;
}

export type AuxiliaryRuntimeLeaseRecoverer<
  TEvent extends MutableAuxiliaryRuntimeEvent,
> = (
  data: TEvent,
  reason: AuxiliaryRuntimeRecoveryReason
) => Promise<IAuxiliaryRuntimeLeaseRecovery | null>;

function nonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

async function applyRecoveredRuntimeLease<
  TEvent extends MutableAuxiliaryRuntimeEvent,
>(
  data: TEvent,
  workerId: string,
  sourceProvider: string,
  recoverRuntimeLease: AuxiliaryRuntimeLeaseRecoverer<TEvent> | undefined,
  reason: AuxiliaryRuntimeRecoveryReason
): Promise<KafkaConsumerEffectLease | null> {
  const recovered = await recoverRuntimeLease?.(data, reason);
  if (!recovered) {
    return null;
  }

  const recoveredWorkerId = nonEmpty(recovered.worker_id);
  const recoveredProvider =
    nonEmpty(recovered.source_provider)?.toLowerCase() ?? null;
  const recoveredGeneration = Number(recovered.runtime_generation);
  const recoveredEpoch = nonEmpty(recovered.connection_epoch);
  if (
    recoveredWorkerId !== workerId ||
    recoveredProvider !== sourceProvider ||
    !Number.isSafeInteger(recoveredGeneration) ||
    recoveredGeneration <= 0 ||
    !recoveredEpoch
  ) {
    await recovered.lease.release();
    throw new UnrecoverableAuxiliaryRuntimeEventError(
      'invalid_recovered_runtime_identity'
    );
  }

  data.runtime_generation = recoveredGeneration;
  data.connection_epoch = recoveredEpoch;
  return recovered.lease;
}

/**
 * A durable auxiliary event represents an already completed provider effect.
 * A connection rotation must not erase that effect. Validate all immutable
 * identities first, capture the active scope for the exact worker/provider,
 * then rebind only generation/epoch before acquiring its effect lease.
 */
export async function acquireReboundAuxiliaryRuntimeLease<
  TEvent extends MutableAuxiliaryRuntimeEvent,
>(
  data: TEvent,
  runtimeFence: WhatsappRuntimeFenceService,
  isImmutableIdentityValid: (data: TEvent) => boolean,
  resolveAccountId: (data: TEvent) => string | null = (candidate) =>
    nonEmpty(candidate.account_id),
  recoverRuntimeLease?: AuxiliaryRuntimeLeaseRecoverer<TEvent>
): Promise<KafkaConsumerEffectLease | null> {
  const sourceProvider = nonEmpty(data.source_provider)?.toLowerCase() ?? null;
  const workerId = nonEmpty(data.worker_id);
  const accountId = resolveAccountId(data);
  const eventId = nonEmpty(data.event_id);
  if (!workerId || !accountId || !eventId || !isImmutableIdentityValid(data)) {
    throw new UnrecoverableAuxiliaryRuntimeEventError('invalid_identity');
  }

  if (!WhatsappRuntimeFenceService.requiresFence(sourceProvider)) {
    return runtimeFence.acquireEffectLease(data);
  }
  if (!sourceProvider) {
    throw new UnrecoverableAuxiliaryRuntimeEventError(
      'invalid_managed_runtime_identity'
    );
  }

  const originalGeneration = Number(data.runtime_generation);
  const originalEpoch = nonEmpty(data.connection_epoch);
  if (
    !originalEpoch ||
    !Number.isSafeInteger(originalGeneration) ||
    originalGeneration <= 0
  ) {
    throw new UnrecoverableAuxiliaryRuntimeEventError(
      'invalid_managed_runtime_identity'
    );
  }

  const admission = await runtimeFence.viewAdmissionState(workerId);
  if (admission.state === 'revoked' || admission.state === 'deleting') {
    throw new UnrecoverableAuxiliaryRuntimeEventError(
      `worker_${admission.state}`
    );
  }
  if (admission.state === 'missing' || admission.state === 'invalid') {
    const recovered = await applyRecoveredRuntimeLease(
      data,
      workerId,
      sourceProvider,
      recoverRuntimeLease,
      `runtime_fence_${admission.state}`
    );
    if (recovered) {
      return recovered;
    }
    // Missing or malformed Redis state is not sufficient proof that a
    // completed provider effect is obsolete. Callers without an authoritative
    // recovery path keep the legacy fail-closed behavior.
    throw new AuxiliaryRuntimeLeaseRaceError('runtime_rotated');
  }
  if (admission.state === 'activating') {
    const recovered = await applyRecoveredRuntimeLease(
      data,
      workerId,
      sourceProvider,
      recoverRuntimeLease,
      'runtime_activating'
    );
    if (recovered) {
      return recovered;
    }
    throw new AuxiliaryRuntimeLeaseRaceError('runtime_activating');
  }
  if (admission.state !== 'active') {
    throw new UnrecoverableAuxiliaryRuntimeEventError('runtime_fence_invalid');
  }
  const current = admission.fence;
  if (
    current.worker_id !== workerId ||
    current.source_provider !== sourceProvider
  ) {
    const recovered = await applyRecoveredRuntimeLease(
      data,
      workerId,
      sourceProvider,
      recoverRuntimeLease,
      'worker_provider_mismatch'
    );
    if (recovered) {
      return recovered;
    }
    throw new UnrecoverableAuxiliaryRuntimeEventError(
      'worker_provider_mismatch'
    );
  }

  const rebound = {
    ...data,
    runtime_generation: current.runtime_generation,
    connection_epoch: current.connection_epoch,
  } as TEvent;
  const lease = await runtimeFence.acquireEffectLease(rebound);
  if (!lease) {
    const recovered = await applyRecoveredRuntimeLease(
      data,
      workerId,
      sourceProvider,
      recoverRuntimeLease,
      'runtime_rotated'
    );
    if (recovered) {
      return recovered;
    }
    // The runtime rotated between view() and lease acquisition. Redrive and
    // capture the next active scope. Keep the original payload untouched so
    // every attempt is reconciled independently against an authoritative
    // active fence.
    throw new AuxiliaryRuntimeLeaseRaceError('runtime_rotated');
  }

  // Publish the reconciled runtime to downstream guards only after the exact
  // lease has been acquired atomically. A failed/racing attempt must never
  // leak an unleased generation into a subsequent attempt.
  data.runtime_generation = current.runtime_generation;
  data.connection_epoch = current.connection_epoch;
  return lease;
}

export function isUnrecoverableAuxiliaryRuntimeEventError(
  error: unknown
): error is UnrecoverableAuxiliaryRuntimeEventError {
  return error instanceof UnrecoverableAuxiliaryRuntimeEventError;
}

export function isAuxiliaryRuntimeLeaseRaceError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current instanceof AuxiliaryRuntimeLeaseRaceError) {
      return true;
    }
    if (!current || typeof current !== 'object' || !('cause' in current)) {
      return false;
    }
    const cause = (current as { cause?: unknown }).cause;
    if (cause === current) {
      return false;
    }
    current = cause;
  }
  return false;
}
