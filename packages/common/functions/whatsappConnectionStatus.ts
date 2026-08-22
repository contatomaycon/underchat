import { EWhatsappConnectionStatus } from '../enums/EWhatsappConnectionStatus';
import { EWorkerRecreatePhase } from '../enums/EWorkerRecreatePhase';
import { EWorkerType } from '../enums/EWorkerType';
import {
  IWhatsappConnectionStatus,
  WhatsappConnectionStatusProvider,
} from '../interfaces/IWhatsappConnectionStatus';

const PROVIDERS = new Set<WhatsappConnectionStatusProvider>([
  'baileys',
  'wwebjs',
  'whatsmeow',
]);
const STATUSES = new Set<string>(Object.values(EWhatsappConnectionStatus));
const SAFE_DIAGNOSTIC_TOKEN = /^[a-z0-9][a-z0-9_.:-]{0,127}$/u;
const SOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TERMINAL_OFFLINE_STATUSES = new Set<EWhatsappConnectionStatus>([
  EWhatsappConnectionStatus.offline,
  EWhatsappConnectionStatus.loggedOut,
  EWhatsappConnectionStatus.invalidSession,
  EWhatsappConnectionStatus.conflict,
  EWhatsappConnectionStatus.leaseLost,
  EWhatsappConnectionStatus.stopped,
  EWhatsappConnectionStatus.error,
]);

export type WhatsappConnectionPublicStatus =
  'connecting' | 'qr' | 'online' | 'offline' | 'reconnect_required' | 'error';

export type WhatsappConnectionStatusOrder = 'accepted' | 'duplicate' | 'stale';

export interface WhatsappOrderedChannelProjection {
  id: string;
  connection_status_order?: unknown;
}

export type WhatsappChannelDisplayStatus =
  | { kind: 'worker'; workerStatusId: string | null }
  | {
      kind: 'connection';
      connectionStatus: WhatsappConnectionPublicStatus;
    };

interface CompareWhatsappConnectionStatusOrderInput {
  current?: IWhatsappConnectionStatus;
  currentSourceId?: string;
  candidate: IWhatsappConnectionStatus;
  candidateSourceId: string;
  retiredSourceIds?: ReadonlySet<string>;
  onlineChangedAtFloorMs?: number;
}

function safeDiagnosticToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return SAFE_DIAGNOSTIC_TOKEN.test(normalized) ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeWhatsappConnectionStatusSourceId(
  value: unknown
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return SOURCE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

export function normalizeWhatsappConnectionStatusOrder(
  value: unknown
): string | undefined {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(value)) {
    return undefined;
  }
  return value;
}

export function normalizeWhatsappConnectionStatusObservedAt(
  value: unknown
): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

/** Compares positive decimal bigint strings without Number/BigInt coercion. */
export function compareWhatsappConnectionStatusOrders(
  left: string,
  right: string
): -1 | 0 | 1 {
  const normalizedLeft = normalizeWhatsappConnectionStatusOrder(left);
  const normalizedRight = normalizeWhatsappConnectionStatusOrder(right);
  if (!normalizedLeft || !normalizedRight) {
    throw new TypeError('invalid_whatsapp_connection_status_order');
  }
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return normalizedLeft === normalizedRight
    ? 0
    : normalizedLeft < normalizedRight
      ? -1
      : 1;
}

/**
 * HTTP snapshots and realtime publications share the durable outbox cursor.
 * Once a client has observed a cursor, a response without a cursor (or with a
 * lower cursor) cannot replace the connection projection already on screen.
 */
export function shouldApplyWhatsappConnectionStatusOrder(
  currentValue: unknown,
  candidateValue: unknown
): boolean {
  const current = normalizeWhatsappConnectionStatusOrder(currentValue);
  const candidate = normalizeWhatsappConnectionStatusOrder(candidateValue);

  if (!current) {
    return (
      candidateValue === undefined || candidateValue === null || !!candidate
    );
  }
  if (!candidate) return false;

  return compareWhatsappConnectionStatusOrders(candidate, current) >= 0;
}

