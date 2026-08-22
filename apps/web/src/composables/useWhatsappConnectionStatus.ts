import { readonly, shallowRef } from 'vue';
import {
  IWhatsappConnectionStatus,
  WhatsappConnectionStatusProvider,
} from '@core/common/interfaces/IWhatsappConnectionStatus';
import {
  compareWhatsappConnectionStatusOrders,
  compareWhatsappConnectionStatusOrder,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusOrder,
} from '@core/common/functions/whatsappConnectionStatus';
import { isWorkerConnectionSessionReady } from '@core/common/functions/isWorkerConnectionSessionReady';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import type { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

export type WhatsappConnectionStatusAcceptance =
  'accepted' | 'duplicate' | 'invalid' | 'stale';

export type WhatsappConnectionStatusResolution =
  WhatsappConnectionStatusAcceptance | 'none';

export type ConnectionModalPublicationDecision =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | 'connected_without_confirmed_session_ready'
        | 'connected_without_active_attempt_or_new_native_order'
        | 'stale_connection_attempt'
        | 'stale_after_connected';
    };

interface AcceptWhatsappConnectionStatusInput {
  expectedProvider?: WhatsappConnectionStatusProvider;
  snapshot: unknown;
  sourceId?: string | null;
  order?: string | null;
}

interface AcceptWhatsappConnectionStatusResult {
  outcome: WhatsappConnectionStatusAcceptance;
  snapshot?: IWhatsappConnectionStatus;
}

const SOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const isConnectedPayload = (data: Partial<IBaileysConnectionState>): boolean =>
  data.status === EBaileysConnectionStatus.connected ||
  data.code === ECodeMessage.connectionEstablished;

/**
 * Applies the same fail-closed terminal rule to the authenticated modal and
 * the public external-connection page. A different/missing QR attempt may be
 * superseded only by a newly accepted durable native projection. This is
 * stronger than the ephemeral attempt id and is the expected hand-off from
 * provider truth to the central outbox.
 *
 * Once connected, an old QR/retry publication cannot bring the UI back to a
 * pairing screen. A real degradation remains possible through a newer native
 * outbox order.
 */
export function evaluateConnectionModalPublication(input: {
  currentAttemptId?: string;
  currentConnected: boolean;
  hasDurableNativeOrder: boolean;
  incoming: Partial<IBaileysConnectionState>;
  nativeResolution: WhatsappConnectionStatusResolution;
}): ConnectionModalPublicationDecision {
  const incomingConnected = isConnectedPayload(input.incoming);
  const acceptedDurableNativeTransition =
    input.nativeResolution === 'accepted' && input.hasDurableNativeOrder;

  if (incomingConnected && !isWorkerConnectionSessionReady(input.incoming)) {
    return {
      accepted: false,
      reason: 'connected_without_confirmed_session_ready',
    };
  }

  if (incomingConnected && input.currentAttemptId) {
    const sameAttempt =
      input.incoming.connection_attempt_id === input.currentAttemptId;
    if (!sameAttempt && !acceptedDurableNativeTransition) {
      return { accepted: false, reason: 'stale_connection_attempt' };
    }
  }

  if (
    incomingConnected &&
    !input.currentAttemptId &&
    !input.currentConnected &&
    !acceptedDurableNativeTransition
  ) {
    return {
      accepted: false,
      reason: 'connected_without_active_attempt_or_new_native_order',
    };
  }

  if (
    !incomingConnected &&
    input.currentConnected &&
    !acceptedDurableNativeTransition
  ) {
    return { accepted: false, reason: 'stale_after_connected' };
  }

  return { accepted: true };
}

/**
 * A newer provider state that no longer offers QR normally invalidates its
 * image. A provider may, however, recycle only its internal client while the
 * same QR attempt remains active. In that pre-authentication window the last
 * credential stays visible until its replacement or an explicit terminal.
 */
export function shouldClearConnectionModalQr(input: {
  nativeResolution: WhatsappConnectionStatusResolution;
  snapshot?: IWhatsappConnectionStatus;
  preserveCurrentQr?: boolean;
}): boolean {
  return (
    input.preserveCurrentQr !== true &&
    input.nativeResolution === 'accepted' &&
    Boolean(input.snapshot) &&
    (input.snapshot?.status !== EWhatsappConnectionStatus.qr ||
      input.snapshot.qrAvailable !== true)
  );
}

function sameNativeSnapshot(
  left: IWhatsappConnectionStatus | undefined,
  right: IWhatsappConnectionStatus
): boolean {
  if (!left) return false;
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

/** Owns native event ordering for one channel modal. */
export function useWhatsappConnectionStatus() {
  const status = shallowRef<IWhatsappConnectionStatus>();
  const sourceId = shallowRef<string>();
  const order = shallowRef<string>();
  const retiredSourceIds = new Set<string>();
  let changedAtHighWatermarkMs = Number.NEGATIVE_INFINITY;

  function accept(
    input: AcceptWhatsappConnectionStatusInput
  ): AcceptWhatsappConnectionStatusResult {
    const normalizedSourceId = input.sourceId?.trim().toLowerCase();
    const snapshot = normalizeWhatsappConnectionStatus(
      input.snapshot,
      input.expectedProvider
    );
    if (!snapshot || !SOURCE_ID_PATTERN.test(normalizedSourceId ?? '')) {
      return { outcome: 'invalid' };
    }

    const candidateOrder = normalizeWhatsappConnectionStatusOrder(input.order);
    if (input.order !== undefined && input.order !== null && !candidateOrder) {
      return { outcome: 'invalid' };
    }
    if (order.value) {
      if (!candidateOrder) return { outcome: 'stale' };
      const comparison = compareWhatsappConnectionStatusOrders(
        candidateOrder,
        order.value
      );
      if (comparison < 0) return { outcome: 'stale' };
      if (comparison === 0) {
        if (
          sourceId.value !== normalizedSourceId ||
          !sameNativeSnapshot(status.value, snapshot)
        ) {
          return { outcome: 'invalid' };
        }
        return { outcome: 'duplicate', snapshot: status.value };
      }
    }

    if (candidateOrder) {
      status.value = snapshot;
      sourceId.value = normalizedSourceId;
      order.value = candidateOrder;
      return { outcome: 'accepted', snapshot };
    }

    const current = status.value;
    const currentSourceId = sourceId.value;
    const outcome = compareWhatsappConnectionStatusOrder({
      current,
      currentSourceId,
      candidate: snapshot,
      candidateSourceId: normalizedSourceId as string,
      retiredSourceIds,
      onlineChangedAtFloorMs: changedAtHighWatermarkMs,
    });
    if (outcome === 'stale') {
      return { outcome: 'stale' };
    }
    if (outcome === 'duplicate') {
      return { outcome: 'duplicate', snapshot: current };
    }

    if (currentSourceId && currentSourceId !== normalizedSourceId) {
      retiredSourceIds.add(currentSourceId);
    }

    status.value = snapshot;
    sourceId.value = normalizedSourceId;
    changedAtHighWatermarkMs = Math.max(
      changedAtHighWatermarkMs,
      Date.parse(snapshot.changedAt)
    );
    return { outcome: 'accepted', snapshot };
  }

  function reset(): void {
    status.value = undefined;
    sourceId.value = undefined;
    order.value = undefined;
    retiredSourceIds.clear();
    changedAtHighWatermarkMs = Number.NEGATIVE_INFINITY;
  }

  return {
    status: readonly(status),
    sourceId: readonly(sourceId),
    order: readonly(order),
    accept,
    reset,
  };
}
