import { computed, onBeforeUnmount, readonly, shallowRef } from 'vue';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { isWhatsappConnectionOnline } from '@core/common/functions/whatsappConnectionStatus';
import type { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { useChannelsStore } from '@/@webcore/stores/channels';
import type {
  WhatsappProviderHandoffAction,
  WhatsappProviderHandoffProvider,
  WhatsappProviderHandoffResolution,
  WhatsappProviderHandoffView,
} from '@/@webcore/interfaces/IWhatsappProviderHandoff';
import { logConnectionLifecycleDebug } from '@/@webcore/utils/connectionLifecycleDebug';

export interface WhatsappProviderHandoffMonitorContext {
  workerId: string;
  handoffId?: string;
  lifecycleOperationId: string;
  sourceProvider: WhatsappProviderHandoffProvider;
  targetProvider: WhatsappProviderHandoffProvider;
  targetWorkerType: EWorkerType;
  debugTraceId?: string;
  origin?: 'initiated' | 'resumed';
}

export type WhatsappProviderHandoffDecisionReason =
  'cancel' | 'failure' | 'timeout';

/**
 * The list and realtime projections can keep an audit marker for a completed
 * handoff. This is the single client-side proof used to avoid reopening that
 * stale recovery on reload: the active worker must be the requested target,
 * be durably online and have an acknowledged native connection.
 */
export interface WhatsappProviderHandoffTargetProjection {
  type?: { id?: EWorkerType | string | null } | null;
  status?: { id?: EWorkerStatus | string | null } | null;
  connection_status?: IWhatsappConnectionStatus | null;
  connection_online_acknowledged?: boolean | null;
}

interface UseWhatsappProviderHandoffRecoveryOptions {
  onRecoveryRequired?: (
    handoff: WhatsappProviderHandoffView,
    context: WhatsappProviderHandoffMonitorContext
  ) => void | Promise<void>;
  onSourceReturned?: (
    context: WhatsappProviderHandoffMonitorContext,
    handoff: WhatsappProviderHandoffView
  ) => void | Promise<void>;
  onTargetReady?: (
    context: WhatsappProviderHandoffMonitorContext,
    options: {
      freshSession: boolean;
      /**
       * The handoff journal is stale or absent, so the page must prove that
       * the target runtime is currently online before retiring recovery.
       */
      requireLiveTarget?: boolean;
    }
  ) => boolean | Promise<boolean>;
}

interface WhatsappProviderHandoffRefreshOptions {
  /**
   * The caller observed the operation in a terminal worker state. An absent
   * snapshot is final only in that case; an initial read can legitimately
   * happen before the handoff journal is persisted.
   */
  terminal?: boolean;
  /**
   * A lifecycle publication already proved that the target provider reached
   * an acknowledged online state. This is intentionally event-driven; it is
   * never derived from a timer or a repeated `latest` request.
   */
  targetReady?: boolean;
  /**
   * A dedicated durable terminal publication must not be lost behind the
   * older request it was sent to supersede. It queues one event-driven replay
   * for this monitor version; ordinary lifecycle messages keep coalescing.
   */
  replayIfInFlight?: boolean;
}

export function workerTypeToWhatsappProvider(
  workerType: EWorkerType | string | null | undefined
): WhatsappProviderHandoffProvider | null {
  if (workerType === EWorkerType.baileys) return 'baileys';
  if (workerType === EWorkerType.wwebjs) return 'wwebjs';
  if (workerType === EWorkerType.whatsmeow) return 'whatsmeow';
  return null;
}

export function whatsappProviderToWorkerType(
  provider: WhatsappProviderHandoffProvider
): EWorkerType {
  if (provider === 'baileys') return EWorkerType.baileys;
  if (provider === 'wwebjs') return EWorkerType.wwebjs;
  return EWorkerType.whatsmeow;
}

export function isWhatsappProviderHandoffTargetOnline(
  channel: WhatsappProviderHandoffTargetProjection | null | undefined,
  targetProvider: WhatsappProviderHandoffProvider
): boolean {
  return (
    workerTypeToWhatsappProvider(channel?.type?.id) === targetProvider &&
    channel?.status?.id === EWorkerStatus.online &&
    channel?.connection_online_acknowledged === true &&
    isWhatsappConnectionOnline(channel?.connection_status ?? undefined)
  );
}

export function useWhatsappProviderHandoffRecovery(
  options: UseWhatsappProviderHandoffRecoveryOptions = {}
) {
  const channelsStore = useChannelsStore();
  const activeContext = shallowRef<WhatsappProviderHandoffMonitorContext>();
  const handoff = shallowRef<WhatsappProviderHandoffView>();
  const isDialogVisible = shallowRef(false);
  const loadingAction = shallowRef<WhatsappProviderHandoffAction | null>(null);
  const pendingAction = shallowRef<WhatsappProviderHandoffAction | null>(null);
  const decisionReason =
    shallowRef<WhatsappProviderHandoffDecisionReason>('failure');
  const transientFailureCount = shallowRef(0);

  let monitorVersion = 0;
  let requestController: AbortController | null = null;
  let snapshotRequestVersion: number | null = null;
  let pendingRefreshOptions: WhatsappProviderHandoffRefreshOptions | null =
    null;
  let completed = false;
  let dismissedDialogState: string | null = null;

  const isActive = computed(() => Boolean(activeContext.value));

  const invalidatePendingRequest = () => {
    monitorVersion += 1;
    requestController?.abort();
    requestController = null;
    snapshotRequestVersion = null;
    pendingRefreshOptions = null;
  };

  const isCurrentRequest = (
    version: number,
    context: WhatsappProviderHandoffMonitorContext
  ): boolean => {
    const active = activeContext.value;
    return (
      version === monitorVersion &&
      active?.workerId === context.workerId &&
      active.lifecycleOperationId === context.lifecycleOperationId
    );
  };

  const isExpectedHandoff = (
    candidate: WhatsappProviderHandoffView,
    context: WhatsappProviderHandoffMonitorContext
  ): boolean => {
    const handoffOperationId =
      candidate.handoff_lifecycle_operation_id ??
      candidate.lifecycle_operation_id;
    const currentOperationMatches =
      candidate.lifecycle_operation_id === handoffOperationId ||
      (candidate.resolution_action === 'return' &&
        candidate.resolution_state === 'completed' &&
        candidate.resolution_operation_id !== null &&
        candidate.lifecycle_operation_id === candidate.resolution_operation_id);
    return (
      candidate.worker_id === context.workerId &&
      (!context.handoffId || candidate.handoff_id === context.handoffId) &&
      handoffOperationId === context.lifecycleOperationId &&
      currentOperationMatches &&
      candidate.source_provider === context.sourceProvider &&
      candidate.target_provider === context.targetProvider
    );
  };

  const dialogStateKey = (candidate: WhatsappProviderHandoffView): string =>
    `${candidate.handoff_id}:${candidate.resolution_action ?? 'decision'}:${
      candidate.resolution_state ?? candidate.resolution_status
    }`;

  const log = (
    event: string,
    context: WhatsappProviderHandoffMonitorContext,
    extra: Record<string, unknown> = {}
  ) => {
    logConnectionLifecycleDebug(event, {
      trace_id: context.debugTraceId,
      layer: 'web.provider_handoff',
      worker_id: context.workerId,
      worker_type_id: context.targetWorkerType,
      handoff_id: context.handoffId,
      lifecycle_operation_id: context.lifecycleOperationId,
      source_provider: context.sourceProvider,
      target_provider: context.targetProvider,
      ...extra,
    });
  };

  const finishSourceReturn = async (
    context: WhatsappProviderHandoffMonitorContext,
    version: number
  ) => {
    if (!isCurrentRequest(version, context) || completed) return;
    const sourceReturnHandoff = handoff.value;
    if (
      !sourceReturnHandoff ||
      !isExpectedHandoff(sourceReturnHandoff, context)
    ) {
      return;
    }
    completed = true;
    loadingAction.value = 'return';
    pendingAction.value = 'return';
    log('web.provider_handoff.source_returned', context, {
      status: 'completed',
    });
    try {
      await options.onSourceReturned?.(context, sourceReturnHandoff);
    } finally {
      if (isCurrentRequest(version, context)) {
        loadingAction.value = null;
        pendingAction.value = null;
        isDialogVisible.value = false;
        activeContext.value = undefined;
        handoff.value = undefined;
      }
    }
  };

  const finishTarget = async (
    context: WhatsappProviderHandoffMonitorContext,
    version: number,
    freshSession: boolean,
    finishOptions: { requireLiveTarget?: boolean } = {}
  ): Promise<boolean> => {
    if (!isCurrentRequest(version, context) || completed) return false;
    const targetReady =
      (await options.onTargetReady?.(context, {
        freshSession,
        ...(finishOptions.requireLiveTarget ? { requireLiveTarget: true } : {}),
      })) ?? true;
    if (!isCurrentRequest(version, context) || completed) return false;

    if (!targetReady) {
      // A lifecycle publication can arrive before the list projection. Do
      // not manufacture a polling loop here: the next relevant realtime
      // publication explicitly calls `refresh` again.
      loadingAction.value = null;
      pendingAction.value = null;
      log('web.provider_handoff.target_not_ready', context, {
        status: 'waiting',
        fresh_session: freshSession,
        require_live_target: finishOptions.requireLiveTarget === true,
      });
      return false;
    }

    completed = true;
    loadingAction.value = null;
    pendingAction.value = null;
    isDialogVisible.value = false;
    log('web.provider_handoff.target_ready', context, {
      status: 'completed',
      fresh_session: freshSession,
    });
    activeContext.value = undefined;
    handoff.value = undefined;
    return true;
  };

  const applyResolution = async (
    resolution: WhatsappProviderHandoffResolution,
    context: WhatsappProviderHandoffMonitorContext,
    version: number,
    action: WhatsappProviderHandoffAction
  ) => {
    if (!isCurrentRequest(version, context)) return;

    if (resolution.handoff && isExpectedHandoff(resolution.handoff, context)) {
      handoff.value = resolution.handoff;
    }

    log('web.provider_handoff.resolve_observed', context, {
      action,
      status: resolution.status,
      reason: resolution.reason,
      handoff_id: resolution.handoff?.handoff_id,
    });

    if (resolution.status === 'completed') {
      if (action === 'return') {
        await finishSourceReturn(context, version);
      } else {
        pendingAction.value = action;
        loadingAction.value = action;
        await finishTarget(context, version, true);
      }
      return;
    }

    if (resolution.status === 'blocked') {
      loadingAction.value = null;
      pendingAction.value = null;
      isDialogVisible.value = true;
      return;
    }

    // Queued decisions are observed from lifecycle/realtime publications.
    // Re-posting a decision on a fixed timer produced noisy requests and left
    // the dialog locked when an ordinary `latest` lookup returned no record.
    // `loadingAction` represents only the HTTP request itself. Once the
    // decision is durably queued, the dialog must remain usable while the
    // recovery worker finishes it asynchronously.
    pendingAction.value = action;
    loadingAction.value = null;
    isDialogVisible.value = true;
  };

  const handleAbsentSnapshot = async (
    context: WhatsappProviderHandoffMonitorContext,
    version: number,
    refreshOptions: WhatsappProviderHandoffRefreshOptions
  ): Promise<void> => {
    if (!isCurrentRequest(version, context)) return;

    // A successful target lifecycle event is stronger than a missing journal:
    // the journal can be compacted before this browser observes it. Let the
    // page verify the live target once and close the migration UI if it is
    // truly online; never turn this into a retry loop.
    if (refreshOptions.targetReady && options.onTargetReady) {
      const targetFinished = await finishTarget(context, version, false, {
        requireLiveTarget: true,
      });
      if (targetFinished) return;
    }

    const terminal = refreshOptions.terminal === true;

    // `latest` can be empty before the asynchronous handoff journal has been
    // created. Keep this exact monitor idle until its next lifecycle event;
    // that preserves the recovery dialog without reintroducing timer polling.
    loadingAction.value = null;
    if (pendingAction.value && !terminal) {
      // A queued decision has already been accepted by the API. An
      // immediately-following read can race a replica/journal transition;
      // retain the known-safe snapshot and wait for the next realtime event
      // instead of making the user believe the decision was lost.
      isDialogVisible.value = Boolean(handoff.value);
      log('web.provider_handoff.snapshot_absent_after_resolution', context, {
        status: 'not_found',
        action: pendingAction.value,
      });
      return;
    }

    pendingAction.value = null;
    handoff.value = undefined;
    isDialogVisible.value = false;
    if (terminal) {
      completed = true;
      activeContext.value = undefined;
    }
    log('web.provider_handoff.snapshot_absent', context, {
      status: 'not_found',
      terminal,
    });
  };

  const releaseUnavailableRequest = (
    context: WhatsappProviderHandoffMonitorContext,
    version: number
  ) => {
    if (!isCurrentRequest(version, context)) return;

    transientFailureCount.value += 1;
    // Network/API availability must never make recovery actions permanently
    // inert. Keep an already-loaded snapshot visible, but leave further
    // observation to an explicit realtime-triggered refresh.
    loadingAction.value = null;
    log('web.provider_handoff.snapshot_unavailable', context, {
      transient_failures: transientFailureCount.value,
    });
  };

  const observeSnapshot = async (
    context: WhatsappProviderHandoffMonitorContext,
    version: number,
    refreshOptions: WhatsappProviderHandoffRefreshOptions = {}
  ) => {
    if (!isCurrentRequest(version, context) || completed) {
      return;
    }
    if (snapshotRequestVersion === version) {
      if (refreshOptions.replayIfInFlight) {
        pendingRefreshOptions = {
          terminal:
            pendingRefreshOptions?.terminal === true ||
            refreshOptions.terminal === true,
          targetReady:
            pendingRefreshOptions?.targetReady === true ||
            refreshOptions.targetReady === true,
        };
      }
      return;
    }
    snapshotRequestVersion = version;

    try {
      const controller = new AbortController();
      requestController = controller;
      const result = await channelsStore.viewWhatsappProviderHandoff(
        context.workerId,
        {
          debugTraceId: context.debugTraceId,
          signal: controller.signal,
        }
      );
      if (requestController === controller) {
        requestController = null;
      }

      if (!isCurrentRequest(version, context)) return;
      if (result.kind !== 'found') {
        if (result.kind === 'not_found') {
          await handleAbsentSnapshot(context, version, refreshOptions);
        } else {
          releaseUnavailableRequest(context, version);
        }
        return;
      }

      if (!isExpectedHandoff(result.handoff, context)) {
        log('web.provider_handoff.stale_snapshot_ignored', context, {
          observed_worker_id: result.handoff.worker_id,
          observed_lifecycle_operation_id:
            result.handoff.lifecycle_operation_id,
          observed_handoff_id: result.handoff.handoff_id,
        });
        return;
      }

      transientFailureCount.value = 0;
      log('web.provider_handoff.snapshot', context, {
        handoff_id: result.handoff.handoff_id,
        status: result.handoff.state,
        recovery_state: result.handoff.recovery_state,
        resolution_status: result.handoff.resolution_status,
        source_revision_preserved: result.handoff.source_revision_preserved,
        source_runtime_restored: result.handoff.source_runtime_restored,
      });

      // On a browser reload, the list projection may already prove that the
      // target is connected while a stale failed handoff row is still visible
      // for audit/recovery. A target-online lifecycle publication provides the
      // same proof in a tab that initiated the change. In either case, the
      // page callback must validate the *live* target before we retire this
      // recovery monitor; a restored source never passes this check.
      const shouldReconcileLiveTarget =
        result.handoff.state === 'failed' &&
        result.handoff.resolution_action === null &&
        result.handoff.resolution_state === null &&
        Boolean(options.onTargetReady) &&
        (context.origin === 'resumed' || refreshOptions.targetReady === true);
      if (shouldReconcileLiveTarget) {
        const targetFinished = await finishTarget(context, version, false, {
          requireLiveTarget: true,
        });
        if (targetFinished) return;
      }

      handoff.value = result.handoff;
      if (decisionReason.value !== 'failure') {
        dismissedDialogState = null;
        isDialogVisible.value = true;
      }

      if (result.handoff.state === 'completed') {
        await finishTarget(context, version, false);
        return;
      }

      if (
        result.handoff.resolution_action &&
        result.handoff.resolution_state === 'completed'
      ) {
        if (result.handoff.resolution_action === 'return') {
          await finishSourceReturn(context, version);
        } else {
          pendingAction.value = 'discard';
          loadingAction.value = 'discard';
          isDialogVisible.value = true;
          await options.onRecoveryRequired?.(result.handoff, context);
          await finishTarget(context, version, true);
        }
        return;
      }

      if (
        result.handoff.resolution_action &&
        result.handoff.resolution_state === 'running'
      ) {
        pendingAction.value = result.handoff.resolution_action;
        // This is a durable background operation, not an in-flight browser
        // request. Keeping `loadingAction` set here made the dialog
        // persistent forever when a realtime event was delayed or absent.
        loadingAction.value = null;
        isDialogVisible.value = true;
        await options.onRecoveryRequired?.(result.handoff, context);
        return;
      }

      if (result.handoff.state === 'failed') {
        decisionReason.value = 'failure';
        if (dismissedDialogState !== dialogStateKey(result.handoff)) {
          isDialogVisible.value = true;
        }
        await options.onRecoveryRequired?.(result.handoff, context);
      }
    } finally {
      if (snapshotRequestVersion === version) {
        snapshotRequestVersion = null;
        const pending = pendingRefreshOptions;
        pendingRefreshOptions = null;
        if (pending && isCurrentRequest(version, context) && !completed) {
          await observeSnapshot(context, version, pending);
        }
      }
    }
  };

  const start = (context: WhatsappProviderHandoffMonitorContext) => {
    invalidatePendingRequest();
    const version = monitorVersion;
    activeContext.value = context;
    handoff.value = undefined;
    isDialogVisible.value = false;
    loadingAction.value = null;
    pendingAction.value = null;
    transientFailureCount.value = 0;
    completed = false;
    snapshotRequestVersion = null;
    pendingRefreshOptions = null;
    dismissedDialogState = null;
    decisionReason.value = 'failure';
    log('web.provider_handoff.monitor_started', context);
    void observeSnapshot(context, version);
  };

  /**
   * Refresh only when the surrounding screen receives a relevant lifecycle
   * publication. This deliberately replaces the old timer-based polling.
   */
  const refresh = async (
    refreshOptions: WhatsappProviderHandoffRefreshOptions = {}
  ) => {
    const context = activeContext.value;
    if (!context || completed) return;

    await observeSnapshot(context, monitorVersion, refreshOptions);
  };

  const resolveAction = async (
    action: WhatsappProviderHandoffAction,
    allowPendingRetry = false
  ) => {
    const context = activeContext.value;
    const currentHandoff = handoff.value;
    // A user may explicitly switch from a pending safe return to the
    // destructive path. The API remains the authority: this client-side
    // allowance only sends the requested action and cannot bypass its CAS.
    const allowsExplicitDiscardOverride =
      action === 'discard' && pendingAction.value === 'return';
    if (
      !context ||
      !currentHandoff ||
      completed ||
      loadingAction.value ||
      (pendingAction.value &&
        !allowsExplicitDiscardOverride &&
        (!allowPendingRetry || pendingAction.value !== action)) ||
      !isExpectedHandoff(currentHandoff, context)
    ) {
      return;
    }

    invalidatePendingRequest();
    const version = monitorVersion;
    loadingAction.value = action;
    log('web.provider_handoff.resolve_requested', context, {
      action,
      handoff_id: currentHandoff.handoff_id,
    });

    const controller = new AbortController();
    requestController = controller;
    const resolution = await channelsStore.resolveWhatsappProviderHandoff(
      context.workerId,
      currentHandoff.handoff_id,
      action,
      {
        debugTraceId: context.debugTraceId,
        signal: controller.signal,
      }
    );
    if (requestController === controller) {
      requestController = null;
    }
    if (!isCurrentRequest(version, context)) return;

    if (!resolution) {
      releaseUnavailableRequest(context, version);
      return;
    }

    await applyResolution(resolution, context, version, action);

    if (
      resolution.status === 'queued' &&
      isCurrentRequest(version, context) &&
      !completed
    ) {
      // The resolve response is accepted before the recovery worker may have
      // completed the database reconciliation. Confirm it once now so a
      // completion that raced the HTTP response is reflected immediately.
      // Future reads remain driven exclusively by realtime/reconnect/manual
      // refresh; this is deliberately not a polling loop.
      await observeSnapshot(context, version);
    }
  };

  const resolve = async (action: WhatsappProviderHandoffAction) =>
    resolveAction(action);

  /**
   * A retry never chooses a new or destructive action: it repeats the exact
   * decision that the API already accepted for this handoff. This is useful
   * when a recovery publication was missed and lets the server redrive its
   * idempotent operation without browser polling.
   */
  const retry = async () => {
    const action = pendingAction.value;
    if (!action) return;
    await resolveAction(action, true);
  };

  const dismissDialog = () => {
    if (!loadingAction.value) {
      dismissedDialogState = handoff.value
        ? dialogStateKey(handoff.value)
        : null;
      isDialogVisible.value = false;
    }
  };

  const requestDecision = async (
    reason: Exclude<WhatsappProviderHandoffDecisionReason, 'failure'>
  ): Promise<boolean> => {
    const context = activeContext.value;
    if (!context || completed) return false;

    decisionReason.value = reason;
    await observeSnapshot(context, monitorVersion, {
      terminal: reason === 'timeout',
      replayIfInFlight: true,
    });

    if (!activeContext.value || completed) return false;
    if (handoff.value) {
      dismissedDialogState = null;
      isDialogVisible.value = true;
      return true;
    }
    return false;
  };

  const stop = () => {
    const context = activeContext.value;
    invalidatePendingRequest();
    activeContext.value = undefined;
    handoff.value = undefined;
    isDialogVisible.value = false;
    loadingAction.value = null;
    pendingAction.value = null;
    transientFailureCount.value = 0;
    completed = false;
    snapshotRequestVersion = null;
    pendingRefreshOptions = null;
    dismissedDialogState = null;
    decisionReason.value = 'failure';
    if (context) {
      log('web.provider_handoff.monitor_stopped', context);
    }
  };

  onBeforeUnmount(stop);

  return {
    activeContext: readonly(activeContext),
    handoff: readonly(handoff),
    isActive,
    isDialogVisible: readonly(isDialogVisible),
    loadingAction: readonly(loadingAction),
    pendingAction: readonly(pendingAction),
    decisionReason: readonly(decisionReason),
    transientFailureCount: readonly(transientFailureCount),
    start,
    refresh,
    resolve,
    retry,
    requestDecision,
    dismissDialog,
    stop,
  };
}