const ORDERED_CHANNEL_PROJECTION_FIELDS = [
  // `worker.worker_status_id` has its own durable lifecycle clock. It is not
  // part of the provider-owned connection cursor and must always come from
  // the authoritative HTTP row or a validated lifecycle publication.
  'type',
  'worker_type_id',
  'number',
  'connection_date',
  'last_connection_check_at',
  'connection_status',
  'connection_public_status',
  'connection_status_source_id',
  'connection_status_sequence',
  'connection_status_changed_at',
  'connection_status_order',
  'connection_online_acknowledged',
  'runtime_generation',
] as const;

export type WhatsappRealtimeStatusFenceResult =
  | {
      accepted: true;
      workerTypeId: string;
      runtimeGeneration?: number;
    }
  | {
      accepted: false;
      reason:
        | 'worker_type_unverifiable'
        | 'retired_provider_lifecycle'
        | 'runtime_generation_unverifiable'
        | 'stale_runtime_generation'
        | 'unordered_raw_lifecycle';
    };

export function normalizeWhatsappRuntimeGeneration(
  value: unknown
): number | undefined {
  const generation =
    typeof value === 'string' && /^[1-9][0-9]{0,9}$/u.test(value)
      ? Number(value)
      : value;
  return typeof generation === 'number' &&
    Number.isSafeInteger(generation) &&
    generation > 0
    ? generation
    : undefined;
}

export function isUnofficialWhatsappWorkerType(
  workerTypeId: unknown
): workerTypeId is string {
  return (
    workerTypeId === EWorkerType.baileys ||
    workerTypeId === EWorkerType.wwebjs ||
    workerTypeId === EWorkerType.whatsmeow
  );
}

/**
 * Browser/mobile fail-closed fence for realtime lifecycle messages.
 *
 * The durable worker type is authoritative when older publishers omit it.
 * Once a native outbox cursor exists, a raw lifecycle publication from the
 * same (or an unknown) generation cannot supersede that ordered projection.
 * A provider handoff is accepted only through a validated native envelope;
 * a strictly newer runtime generation may still publish the lifecycle that
 * starts the next connection attempt before its first native checkpoint.
 */
export function evaluateWhatsappRealtimeStatusFence(input: {
  persistedWorkerTypeId?: unknown;
  eventWorkerTypeId?: unknown;
  persistedRuntimeGeneration?: unknown;
  eventRuntimeGeneration?: unknown;
  persistedConnectionStatusOrder?: unknown;
  hasValidatedNativeProjection: boolean;
}): WhatsappRealtimeStatusFenceResult {
  const persistedWorkerTypeId =
    typeof input.persistedWorkerTypeId === 'string' &&
    input.persistedWorkerTypeId.trim()
      ? input.persistedWorkerTypeId.trim()
      : undefined;
  const eventWorkerTypeId =
    typeof input.eventWorkerTypeId === 'string' &&
    input.eventWorkerTypeId.trim()
      ? input.eventWorkerTypeId.trim()
      : undefined;
  const workerTypeId = eventWorkerTypeId ?? persistedWorkerTypeId;
  if (!workerTypeId) {
    return { accepted: false, reason: 'worker_type_unverifiable' };
  }

  if (
    persistedWorkerTypeId &&
    eventWorkerTypeId &&
    persistedWorkerTypeId !== eventWorkerTypeId &&
    !input.hasValidatedNativeProjection
  ) {
    return { accepted: false, reason: 'retired_provider_lifecycle' };
  }

  const currentOrder = normalizeWhatsappConnectionStatusOrder(
    input.persistedConnectionStatusOrder
  );
  const currentGeneration = normalizeWhatsappRuntimeGeneration(
    input.persistedRuntimeGeneration
  );
  const eventGeneration = normalizeWhatsappRuntimeGeneration(
    input.eventRuntimeGeneration
  );

  if (isUnofficialWhatsappWorkerType(workerTypeId)) {
    if ((currentOrder || currentGeneration) && !eventGeneration) {
      return {
        accepted: false,
        reason: 'runtime_generation_unverifiable',
      };
    }
    if (
      currentGeneration &&
      eventGeneration &&
      eventGeneration < currentGeneration
    ) {
      return { accepted: false, reason: 'stale_runtime_generation' };
    }
    if (
      currentOrder &&
      !input.hasValidatedNativeProjection &&
      (!currentGeneration ||
        !eventGeneration ||
        eventGeneration <= currentGeneration)
    ) {
      return { accepted: false, reason: 'unordered_raw_lifecycle' };
    }
  }

  return {
    accepted: true,
    workerTypeId,
    ...(eventGeneration || currentGeneration
      ? { runtimeGeneration: eventGeneration ?? currentGeneration }
      : {}),
  };
}

