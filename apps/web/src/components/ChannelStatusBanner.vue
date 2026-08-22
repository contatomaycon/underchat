<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { useChatStore } from '@/@webcore/stores/chat';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import {
  canonicalSnapshotIncludesPublication,
  isSessionRemovalTerminalPublication,
  offlineChannelStatusPresentationSnapshot,
  type ChannelStatusPresentationSnapshot,
  useChannelStatusPresentationStore,
} from '@/@webcore/stores/channelStatusPresentation';
import { resolveChannelStatusPresentation } from '@/@webcore/utils/channelStatusPresentation';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { useI18n } from 'vue-i18n';
import { fetchRecentHistoryAndProcess } from '@/@webcore/centrifugo';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import {
  getUser,
  getChannels,
  USER_CHANNELS_UPDATED_EVENT,
} from '@/@webcore/localStorage/user';
import { logLocalConnectionStatus } from '@/@webcore/utils/localConnectionStatusLog';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  compareWhatsappConnectionStatusOrders,
  evaluateWhatsappRealtimeStatusFence,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusOrder,
  normalizeWhatsappConnectionStatusSourceId,
  projectWhatsappChannelDisplayStatus,
} from '@core/common/functions/whatsappConnectionStatus';
import { useResilientCentrifugoSubscription } from '@/composables/useResilientCentrifugoSubscription';
import {
  isManagerWorkerRecreateCompletedStatusEvent,
  normalizeWorkerLifecycleOperationId,
} from '@core/common/functions/workerLifecycleRealtimeStatus';
import { createManagerWorkerLifecycleRuntimeFence } from '@core/common/functions/managerWorkerLifecycleRuntimeFence';

const { t } = useI18n();
const router = useRouter();
const chatStore = useChatStore();
const dashboardStore = useDashboardStore();
const channelStatusPresentationStore = useChannelStatusPresentationStore();

const createUserChannelMap = (): Map<string, string> => {
  return new Map(getChannels().map((ch) => [ch.id, ch.name]));
};

const userChannelsById = shallowRef<Map<string, string>>(
  createUserChannelMap()
);
const hiddenLifecycleDeletionStatuses = new Set<string>([
  EWorkerStatus.deleting,
  EWorkerStatus.delete,
]);
const nativeConnectionOrderByWorker = new Map<string, string>();
const persistedWorkerTypeByWorker = new Map<string, string>();
const runtimeGenerationByWorker = new Map<string, number>();
const workerStatusOffsetByWorker = new Map<string, number>();
const managerLifecycleRuntimeFence = createManagerWorkerLifecycleRuntimeFence();

const refreshUserChannels = () => {
  userChannelsById.value = createUserChannelMap();
};

const channelPresentation = (
  channel: (typeof dashboardStore.offlineChannels)[number]
) =>
  resolveChannelStatusPresentation(
    channelStatusPresentationStore.snapshot(channel.id) ??
      offlineChannelStatusPresentationSnapshot(channel),
    t
  );

const seedNativeConnectionOrdering = () => {
  for (const channel of dashboardStore.offlineChannels) {
    channelStatusPresentationStore.hydrateOfflineChannel(channel);
    const presentationSnapshot = channelStatusPresentationStore.snapshot(
      channel.id
    );
    if (presentationSnapshot) {
      managerLifecycleRuntimeFence.synchronizeAuthoritativeState({
        workerId: channel.id,
        activeOperationId: presentationSnapshot.lifecycleOperationId,
        completedOperationId:
          presentationSnapshot.completedLifecycleOperationId,
      });
    }
    const persistedRuntimeGeneration = runtimeGenerationByWorker.get(
      channel.id
    );
    if (
      managerLifecycleRuntimeFence.hasActiveOperation(channel.id) &&
      !managerLifecycleRuntimeFence.acceptProviderRuntime({
        workerId: channel.id,
        persistedRuntimeGeneration,
        eventRuntimeGeneration: channel.runtime_generation,
      })
    ) {
      if (channel.status?.id !== EWorkerStatus.recreating) {
        dashboardStore.applyDashboardChannelEffectiveStatus(
          channel.id,
          EWorkerStatus.recreating
        );
        dashboardStore.updateOfflineChannelStatus(
          channel.id,
          EWorkerStatus.recreating,
          t('recreating'),
          channel.name
        );
      }
      const fencedChannel = dashboardStore.offlineChannels.find(
        (item) => item.id === channel.id
      );
      if (fencedChannel) {
        channelStatusPresentationStore.hydrateOfflineChannel(fencedChannel);
      }
      continue;
    }
    if (channel.worker_type_id) {
      persistedWorkerTypeByWorker.set(channel.id, channel.worker_type_id);
    }
    if (channel.runtime_generation) {
      runtimeGenerationByWorker.set(channel.id, channel.runtime_generation);
    }
    const order = normalizeWhatsappConnectionStatusOrder(
      channel.connection_status_order
    );
    const current = nativeConnectionOrderByWorker.get(channel.id);
    if (
      order &&
      (!current || compareWhatsappConnectionStatusOrders(order, current) > 0)
    ) {
      nativeConnectionOrderByWorker.set(channel.id, order);
    }
  }
};

