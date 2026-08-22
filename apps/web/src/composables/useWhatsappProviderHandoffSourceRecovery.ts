import { computed, onBeforeUnmount, watch } from 'vue';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import type { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { IWhatsappProviderHandoffRecoveryCentrifugo } from '@core/common/interfaces/IWhatsappProviderHandoffRecoveryCentrifugo';
import { useChannelStatusPresentationStore } from '@/@webcore/stores/channelStatusPresentation';
import { useChannelsStore } from '@/@webcore/stores/channels';
import type {
  WhatsappProviderHandoffRecoveryMarker,
  WhatsappProviderHandoffView,
} from '@/@webcore/interfaces/IWhatsappProviderHandoff';

interface ProviderHandoffSourceRecoveryCandidate {
  workerId: string;
  lifecycleOperationId: string;
  marker?: WhatsappProviderHandoffRecoveryMarker;
}

interface ProviderHandoffSourceRecoveryFlight {
  promise: Promise<boolean>;
  pendingKnownHandoff?: WhatsappProviderHandoffView;
  pendingRecoveryPublication?: IWhatsappProviderHandoffRecoveryCentrifugo;
}

const handoffLifecycleOperationId = (
  handoff: WhatsappProviderHandoffView
): string | null =>
  handoff.handoff_lifecycle_operation_id ??
  handoff.lifecycle_operation_id ??
  null;

const candidateKey = (
  candidate: ProviderHandoffSourceRecoveryCandidate
): string => `${candidate.workerId}:${candidate.lifecycleOperationId}`;

const durableHandoffKey = (handoff: WhatsappProviderHandoffView): string =>
  `${handoff.worker_id}:${handoffLifecycleOperationId(handoff) ?? 'missing'}`;

const matchesCandidate = (
  handoff: WhatsappProviderHandoffView,
  candidate: ProviderHandoffSourceRecoveryCandidate
): boolean => {
  const marker = candidate.marker;
  const originalOperationId = handoffLifecycleOperationId(handoff);
  const currentOperationMatches =
    handoff.lifecycle_operation_id === originalOperationId ||
    (handoff.resolution_action === 'return' &&
      handoff.resolution_state === 'completed' &&
      handoff.resolution_operation_id !== null &&
      handoff.lifecycle_operation_id === handoff.resolution_operation_id);
  const candidateOperationMatches =
    candidate.lifecycleOperationId === originalOperationId ||
    (handoff.resolution_action === 'return' &&
      handoff.resolution_state === 'completed' &&
      handoff.resolution_operation_id !== null &&
      candidate.lifecycleOperationId === handoff.resolution_operation_id);
  return (
    handoff.worker_id === candidate.workerId &&
    candidateOperationMatches &&
    currentOperationMatches &&
    (!marker ||
      (handoff.handoff_id === marker.handoff_id &&
        handoff.source_provider === marker.source_provider &&
        handoff.target_provider === marker.target_provider))
  );
};

const matchesRecoveryPublication = (
  handoff: WhatsappProviderHandoffView,
  publication: IWhatsappProviderHandoffRecoveryCentrifugo
): boolean =>
  publication.recovery_state === 'completed' &&
  handoff.worker_id === publication.worker_id &&
  handoff.handoff_id === publication.handoff_id &&
  handoffLifecycleOperationId(handoff) ===
    publication.handoff_lifecycle_operation_id &&
  handoff.recovery_operation_id === publication.recovery_operation_id &&
  handoff.recovery_state === publication.recovery_state &&
  handoff.source_provider === publication.source_provider &&
  handoff.target_provider === publication.target_provider;

/**
 * Passively reconciles restored source projections for every visible/in-memory
 * handoff. It owns no business status, dialog, timer or recovery decision: the
 * durable handoff + worker GET feed the canonical presentation reducer, while
 * this composable only deduplicates read-side effects per exact operation.
 */
export function useWhatsappProviderHandoffSourceRecovery() {
  const channelsStore = useChannelsStore();
  const presentationStore = useChannelStatusPresentationStore();
  const inFlight = new Map<string, ProviderHandoffSourceRecoveryFlight>();
  const settled = new Set<string>();
  let disposed = false;

  const candidates = computed<ProviderHandoffSourceRecoveryCandidate[]>(() => {
    const byWorkerId = new Map<
      string,
      ProviderHandoffSourceRecoveryCandidate
    >();
    for (const channel of channelsStore.list) {
      const marker = channel.provider_handoff_recovery;
      if (!marker?.handoff_id || !marker.lifecycle_operation_id) continue;
      byWorkerId.set(channel.id, {
        workerId: channel.id,
        lifecycleOperationId: marker.lifecycle_operation_id,
        marker,
      });
    }
    for (const snapshot of Object.values(presentationStore.byWorkerId)) {
      if (!snapshot.lifecycleOperationId || byWorkerId.has(snapshot.workerId)) {
        continue;
      }
      byWorkerId.set(snapshot.workerId, {
        workerId: snapshot.workerId,
        lifecycleOperationId: snapshot.lifecycleOperationId,
      });
    }
    return Array.from(byWorkerId.values()).sort((left, right) =>
      candidateKey(left).localeCompare(candidateKey(right))
    );
  });

  const candidateSignature = computed(() =>
    candidates.value.map(candidateKey).join('|')
  );

  const execute = async (
    candidate: ProviderHandoffSourceRecoveryCandidate,
    knownHandoff?: WhatsappProviderHandoffView,
    recoveryPublication?: IWhatsappProviderHandoffRecoveryCentrifugo
  ): Promise<boolean> => {
    const key = candidateKey(candidate);
    if (settled.has(key)) return true;
    const active = inFlight.get(key);
    if (active) {
      // A lifecycle publication can start this read while PostgreSQL still
      // exposes recovery_state=running. If the monitor then receives the same
      // durable handoff as completed, retain that authoritative snapshot for
      // one event-driven replay instead of losing it behind the older flight.
      if (knownHandoff) active.pendingKnownHandoff = knownHandoff;
      if (recoveryPublication) {
        active.pendingRecoveryPublication = recoveryPublication;
      }
      return active.promise;
    }

    const flight: ProviderHandoffSourceRecoveryFlight = {
      promise: Promise.resolve(false),
    };
    inFlight.set(key, flight);
    flight.promise = Promise.resolve().then(async () => {
      const attempt = async (
        suppliedHandoff?: WhatsappProviderHandoffView,
        terminalPublication?: IWhatsappProviderHandoffRecoveryCentrifugo
      ): Promise<boolean> => {
        let handoff = suppliedHandoff;
        if (!handoff) {
          const result = await channelsStore.viewWhatsappProviderHandoff(
            candidate.workerId,
            { silent: true }
          );
          handoff = result.kind === 'found' ? result.handoff : undefined;
        }
        if (
          disposed ||
          !handoff ||
          !matchesCandidate(handoff, candidate) ||
          (terminalPublication &&
            !matchesRecoveryPublication(handoff, terminalPublication))
        ) {
          return false;
        }

        const recovered = await channelsStore.getWorkerById(candidate.workerId);
        if (disposed || !recovered) return false;
        const acceptance =
          presentationStore.reconcileProviderHandoffSourceRecovery(
            recovered,
            handoff
          );
        const legacyAccepted = acceptance
          ? channelsStore.applyCanonicalProviderHandoffSourceRecovery(
              recovered,
              acceptance
            )
          : false;
        const reconciled = Boolean(acceptance && legacyAccepted);
        if (reconciled) {
          settled.add(key);
          settled.add(durableHandoffKey(handoff));
        }
        return reconciled;
      };

      try {
        let handoff = knownHandoff;
        let publication = recoveryPublication;
        while (!disposed) {
          if (await attempt(handoff, publication)) return true;
          const pendingKnownHandoff = flight.pendingKnownHandoff;
          const pendingRecoveryPublication = flight.pendingRecoveryPublication;
          flight.pendingKnownHandoff = undefined;
          flight.pendingRecoveryPublication = undefined;
          if (!pendingKnownHandoff && !pendingRecoveryPublication) {
            return false;
          }
          handoff = pendingKnownHandoff;
          publication = pendingRecoveryPublication;
        }
        return false;
      } finally {
        // This runs inside the async body before its promise settles. A later
        // completed snapshot therefore either joins the loop above or sees no
        // flight and starts a new attempt; there is no lost-finalization gap.
        if (inFlight.get(key) === flight) inFlight.delete(key);
      }
    });
    return flight.promise;
  };

  const reconcileKnownHandoff = async (
    handoff: WhatsappProviderHandoffView
  ): Promise<boolean> => {
    const lifecycleOperationId = handoffLifecycleOperationId(handoff);
    if (!lifecycleOperationId) return false;
    return execute(
      {
        workerId: handoff.worker_id,
        lifecycleOperationId,
        marker: {
          handoff_id: handoff.handoff_id,
          lifecycle_operation_id: lifecycleOperationId,
          source_provider: handoff.source_provider,
          target_provider: handoff.target_provider,
        },
      },
      handoff
    );
  };

  const refreshWorker = async (workerId: string): Promise<void> => {
    await Promise.all(
      candidates.value
        .filter((candidate) => candidate.workerId === workerId)
        .map((candidate) => execute(candidate))
    );
  };

  const refreshFromLifecyclePublication = async (
    event: IBaileysConnectionState
  ): Promise<void> => {
    const relevant = candidates.value.filter(
      (candidate) =>
        candidate.workerId === event.worker_id &&
        (event.lifecycle_operation_id === candidate.lifecycleOperationId ||
          event.worker_status_id === EWorkerStatus.error ||
          event.worker_status_id === EWorkerStatus.online ||
          event.worker_status_id === EWorkerStatus.disponible)
    );
    await Promise.all(relevant.map((candidate) => execute(candidate)));
  };

  const refreshFromRecoveryPublication = async (
    event: IWhatsappProviderHandoffRecoveryCentrifugo,
    expectedAccountId: string
  ): Promise<void> => {
    if (
      event.account_id !== expectedAccountId ||
      event.recovery_state !== 'completed' ||
      !event.worker_id.trim() ||
      !event.handoff_id.trim() ||
      !event.handoff_lifecycle_operation_id.trim() ||
      !event.recovery_operation_id.trim() ||
      event.recovery_operation_id === event.handoff_lifecycle_operation_id
    ) {
      return;
    }

    const relevant = candidates.value.filter((candidate) => {
      if (
        candidate.workerId !== event.worker_id ||
        candidate.lifecycleOperationId !== event.handoff_lifecycle_operation_id
      ) {
        return false;
      }
      const marker = candidate.marker;
      return (
        !marker ||
        (marker.handoff_id === event.handoff_id &&
          marker.source_provider === event.source_provider &&
          marker.target_provider === event.target_provider)
      );
    });

    await Promise.all(
      relevant.map((candidate) => execute(candidate, undefined, event))
    );
  };

  const refreshAll = async (): Promise<void> => {
    await Promise.all(candidates.value.map((candidate) => execute(candidate)));
  };

  watch(candidateSignature, () => void refreshAll(), { immediate: true });
  onBeforeUnmount(() => {
    disposed = true;
    inFlight.clear();
    settled.clear();
  });

  return {
    reconcileKnownHandoff,
    refreshWorker,
    refreshFromLifecyclePublication,
    refreshFromRecoveryPublication,
    refreshAll,
  };
}