const projectionWorkerTypeId = (
  value: WhatsappOrderedChannelProjection
): string | undefined => {
  const record = value as unknown as Record<string, unknown>;
  if (typeof record.worker_type_id === 'string') return record.worker_type_id;
  if (!isRecord(record.type) || typeof record.type.id !== 'string') {
    return undefined;
  }
  return record.type.id;
};

/**
 * CAS merge for one channel returned by HTTP. Non-connection metadata comes
 * from the response, while a newer realtime connection projection is kept.
 * Provider identity is part of the protected projection: an HTTP response
 * from the provider that was active when the request started cannot replace a
 * newer realtime handoff.
 */
export function mergeWhatsappOrderedChannelProjection<
  T extends WhatsappOrderedChannelProjection,
>(current: T | undefined, candidate: T): T {
  if (!current) return candidate;

  const currentWorkerTypeId = projectionWorkerTypeId(current);
  const candidateWorkerTypeId = projectionWorkerTypeId(candidate);
  let merged: T;
  let retainCurrentStatusWithoutClock = false;
  if (
    currentWorkerTypeId &&
    candidateWorkerTypeId &&
    currentWorkerTypeId !== candidateWorkerTypeId
  ) {
    const currentOrder = normalizeWhatsappConnectionStatusOrder(
      current.connection_status_order
    );
    const candidateOrder = normalizeWhatsappConnectionStatusOrder(
      candidate.connection_status_order
    );
    const candidateAdvancesProvider = Boolean(
      currentOrder &&
      candidateOrder &&
      compareWhatsappConnectionStatusOrders(candidateOrder, currentOrder) > 0
    );
    merged = candidateAdvancesProvider
      ? candidate
      : retainCurrentWhatsappOrderedChannelProjection(current, candidate);
    retainCurrentStatusWithoutClock = !candidateAdvancesProvider;
  } else if (
    shouldApplyWhatsappConnectionStatusOrder(
      current.connection_status_order,
      candidate.connection_status_order
    )
  ) {
    const currentOrder = normalizeWhatsappConnectionStatusOrder(
      current.connection_status_order
    );
    const candidateOrder = normalizeWhatsappConnectionStatusOrder(
      candidate.connection_status_order
    );
    if (
      currentOrder &&
      candidateOrder &&
      compareWhatsappConnectionStatusOrders(candidateOrder, currentOrder) === 0
    ) {
      merged = retainCurrentWhatsappOrderedChannelProjection(
        current,
        candidate
      );
    } else {
      merged = candidate;
    }
  } else {
    merged = retainCurrentWhatsappOrderedChannelProjection(current, candidate);
  }

  return retainNewerWorkerStatusProjection(
    current,
    candidate,
    merged,
    retainCurrentStatusWithoutClock
  );
}

function retainNewerWorkerStatusProjection<
  T extends WhatsappOrderedChannelProjection,
>(current: T, candidate: T, merged: T, retainCurrentWithoutClock: boolean): T {
  const currentRecord = current as unknown as Record<string, unknown>;
  const candidateRecord = candidate as unknown as Record<string, unknown>;
  const currentObservedAt = normalizeWhatsappConnectionStatusObservedAt(
    currentRecord.worker_status_observed_at
  );
  const candidateObservedAt = normalizeWhatsappConnectionStatusObservedAt(
    candidateRecord.worker_status_observed_at
  );
  const currentStatus = currentRecord.status;
  const hasCurrentStatus =
    (isRecord(currentStatus) &&
      typeof currentStatus.id === 'string' &&
      currentStatus.id.trim().length > 0) ||
    (typeof currentRecord.worker_status_id === 'string' &&
      currentRecord.worker_status_id.trim().length > 0);
  if (
    !hasCurrentStatus ||
    (!currentObservedAt && !retainCurrentWithoutClock) ||
    (candidateObservedAt &&
      (!currentObservedAt ||
        Date.parse(candidateObservedAt) >= Date.parse(currentObservedAt)))
  ) {
    return merged;
  }

  const result = { ...merged } as Record<string, unknown>;
  for (const field of [
    'status',
    'worker_status_id',
    'worker_status_observed_at',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(currentRecord, field)) {
      result[field] = currentRecord[field];
    }
  }
  return result as T;
}