const offlineChannels = computed(() => {
  const visibleOfflineChannels = dashboardStore.offlineChannels.filter(
    (ch) =>
      !hiddenLifecycleDeletionStatuses.has(ch.status?.id ?? '') &&
      !channelPresentation(ch).online
  );

  if (userChannelsById.value.size === 0) return visibleOfflineChannels;
  return visibleOfflineChannels.filter((ch) =>
    userChannelsById.value.has(ch.id)
  );
});

watch(
  () => dashboardStore.offlineChannels,
  () => seedNativeConnectionOrdering(),
  { immediate: true }
);

const prioritizedChannels = computed(() => {
  const activeWorkerId = chatStore.activeChat?.worker?.id;
  const channels = [...offlineChannels.value];

  if (activeWorkerId) {
    const activeIndex = channels.findIndex(
      (channel) => channel.id === activeWorkerId
    );
    if (activeIndex > -1) {
      const [activeChannel] = channels.splice(activeIndex, 1);
      channels.unshift(activeChannel);
    }
  }

  return channels;
});

const displayedChannels = computed(() => {
  return prioritizedChannels.value.slice(0, 2);
});

const displayedChannelPresentations = computed(() =>
  displayedChannels.value.map((channel) => ({
    channel,
    presentation: channelPresentation(channel),
  }))
);

const remainingChannels = computed(() => {
  return prioritizedChannels.value.slice(2);
});

const remainingChannelsCount = computed(() => {
  return remainingChannels.value.length;
});

const remainingChannelsNames = computed(() => {
  return remainingChannels.value.map((channel) => channel.name).join(', ');
});

const shouldShowBanner = computed(() => {
  return offlineChannels.value.length > 0;
});

const handleClick = () => {
  router.push('/channels');
};

const reconcileOfflineChannels = async () => {
  // This component can be unmounted while status publications continue. A
  // non-empty Pinia list does not prove it is complete, so always reconcile
  // once on mount. `force` only bypasses the short client-side cache; there is
  // no polling loop.
  const [, channelStatuses] = await Promise.all([
    dashboardStore.getDashboardOfflineChannels(true),
    dashboardStore.getDashboardChannelsStatus(),
  ]);
  for (const channel of channelStatuses ?? []) {
    persistedWorkerTypeByWorker.set(channel.id, channel.worker_type_id);
    channelStatusPresentationStore.hydrateDashboardChannelStatus(channel);
    const presentationSnapshot = channelStatusPresentationStore.snapshot(
      channel.id
    );
    if (presentationSnapshot) {
      managerLifecycleRuntimeFence.synchronizeAuthoritativeState({
        workerId: channel.id,
        activeOperationId: presentationSnapshot.lifecycleOperationId,
        completedOperationId:
          presentationSnapshot.completedLifecycleOperationId,
      });
      const presentation = resolveChannelStatusPresentation(
        presentationSnapshot,
        t
      );
      if (presentationSnapshot.workerStatusId) {
        dashboardStore.applyDashboardChannelEffectiveStatus(
          channel.id,
          presentationSnapshot.workerStatusId
        );
      }
      if (presentation.online) {
        dashboardStore.removeOfflineChannel(channel.id);
      } else {
        dashboardStore.applyOfflineChannelStatusEvent({
          channelId: channel.id,
          channelName: channel.name,
          workerTypeId: presentationSnapshot.workerTypeId,
          statusId: presentationSnapshot.workerStatusId,
          statusName: getStatusName(presentationSnapshot.workerStatusId),
          workerStatusObservedAt: presentationSnapshot.workerStatusObservedAt,
          connectionStatus: presentationSnapshot.connectionStatus,
          connectionStatusSourceId:
            presentationSnapshot.connectionStatusSourceId,
          connectionStatusOrder: presentationSnapshot.connectionStatusOrder,
          connectionOnlineAcknowledged:
            presentationSnapshot.connectionOnlineAcknowledged,
          runtimeGeneration: presentationSnapshot.runtimeGeneration,
        });
      }
    }
    if (channel.runtime_generation) {
      runtimeGenerationByWorker.set(channel.id, channel.runtime_generation);
    }
  }
  seedNativeConnectionOrdering();
};