function retainCurrentWhatsappOrderedChannelProjection<
  T extends WhatsappOrderedChannelProjection,
>(current: T, candidate: T): T {
  const currentRecord = current as unknown as Record<string, unknown>;
  const merged = { ...candidate } as Record<string, unknown>;
  for (const field of ORDERED_CHANNEL_PROJECTION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(currentRecord, field)) {
      merged[field] = currentRecord[field];
    }
  }
  return merged as T;
}

function hasAdvancedWhatsappConnectionStatusOrder(
  currentValue: unknown,
  baselineValue: unknown
): boolean {
  const current = normalizeWhatsappConnectionStatusOrder(currentValue);
  if (!current) return false;
  const baseline = normalizeWhatsappConnectionStatusOrder(baselineValue);
  return (
    !baseline || compareWhatsappConnectionStatusOrders(current, baseline) > 0
  );
}

/**
 * Reconciles an authoritative HTTP list without dropping rows changed by
 * realtime after the request started. `baselineOrders` must be captured just
 * before issuing that request.
 */
export function mergeWhatsappOrderedChannelHttpSnapshot<
  T extends WhatsappOrderedChannelProjection,
>(
  current: readonly T[],
  candidate: readonly T[],
  baselineOrders?: ReadonlyMap<string, string>,
  options: {
    retainAdvancedMissing?: boolean;
    baselineWorkerTypeIds?: ReadonlyMap<string, string>;
  } = {}
): T[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const candidateIds = new Set(candidate.map((item) => item.id));
  const merged = candidate.map((item) => {
    const currentItem = currentById.get(item.id);
    const currentWorkerTypeId = currentItem
      ? projectionWorkerTypeId(currentItem)
      : undefined;
    const candidateWorkerTypeId = projectionWorkerTypeId(item);
    const providerChanged =
      currentWorkerTypeId &&
      candidateWorkerTypeId &&
      currentWorkerTypeId !== candidateWorkerTypeId;
    if (providerChanged && currentItem) {
      const currentOrder = normalizeWhatsappConnectionStatusOrder(
        currentItem.connection_status_order
      );
      const candidateOrder = normalizeWhatsappConnectionStatusOrder(
        item.connection_status_order
      );
      if (
        currentOrder &&
        candidateOrder &&
        compareWhatsappConnectionStatusOrders(candidateOrder, currentOrder) > 0
      ) {
        return item;
      }

      const baselineWorkerTypeId = options.baselineWorkerTypeIds?.get(item.id);
      const providerAdvancedSinceBaseline = options.baselineWorkerTypeIds
        ? baselineWorkerTypeId === undefined ||
          baselineWorkerTypeId !== currentWorkerTypeId
        : false;
      const currentAdvancedSinceBaseline =
        providerAdvancedSinceBaseline ||
        (baselineOrders
          ? hasAdvancedWhatsappConnectionStatusOrder(
              currentItem.connection_status_order,
              baselineOrders.get(item.id)
            )
          : true);
      if (baselineOrders && !currentAdvancedSinceBaseline) {
        return item;
      }
      return retainNewerWorkerStatusProjection(
        currentItem,
        item,
        retainCurrentWhatsappOrderedChannelProjection(currentItem, item),
        true
      );
    }
    return mergeWhatsappOrderedChannelProjection(currentItem, item);
  });

  if (!baselineOrders || options.retainAdvancedMissing === false) return merged;

  for (const item of current) {
    if (
      !candidateIds.has(item.id) &&
      hasAdvancedWhatsappConnectionStatusOrder(
        item.connection_status_order,
        baselineOrders.get(item.id)
      )
    ) {
      merged.push(item);
    }
  }

  return merged;
}

/**
 * Validates a native snapshot before it crosses the provider boundary. Free
 * form provider errors are intentionally dropped so credentials, QR values,
 * cookies and database URLs can never enter status persistence or logs.
 */
export function normalizeWhatsappConnectionStatus(
  value: unknown,
  expectedProvider?: WhatsappConnectionStatusProvider
): IWhatsappConnectionStatus | undefined {
  if (!isRecord(value)) return undefined;

  const provider = value.provider;
  const status = value.status;
  const sequence =
    typeof value.sequence === 'string' && /^\d+$/u.test(value.sequence)
      ? Number(value.sequence)
      : value.sequence;
  // Protobuf `optional bool` represents unknown by omitting the field. Native
  // in-process objects use explicit null; normalize both wire forms to the
  // same canonical tri-state value.
  const sessionValid =
    value.sessionValid === undefined ? null : value.sessionValid;
  const changedAt = value.changedAt;
  if (
    typeof provider !== 'string' ||
    !PROVIDERS.has(provider as WhatsappConnectionStatusProvider) ||
    (expectedProvider !== undefined && provider !== expectedProvider) ||
    typeof status !== 'string' ||
    !STATUSES.has(status) ||
    typeof value.connected !== 'boolean' ||
    typeof value.authenticated !== 'boolean' ||
    !(typeof sessionValid === 'boolean' || sessionValid === null) ||
    typeof value.recoverable !== 'boolean' ||
    typeof value.qrAvailable !== 'boolean' ||
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    typeof changedAt !== 'string' ||
    changedAt.length > 64 ||
    !Number.isFinite(Date.parse(changedAt))
  ) {
    return undefined;
  }

  const canonicalStatus = status as EWhatsappConnectionStatus;
  if (
    (canonicalStatus === EWhatsappConnectionStatus.online &&
      (!value.connected ||
        !value.authenticated ||
        sessionValid !== true ||
        value.qrAvailable)) ||
    (canonicalStatus === EWhatsappConnectionStatus.qr &&
      (value.connected || value.authenticated || !value.qrAvailable)) ||
    (TERMINAL_OFFLINE_STATUSES.has(canonicalStatus) && value.connected)
  ) {
    return undefined;
  }

  const snapshot: IWhatsappConnectionStatus = {
    provider: provider as WhatsappConnectionStatusProvider,
    status: canonicalStatus,
    connected: value.connected,
    authenticated: value.authenticated,
    sessionValid,
    recoverable: value.recoverable,
    qrAvailable: value.qrAvailable,
    sequence,
    changedAt: new Date(changedAt).toISOString(),
  };
  const reason = safeDiagnosticToken(value.reason);
  const errorCode = safeDiagnosticToken(value.errorCode);
  if (reason) snapshot.reason = reason;
  if (errorCode) snapshot.errorCode = errorCode;
  return Object.freeze(snapshot);
}

export function isNewerWhatsappConnectionStatus(
  current: IWhatsappConnectionStatus | undefined,
  candidate: IWhatsappConnectionStatus
): boolean {
  return current === undefined || candidate.sequence > current.sequence;
}

export function areSameWhatsappConnectionStatus(
  left: IWhatsappConnectionStatus,
  right: IWhatsappConnectionStatus
): boolean {
  return (
    left.provider === right.provider &&
    left.status === right.status &&
    left.connected === right.connected &&
    left.authenticated === right.authenticated &&
    left.sessionValid === right.sessionValid &&
    left.recoverable === right.recoverable &&
    left.qrAvailable === right.qrAvailable &&
    left.sequence === right.sequence &&
    left.changedAt === right.changedAt &&
    left.reason === right.reason &&
    left.errorCode === right.errorCode
  );
}

/**
 * Orders status snapshots without letting a retired native client resurrect.
 * A fresh source may always publish a degradation even after a wall-clock
 * rollback, while ONLINE additionally requires a non-regressing timestamp.
 * This deliberately favors a false negative over a false ONLINE.
 */