const getStatusName = (statusId: string | undefined | null): string | null => {
  if (!statusId) return null;

  if (statusId === EWorkerStatus.offline) return t('offline');
  if (statusId === EWorkerStatus.disponible) return t('awaiting_qr_code');
  if (statusId === EWorkerStatus.connecting) return t('connecting');
  if (statusId === EWorkerStatus.error) return t('error');
  if (statusId === EWorkerStatus.mismatched) return t('mismatched');
  if (statusId === EWorkerStatus.deleting) return t('deleting');
  if (statusId === EWorkerStatus.delete) return t('deletion_pending');
  if (statusId === EWorkerStatus.stopped) return t('stopped');
  if (statusId === EWorkerStatus.recreating) return t('recreating');
  if (statusId === EWorkerStatus.blocked) return t('blocked_by_plan');
  if (statusId === EWorkerStatus.creating) return t('creating');
  if (statusId === EWorkerStatus.recreating) return t('recreating');
  if (statusId === EWorkerStatus.new) return t('new');

  return null;
};

const user = getUser();

const handleUserChannelsUpdated = () => {
  refreshUserChannels();
};

const handleStorage = (event: StorageEvent) => {
  if (event.key === 'channels') {
    refreshUserChannels();
  }
};

const workerStatusHandler = (
  data: IBaileysConnectionState,
  context?: { offset?: number }
) => {
  const offset = context?.offset;
  if (offset) {
    const currentOffset = workerStatusOffsetByWorker.get(data.worker_id);
    if (currentOffset && offset <= currentOffset) return;
    workerStatusOffsetByWorker.set(data.worker_id, offset);
  }

  // Presentation has its own canonical op/generation/outbox reducer. It must
  // see exact same-generation runtime_started/native events before the
  // banner's older strictly-newer-runtime fence handles dashboard side effects.
  const presentationAccepted =
    channelStatusPresentationStore.applyRealtimeEvent(data);
  const presentationSnapshot = channelStatusPresentationStore.snapshot(
    data.worker_id
  );
  // The route page and this global banner can receive the same publication.
  // A duplicate reducer call may be rejected by cursor ordering even though
  // the canonical snapshot already contains that exact event; dashboard side
  // effects must still converge in that case.
  const presentationObserved =
    presentationAccepted ||
    canonicalSnapshotIncludesPublication(presentationSnapshot, data);

  logLocalConnectionStatus('web.status_banner.worker_status.received', {
    layer: 'web.status_banner',
    worker_id: data.worker_id,
    worker_name: data.worker_name,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    worker_status_id: data.worker_status_id,
    status: data.status,
    code: data.code,
    session_ready: data.session_ready,
    can_send: data.can_send,
    can_receive_runtime: data.can_receive_runtime,
    authenticated: data.authenticated,
    provider_state: data.provider_state,
    degraded_reason: data.degraded_reason,
    phone: data.phone,
    connection_attempt_id: data.connection_attempt_id,
    runtime_generation: data.runtime_generation,
  });

  const existing = dashboardStore.offlineChannels.find(
    (channel) => channel.id === data.worker_id
  );
  const mutatesWorkerStatus = data.event_type === 'status';
  const statusId = mutatesWorkerStatus
    ? data.worker_status_id
    : existing?.status?.id;
  const persistedWorkerTypeId =
    persistedWorkerTypeByWorker.get(data.worker_id) ?? existing?.worker_type_id;

  // Deletion belongs to the manager lifecycle, not to the WhatsApp provider
  // stream. A pending deletion remains visible in the channel table, but it
  // must leave this connectivity-alert banner immediately. Handle both the
  // pending and terminal states before provider/runtime fencing.
  if (
    mutatesWorkerStatus &&
    (statusId === EWorkerStatus.delete || statusId === EWorkerStatus.deleting)
  ) {
    nativeConnectionOrderByWorker.delete(data.worker_id);
    persistedWorkerTypeByWorker.delete(data.worker_id);
    runtimeGenerationByWorker.delete(data.worker_id);
    managerLifecycleRuntimeFence.forget(data.worker_id);
    dashboardStore.removeDashboardChannelEffectiveStatus(data.worker_id);
    dashboardStore.removeOfflineChannel(data.worker_id);
    return;
  }

  if (
    isSessionRemovalTerminalPublication(data) &&
    presentationObserved &&
    presentationSnapshot
  ) {
    const channelName =
      data.worker_name ??
      existing?.name ??
      userChannelsById.value.get(data.worker_id) ??
      '';
    nativeConnectionOrderByWorker.delete(data.worker_id);
    managerLifecycleRuntimeFence.forget(data.worker_id);
    if (presentationSnapshot.workerTypeId) {
      persistedWorkerTypeByWorker.set(
        data.worker_id,
        presentationSnapshot.workerTypeId
      );
    }
    if (presentationSnapshot.runtimeGeneration) {
      runtimeGenerationByWorker.set(
        data.worker_id,
        presentationSnapshot.runtimeGeneration
      );
    }
    dashboardStore.applyDashboardChannelEffectiveStatus(
      data.worker_id,
      EWorkerStatus.disponible
    );
    dashboardStore.applyOfflineChannelStatusEvent({
      channelId: data.worker_id,
      channelName,
      workerTypeId: presentationSnapshot.workerTypeId,
      statusId: EWorkerStatus.disponible,
      statusName: getStatusName(EWorkerStatus.disponible),
      workerStatusObservedAt: presentationSnapshot.workerStatusObservedAt,
      connectionStatus: null,
      connectionStatusSourceId: null,
      connectionStatusOrder: null,
      connectionOnlineAcknowledged: false,
      runtimeGeneration: presentationSnapshot.runtimeGeneration,
    });
    return;
  }

  const synchronizeAcceptedPresentationFence = (
    snapshot: ChannelStatusPresentationSnapshot
  ): boolean =>
    managerLifecycleRuntimeFence.synchronizeAuthoritativeState({
      workerId: data.worker_id,
      activeOperationId: snapshot.lifecycleOperationId,
      completedOperationId: snapshot.completedLifecycleOperationId,
    });

  // Membership and the legacy side-effect fence follow the canonical reducer.
  // A missed `started` event can still be recovered from `runtime_started`, but
  // presentation remains recreating until an ordered native status proves that
  // WhatsApp connection or pairing actually began.
  if (
    presentationObserved &&
    presentationSnapshot?.lifecycleOperationId &&
    presentationSnapshot.recreatePhase
  ) {
    if (!synchronizeAcceptedPresentationFence(presentationSnapshot)) return;
    if (presentationSnapshot.workerTypeId) {
      persistedWorkerTypeByWorker.set(
        data.worker_id,
        presentationSnapshot.workerTypeId
      );
    }
    if (presentationSnapshot.runtimeGeneration) {
      runtimeGenerationByWorker.set(
        data.worker_id,
        presentationSnapshot.runtimeGeneration
      );
    }
    dashboardStore.applyDashboardChannelEffectiveStatus(
      data.worker_id,
      EWorkerStatus.recreating
    );
    dashboardStore.applyOfflineChannelStatusEvent({
      channelId: data.worker_id,
      channelName:
        data.worker_name ?? userChannelsById.value.get(data.worker_id),
      workerTypeId: presentationSnapshot.workerTypeId,
      statusId: EWorkerStatus.recreating,
      statusName: getStatusName(EWorkerStatus.recreating),
      workerStatusObservedAt: presentationSnapshot.workerStatusObservedAt,
      connectionStatus: presentationSnapshot.connectionStatus,
      connectionStatusSourceId: presentationSnapshot.connectionStatusSourceId,
      connectionStatusOrder: presentationSnapshot.connectionStatusOrder,
      connectionOnlineAcknowledged: false,
      runtimeGeneration: presentationSnapshot.runtimeGeneration,
    });
    return;
  }

  if (
    data.lifecycle_source !== undefined ||
    data.lifecycle_action !== undefined ||
    data.lifecycle_phase !== undefined
  ) {
    const operationId = normalizeWorkerLifecycleOperationId(
      data.lifecycle_operation_id
    );
    if (
      !presentationObserved ||
      !presentationSnapshot ||
      !operationId ||
      !isManagerWorkerRecreateCompletedStatusEvent(data) ||
      presentationSnapshot.lifecycleOperationId ||
      presentationSnapshot.completedLifecycleOperationId !== operationId ||
      presentationSnapshot.completedLifecycleRuntimeGeneration !==
        data.runtime_generation ||
      !synchronizeAcceptedPresentationFence(presentationSnapshot)
    ) {
      logLocalConnectionStatus(
        'web.status_banner.manager_lifecycle.fence_rejected',
        {
          layer: 'web.status_banner',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          worker_status_id: data.worker_status_id,
          lifecycle_operation_id: data.lifecycle_operation_id,
          runtime_generation: data.runtime_generation,
          reason: 'canonical_presentation_rejected',
        }
      );
      return;
    }

    if (presentationSnapshot.workerTypeId) {
      persistedWorkerTypeByWorker.set(
        data.worker_id,
        presentationSnapshot.workerTypeId
      );
    }
    if (presentationSnapshot.runtimeGeneration) {
      runtimeGenerationByWorker.set(
        data.worker_id,
        presentationSnapshot.runtimeGeneration
      );
    }
    const terminalStatusId = presentationSnapshot.workerStatusId;
    if (
      terminalStatusId !== EWorkerStatus.online &&
      terminalStatusId !== EWorkerStatus.disponible
    ) {
      return;
    }
    dashboardStore.applyDashboardChannelEffectiveStatus(
      data.worker_id,
      terminalStatusId
    );
    if (terminalStatusId === EWorkerStatus.online) {
      dashboardStore.removeOfflineChannel(data.worker_id);
    } else {
      dashboardStore.applyOfflineChannelStatusEvent({
        channelId: data.worker_id,
        channelName:
          data.worker_name ?? userChannelsById.value.get(data.worker_id),
        workerTypeId: presentationSnapshot.workerTypeId,
        statusId: EWorkerStatus.disponible,
        statusName: getStatusName(EWorkerStatus.disponible),
        workerStatusObservedAt: presentationSnapshot.workerStatusObservedAt,
        connectionStatus: presentationSnapshot.connectionStatus,
        connectionOnlineAcknowledged: false,
        runtimeGeneration: presentationSnapshot.runtimeGeneration,
      });
    }
    logLocalConnectionStatus('web.status_banner.manager_lifecycle.completed', {
      layer: 'web.status_banner',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: presentationSnapshot.workerTypeId,
      worker_status_id: terminalStatusId,
      lifecycle_operation_id: operationId,
      runtime_generation: presentationSnapshot.runtimeGeneration,
      reason: data.reason,
    });
    return;
  }

  // The canonical reducer also owns terminal cursor/tombstone ordering for
  // provider and raw status publications. A rejected pre-completion event must
  // not recreate a synthetic offline row that a subsequent watcher could
  // hydrate back over the accepted terminal snapshot.
  if (!presentationObserved) return;

  const provider =
    (data.worker_type_id ?? persistedWorkerTypeId) === EWorkerType.baileys
      ? 'baileys'
      : (data.worker_type_id ?? persistedWorkerTypeId) === EWorkerType.wwebjs
        ? 'wwebjs'
        : (data.worker_type_id ?? persistedWorkerTypeId) ===
            EWorkerType.whatsmeow
          ? 'whatsmeow'
          : undefined;
  const snapshot = provider
    ? normalizeWhatsappConnectionStatus(data.connection_status, provider)
    : undefined;
  if (data.connection_status !== undefined) {
    const sourceId = normalizeWhatsappConnectionStatusSourceId(
      data.connection_status_source_id
    );
    const order = normalizeWhatsappConnectionStatusOrder(
      data.connection_status_order
    );
    if (!snapshot || !sourceId || !order) {
      logLocalConnectionStatus('web.status_banner.native_status.ignored', {
        layer: 'web.status_banner',
        worker_id: data.worker_id,
        reason: 'invalid_native_envelope_or_order',
      });
      return;
    }

    const currentOrder =
      nativeConnectionOrderByWorker.get(data.worker_id) ??
      normalizeWhatsappConnectionStatusOrder(existing?.connection_status_order);
    if (
      currentOrder &&
      compareWhatsappConnectionStatusOrders(order, currentOrder) < 0
    ) {
      return;
    }
    const realtimeFence = evaluateWhatsappRealtimeStatusFence({
      persistedWorkerTypeId,
      eventWorkerTypeId: data.worker_type_id,
      persistedRuntimeGeneration:
        runtimeGenerationByWorker.get(data.worker_id) ??
        existing?.runtime_generation,
      eventRuntimeGeneration: data.runtime_generation,
      persistedConnectionStatusOrder: currentOrder,
      hasValidatedNativeProjection: true,
    });
    if (!realtimeFence.accepted) {
      logLocalConnectionStatus('web.status_banner.realtime_fence.ignored', {
        layer: 'web.status_banner',
        worker_id: data.worker_id,
        worker_type_id: data.worker_type_id,
        persisted_worker_type_id: persistedWorkerTypeId,
        runtime_generation: data.runtime_generation,
        reason: realtimeFence.reason,
      });
      return;
    }
    if (
      !managerLifecycleRuntimeFence.acceptProviderRuntime({
        workerId: data.worker_id,
        persistedRuntimeGeneration:
          runtimeGenerationByWorker.get(data.worker_id) ??
          existing?.runtime_generation,
        eventRuntimeGeneration: realtimeFence.runtimeGeneration,
      })
    ) {
      logLocalConnectionStatus(
        'web.status_banner.manager_lifecycle.runtime_not_advanced',
        {
          layer: 'web.status_banner',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          worker_status_id: data.worker_status_id,
          runtime_generation: data.runtime_generation,
        }
      );
      return;
    }
    const canonicalWorkerTypeId =
      presentationSnapshot?.workerTypeId ?? realtimeFence.workerTypeId;
    const canonicalRuntimeGeneration =
      presentationSnapshot?.runtimeGeneration ??
      realtimeFence.runtimeGeneration ??
      null;
    const canonicalOrder = presentationSnapshot?.connectionStatusOrder;
    const canonicalSourceId = presentationSnapshot?.connectionStatusSourceId;
    const canonicalConnectionStatus = presentationSnapshot?.connectionStatus;
    if (!canonicalOrder || !canonicalSourceId || !canonicalConnectionStatus) {
      return;
    }
    persistedWorkerTypeByWorker.set(data.worker_id, canonicalWorkerTypeId);
    if (canonicalRuntimeGeneration) {
      runtimeGenerationByWorker.set(data.worker_id, canonicalRuntimeGeneration);
    }
    nativeConnectionOrderByWorker.set(data.worker_id, canonicalOrder);

    const publicStatus = canonicalConnectionStatus;
    const onlineAcknowledged =
      publicStatus === 'online' &&
      presentationSnapshot?.connectionOnlineAcknowledged === true;
    const effectiveStatusId =
      presentationSnapshot?.workerStatusId ??
      (onlineAcknowledged ? EWorkerStatus.online : existing?.status?.id);
    const display = projectWhatsappChannelDisplayStatus({
      workerTypeId: canonicalWorkerTypeId,
      workerStatusId: effectiveStatusId,
      recreatePhase: presentationSnapshot?.recreatePhase,
      connectionStatus: publicStatus,
      connectionOnlineAcknowledged: onlineAcknowledged,
    });
    dashboardStore.applyDashboardChannelEffectiveStatus(
      data.worker_id,
      display.kind === 'connection'
        ? display.connectionStatus === 'online'
          ? EWorkerStatus.online
          : EWorkerStatus.offline
        : display.workerStatusId,
      canonicalOrder
    );

    if (
      display.kind === 'connection' &&
      display.connectionStatus === 'online'
    ) {
      dashboardStore.removeOfflineChannel(data.worker_id);
      return;
    }

    dashboardStore.applyOfflineChannelStatusEvent({
      channelId: data.worker_id,
      channelName:
        data.worker_name ?? userChannelsById.value.get(data.worker_id),
      workerTypeId: canonicalWorkerTypeId,
      statusId: effectiveStatusId,
      statusName: getStatusName(effectiveStatusId),
      workerStatusObservedAt: presentationSnapshot?.workerStatusObservedAt,
      connectionStatus: publicStatus,
      connectionStatusSourceId: canonicalSourceId,
      connectionStatusSequence: snapshot.sequence,
      connectionStatusChangedAt: snapshot.changedAt,
      connectionStatusOrder: canonicalOrder,
      connectionOnlineAcknowledged: onlineAcknowledged,
      runtimeGeneration: canonicalRuntimeGeneration,
    });
    return;
  }

  if (!mutatesWorkerStatus || !statusId) {
    logLocalConnectionStatus('web.status_banner.worker_status.ignored', {
      layer: 'web.status_banner',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      status: data.status,
      code: data.code,
      reason: mutatesWorkerStatus
        ? 'missing_worker_status_id'
        : 'telemetry_without_native_status',
    });
    return;
  }
  if (
    data.connection_status_source_id !== undefined ||
    data.connection_status_order !== undefined
  ) {
    logLocalConnectionStatus('web.status_banner.native_status.ignored', {
      layer: 'web.status_banner',
      worker_id: data.worker_id,
      reason: 'native_metadata_without_envelope',
    });
    return;
  }

  const realtimeFence = evaluateWhatsappRealtimeStatusFence({
    persistedWorkerTypeId,
    eventWorkerTypeId: data.worker_type_id,
    persistedRuntimeGeneration:
      runtimeGenerationByWorker.get(data.worker_id) ??
      existing?.runtime_generation,
    eventRuntimeGeneration: data.runtime_generation,
    persistedConnectionStatusOrder:
      nativeConnectionOrderByWorker.get(data.worker_id) ??
      existing?.connection_status_order,
    hasValidatedNativeProjection: false,
  });
  if (!realtimeFence.accepted) {
    logLocalConnectionStatus('web.status_banner.realtime_fence.ignored', {
      layer: 'web.status_banner',
      worker_id: data.worker_id,
      worker_type_id: data.worker_type_id,
      persisted_worker_type_id: persistedWorkerTypeId,
      runtime_generation: data.runtime_generation,
      reason: realtimeFence.reason,
    });
    return;
  }
  if (
    !managerLifecycleRuntimeFence.acceptProviderRuntime({
      workerId: data.worker_id,
      persistedRuntimeGeneration:
        runtimeGenerationByWorker.get(data.worker_id) ??
        existing?.runtime_generation,
      eventRuntimeGeneration: realtimeFence.runtimeGeneration,
    })
  ) {
    logLocalConnectionStatus(
      'web.status_banner.manager_lifecycle.runtime_not_advanced',
      {
        layer: 'web.status_banner',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        worker_status_id: data.worker_status_id,
        runtime_generation: data.runtime_generation,
      }
    );
    return;
  }
  const canonicalWorkerTypeId =
    presentationSnapshot?.workerTypeId ?? realtimeFence.workerTypeId;
  const canonicalRuntimeGeneration =
    presentationSnapshot?.runtimeGeneration ??
    realtimeFence.runtimeGeneration ??
    null;
  const canonicalStatusId = presentationSnapshot?.workerStatusId;
  if (!canonicalStatusId) return;
  persistedWorkerTypeByWorker.set(data.worker_id, canonicalWorkerTypeId);
  if (canonicalRuntimeGeneration) {
    runtimeGenerationByWorker.set(data.worker_id, canonicalRuntimeGeneration);
  }
  const channelName =
    data.worker_name ?? userChannelsById.value.get(data.worker_id);
  const display = projectWhatsappChannelDisplayStatus({
    workerTypeId: canonicalWorkerTypeId,
    workerStatusId: canonicalStatusId,
    recreatePhase: presentationSnapshot?.recreatePhase,
    connectionStatus: presentationSnapshot?.connectionStatus,
    connectionOnlineAcknowledged:
      presentationSnapshot?.connectionOnlineAcknowledged === true,
  });
  dashboardStore.applyDashboardChannelEffectiveStatus(
    data.worker_id,
    display.kind === 'connection'
      ? display.connectionStatus === 'online'
        ? EWorkerStatus.online
        : EWorkerStatus.offline
      : display.workerStatusId
  );
  if (
    display.kind === 'worker' &&
    display.workerStatusId === EWorkerStatus.online
  ) {
    dashboardStore.removeOfflineChannel(data.worker_id);
    return;
  }
  const connectionStatus =
    display.kind === 'connection' ? display.connectionStatus : null;

  dashboardStore.applyOfflineChannelStatusEvent({
    channelId: data.worker_id,
    channelName,
    workerTypeId: canonicalWorkerTypeId,
    statusId: canonicalStatusId,
    statusName: getStatusName(canonicalStatusId),
    workerStatusObservedAt: presentationSnapshot?.workerStatusObservedAt,
    connectionStatus,
    connectionOnlineAcknowledged: false,
    runtimeGeneration: canonicalRuntimeGeneration,
  });
  logLocalConnectionStatus('web.status_banner.worker_status.offline_applied', {
    layer: 'web.status_banner',
    worker_id: data.worker_id,
    worker_name: channelName,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    worker_status_id: statusId,
    status: data.status,
    code: data.code,
    session_ready: data.session_ready,
    status_name: getStatusName(statusId),
  });
};