export function compareWhatsappConnectionStatusOrder(
  input: CompareWhatsappConnectionStatusOrderInput
): WhatsappConnectionStatusOrder {
  const { current, currentSourceId, candidate, candidateSourceId } = input;
  if (!current || !currentSourceId) return 'accepted';

  if (currentSourceId === candidateSourceId) {
    if (candidate.sequence < current.sequence) return 'stale';
    if (candidate.sequence > current.sequence) return 'accepted';
    return areSameWhatsappConnectionStatus(current, candidate)
      ? 'duplicate'
      : 'stale';
  }

  if (input.retiredSourceIds?.has(candidateSourceId)) return 'stale';
  const currentChangedAtMs = Date.parse(current.changedAt);
  const onlineChangedAtFloorMs = Number.isFinite(input.onlineChangedAtFloorMs)
    ? Math.max(currentChangedAtMs, input.onlineChangedAtFloorMs as number)
    : currentChangedAtMs;
  if (
    candidate.status === EWhatsappConnectionStatus.online &&
    Date.parse(candidate.changedAt) < onlineChangedAtFloorMs
  ) {
    return 'stale';
  }
  return 'accepted';
}

export function isWhatsappConnectionOnline(
  snapshot: IWhatsappConnectionStatus | undefined
): boolean {
  return (
    snapshot?.status === EWhatsappConnectionStatus.online &&
    snapshot.connected === true &&
    snapshot.authenticated === true &&
    snapshot.sessionValid === true &&
    snapshot.qrAvailable === false
  );
}

/**
 * Small, stable projection intended for customers. Provider internals such as
 * fencing, handoff and restore are deliberately collapsed here.
 */
export function projectWhatsappConnectionPublicStatus(
  snapshot: IWhatsappConnectionStatus | undefined
): WhatsappConnectionPublicStatus | undefined {
  if (!snapshot) return undefined;

  // Starting a socket/Chromium client is not evidence that the customer has
  // scanned a QR code. Fresh sessions from all three providers briefly emit
  // INITIALIZING/RESTORING (and some emit CONNECTING) before the first QR is
  // available.
  // Keep that technical bootstrap out of the customer projection so the
  // durable worker lifecycle remains `creating`/`disponible`. CONNECTING only
  // becomes visible after the provider proves an existing/consumed session.
  if (
    (snapshot.status === EWhatsappConnectionStatus.initializing ||
      snapshot.status === EWhatsappConnectionStatus.restoring ||
      snapshot.status === EWhatsappConnectionStatus.connecting) &&
    snapshot.authenticated !== true &&
    snapshot.sessionValid !== true &&
    snapshot.qrAvailable === false
  ) {
    return undefined;
  }

  switch (snapshot.status) {
    case EWhatsappConnectionStatus.online:
      return isWhatsappConnectionOnline(snapshot) ? 'online' : 'connecting';
    case EWhatsappConnectionStatus.qr:
      return 'qr';
    case EWhatsappConnectionStatus.loggedOut:
    case EWhatsappConnectionStatus.invalidSession:
    case EWhatsappConnectionStatus.conflict:
      return 'reconnect_required';
    case EWhatsappConnectionStatus.error:
      return snapshot.recoverable ? 'offline' : 'error';
    case EWhatsappConnectionStatus.offline:
    case EWhatsappConnectionStatus.leaseLost:
    case EWhatsappConnectionStatus.stopped:
      return 'offline';
    case EWhatsappConnectionStatus.initializing:
    case EWhatsappConnectionStatus.restoring:
    case EWhatsappConnectionStatus.connecting:
    case EWhatsappConnectionStatus.reconnecting:
    case EWhatsappConnectionStatus.handoff:
      return 'connecting';
  }
}

/**
 * Single customer-facing precedence rule used by channel lists and banners.
 *
 * `worker.worker_status_id` is the durable operational truth for every
 * provider and storage mode. Native connection snapshots remain available to
 * connection flows and diagnostics, but may never rewrite the public worker
 * status during a read. In particular, an old `offline`/`stopped` native
 * checkpoint cannot turn a durable `disponible` worker into OFFLINE.
 */
export function projectWhatsappChannelDisplayStatus(input: {
  workerTypeId?: string | null;
  workerStatusId?: string | null;
  recreatePhase?: EWorkerRecreatePhase | null;
  connectionStatus?: WhatsappConnectionPublicStatus | null;
  connectionOnlineAcknowledged?: boolean | null;
}): WhatsappChannelDisplayStatus {
  const workerStatusId = input.workerStatusId ?? null;
  return { kind: 'worker', workerStatusId };
}