useResilientCentrifugoSubscription({
  channel: () =>
    user?.account_id ? workerCentrifugoQueue(user.account_id) : null,
  handler: workerStatusHandler,
  acknowledgeRecoveryAfterSubscribed: true,
  onSubscribed: async (channel) => {
    await fetchRecentHistoryAndProcess(channel, workerStatusHandler, 500);
    await reconcileOfflineChannels();
  },
  debugContext: () => ({
    account_id: user?.account_id,
    layer: 'web.status_banner',
  }),
});

onMounted(async () => {
  window.addEventListener(
    USER_CHANNELS_UPDATED_EVENT,
    handleUserChannelsUpdated
  );
  window.addEventListener('storage', handleStorage);

  try {
    await reconcileOfflineChannels();
    seedNativeConnectionOrdering();
  } catch (error) {
    if (!isAxiosError(error) || error.response?.status !== 401) {
      if (import.meta.env.DEV) {
        console.error(
          'Failed to load offline channels for status banner',
          error
        );
      }
    }
  }
});

onUnmounted(() => {
  window.removeEventListener(
    USER_CHANNELS_UPDATED_EVENT,
    handleUserChannelsUpdated
  );
  window.removeEventListener('storage', handleStorage);
});
</script>

<template>
  <div
    v-if="shouldShowBanner"
    class="channel-status-banner"
    @click="handleClick"
  >
    <div class="d-flex align-center gap-2">
      <template
        v-for="(
          { channel, presentation }, index
        ) in displayedChannelPresentations"
        :key="channel.id"
      >
        <div class="d-flex align-center gap-2">
          <span class="channel-name">{{ channel.name }}</span>
          <VChip :color="presentation.color" size="small">
            {{ presentation.text }}
          </VChip>
        </div>
        <VDivider
          v-if="
            index < displayedChannelPresentations.length - 1 ||
            remainingChannelsCount > 0
          "
          vertical
          class="mx-1"
        />
      </template>
      <VTooltip
        v-if="remainingChannelsCount > 0"
        :text="remainingChannelsNames"
        location="top"
      >
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="remaining-count">
            +{{ remainingChannelsCount }}
          </span>
        </template>
      </VTooltip>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.channel-status-banner {
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  .channel-name {
    font-weight: 500;
  }

  .remaining-count {
    font-weight: 500;
    color: rgb(var(--v-theme-primary));
    cursor: pointer;
  }
}
</style>
