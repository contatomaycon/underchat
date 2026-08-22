import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('web channel session removal contract', () => {
  const store = read('apps/web/src/@webcore/stores/channels.ts');
  const modal = read('apps/web/src/components/channel/AppConnectChannel.vue');
  const page = read('apps/web/src/pages/channels.vue');
  const removedDialog = read(
    'apps/web/src/components/channel/SessionRemovedDialog.vue'
  );
  const banner = read('apps/web/src/components/ChannelStatusBanner.vue');
  const presentationStore = read(
    'apps/web/src/@webcore/stores/channelStatusPresentation.ts'
  );

  it('uses the terminal DELETE endpoint and keeps runtime recreation outside the connection modal', () => {
    expect(store).toContain('async disconnectConnectionChannel(');
    expect(store).toContain('IApiResponse<DisconnectWorkerConnectionResponse>');
    expect(store).toMatch(/worker\/\$\{workerId\}\/connection/);
    expect(store).toContain('async resetConnectionChannel(');
    expect(store).toMatch(/worker\/\$\{workerId\}\/connection\/reset/);

    expect(modal).toContain('@click="disconnectChannelSession"');
    expect(modal).toContain('channelStore.disconnectConnectionChannel(');
    expect(modal).toContain('isConnected.value');
    expect(modal).not.toContain('@click="recreateChannelWithFullCleanup"');
    expect(modal).not.toContain('data-testid="connection-recreate"');
    expect(modal).not.toContain('data-testid="connection-reconnect"');
    expect(modal).not.toContain('channelStore.resetConnectionChannel(');
  });

  it('restarts QR in place after disconnect instead of recreating the runtime', () => {
    expect(modal).toContain('data-testid="connection-restart-qrcode"');
    expect(modal).toContain('v-else-if="showQrRestartAction"');
    expect(modal).toContain("selectedConnectionMethod.value = 'qrcode'");

    const restartHandler = modal.slice(
      modal.indexOf('async function restartQrCodeAttempt'),
      modal.indexOf('async function continuePasskeyPairing')
    );
    expect(restartHandler).toContain('await reconnectChannel()');
    expect(modal).toContain(
      'requestQrCodeIfReady({ force: true, preserveQr: false })'
    );
    expect(restartHandler).not.toContain('emitConnectionStarted()');
    expect(restartHandler).not.toContain('resetConnectionChannel');
    expect(restartHandler).not.toContain('recreateChannelWithFullCleanup');

    const primaryActions = modal.slice(
      modal.indexOf('<VCardText v-if="showPrimaryActions"'),
      modal.indexOf('<VCardText v-if="canOfferNewConnection" class="pt-0">')
    );
    expect(primaryActions).toContain('showQrRestartAction');
    expect(primaryActions).toContain('@click="restartQrCodeAttempt"');
    expect(primaryActions).not.toContain('connection-recreate');
    expect(primaryActions).not.toContain('connection-reconnect');
  });

  it('keeps the restart affordance after the fifth QR expires and AVAILABLE refreshes', () => {
    expect(modal).toContain('function hasExhaustedQrAttemptOverlay()');
    expect(modal).toContain('function restoreExhaustedQrAttemptTerminal(');
    expect(modal).toContain('qrAttempt.value = maxAttempts + 1');
    expect(modal).toContain(
      'restoreExhaustedQrAttemptTerminal(event, exhaustedQrMaxAttempts)'
    );

    const availableReconciliation = modal.slice(
      modal.indexOf('function prepareConnectionAfterCompletedReset'),
      modal.indexOf('function restoreModalAfterRejectedQrRequest')
    );
    expect(availableReconciliation).toContain('hasExhaustedQrAttemptOverlay()');
    expect(availableReconciliation).toContain(
      'statusConnection.value = EBaileysConnectionStatus.disconnected'
    );
    expect(availableReconciliation).toContain(
      'statusCode.value = ECodeMessage.connectionClosed'
    );
    expect(availableReconciliation).not.toContain('resetQrAttempts()');
  });

  it('returns to the method chooser after a rejected POST and emits connectionStarted only after an ACK', () => {
    const requestHandler = modal.slice(
      modal.indexOf('async function requestQrCodeIfReady'),
      modal.indexOf('async function reconnectChannel')
    );
    const rejectedBranch = requestHandler.slice(
      requestHandler.indexOf('if (!state)'),
      requestHandler.indexOf('if (canOfferNewConnection.value)')
    );
    const acceptedBranch = requestHandler.slice(
      requestHandler.indexOf('if (canOfferNewConnection.value)')
    );

    expect(rejectedBranch).toContain('restoreModalAfterRejectedQrRequest()');
    expect(rejectedBranch).not.toContain('emitConnectionStarted()');
    expect(acceptedBranch).toContain('emitConnectionStarted()');
    expect(requestHandler.indexOf('if (!state)')).toBeLessThan(
      requestHandler.indexOf('emitConnectionStarted()')
    );

    const recovery = modal.slice(
      modal.indexOf('function restoreModalAfterRejectedQrRequest'),
      modal.indexOf('function releaseQrAttemptOnClose')
    );
    expect(recovery).toContain(
      'synchronizeModalWithCanonicalSnapshot(snapshot)'
    );
    expect(recovery).toContain('returnToConnectionMethodSelection()');
    expect(recovery).toContain('resetNativeConnectionStatus()');
    expect(recovery).toContain(
      'statusConnection.value = EBaileysConnectionStatus.connecting'
    );
    expect(recovery).not.toContain(
      'statusConnection.value = EBaileysConnectionStatus.disconnected'
    );
    expect(recovery).not.toContain(
      'statusCode.value = ECodeMessage.connectionClosed'
    );
  });

  it('does not retain an unfulfilled QR attempt across close and reopen', () => {
    const closeRecovery = modal.slice(
      modal.indexOf('function releaseQrAttemptOnClose'),
      modal.indexOf('async function requestQrCodeIfReady')
    );
    expect(closeRecovery).toContain('!isQrConnectionSelected.value');
    expect(closeRecovery).toContain('qrRequestGeneration += 1');
    expect(closeRecovery).toContain('isRequestingQr.value = false');
    expect(closeRecovery).toContain('qrcode.value = undefined');
    expect(closeRecovery).toContain('qrPending.value = false');
    expect(closeRecovery).toContain('connectionAttemptId.value = undefined');

    const visibilityWatcher = modal.slice(
      modal.indexOf('watch(isVisible'),
      modal.indexOf('watch(\n  () => props.debugTraceId')
    );
    expect(visibilityWatcher).toContain('releaseQrAttemptOnClose()');
    expect(visibilityWatcher).toContain(
      'void requestQrCodeIfReady({ silent: true })'
    );

    const unmountCleanup = modal.slice(
      modal.indexOf('onUnmounted(() =>'),
      modal.indexOf('</script>')
    );
    expect(unmountCleanup).toContain('releaseQrAttemptOnClose()');
  });

  it('bounds QR requests and ignores stale responses after close or channel change', () => {
    const requestHandler = modal.slice(
      modal.indexOf('async function requestQrCodeIfReady'),
      modal.indexOf('async function reconnectChannel')
    );

    expect(requestHandler).toContain('timeoutMs: QR_REQUEST_TIMEOUT_MS');
    expect(requestHandler).toContain(
      'requestGeneration !== qrRequestGeneration'
    );
    expect(requestHandler).toContain('!isVisible.value');
    expect(requestHandler).toContain('channelId.value !== requestedWorkerId');
    expect(requestHandler).toContain('!isQrConnectionSelected.value');
    expect(requestHandler).toContain(
      'if (!isAcceptedQrAttemptResponse(state))'
    );

    const scheduledRecovery = modal.slice(
      modal.indexOf('function scheduleQrHistoryRecovery'),
      modal.indexOf('function startNextAttemptCountdown')
    );
    expect(scheduledRecovery).toContain('delayMs === finalDelayMs');
    expect(scheduledRecovery).toContain('restoreModalAfterRejectedQrRequest()');
    expect(scheduledRecovery).toContain('recoverQrFromRecentHistory');
    expect(scheduledRecovery).not.toContain('requestConnectionQrCode');
    expect(modal).not.toContain('recoverQrFromCachedRequest');
  });

  it('does not request QR before create or recreate lifecycle completion', () => {
    const requestableStatuses = modal.slice(
      modal.indexOf('const QR_REQUESTABLE_WORKER_STATUSES'),
      modal.indexOf('const QR_ATTEMPT_TERMINAL_WORKER_STATUSES')
    );

    expect(requestableStatuses).toContain('EWorkerStatus.disponible');
    expect(requestableStatuses).not.toContain('EWorkerStatus.creating');
    expect(requestableStatuses).not.toContain('EWorkerStatus.recreating');
  });

  it('shows removal progress, emits the terminal result and delegates success UI', () => {
    expect(modal).toContain("title: 'connection_removing_session_title'");
    expect(modal).toContain("emit('sessionRemoved', result)");
    expect(modal).toContain("emit('connectionStarted', channelId.value)");
    expect(removedDialog).toContain('data-testid="session-removed-dialog"');
    expect(removedDialog).toContain("{{ $t('session_removed_dialog_title') }}");
    expect(removedDialog).toContain(
      "{{ $t('session_removed_dialog_next_step') }}"
    );
    expect(removedDialog).toContain('variant="text"');
    expect(removedDialog).toContain('variant="elevated"');
    expect(removedDialog).toContain("{{ $t('session_removed_reconnect') }}");
  });

  it('offers recreate, never connect, when the canonical worker is stopped', () => {
    expect(page).toContain('item.status?.id !== EWorkerStatus.stopped &&');
    expect(page).toContain('channel.status?.id === EWorkerStatus.blocked');
    expect(page).toContain('!isChannelBlockedByPlan(item)');
  });

  it('remounts a fresh chooser and does not request a QR from the reconnect CTA', () => {
    expect(page).toContain(':key="channelConnectionDialogKey"');
    expect(page).toContain('@session-removed="handleSessionRemoved"');
    expect(page).toContain('@connection-started="handleConnectionStarted"');
    expect(page).toContain('@reconnect="reconnectRemovedSession"');

    const reconnectHandler = page.slice(
      page.indexOf('const reconnectRemovedSession'),
      page.indexOf('const openConnectionLogDialog')
    );
    expect(reconnectHandler).toContain(
      'channelConnectionStatus.value = EWorkerStatus.disponible'
    );
    expect(reconnectHandler).toContain('channelConnectionDialogKey.value += 1');
    expect(reconnectHandler).not.toContain('requestConnectionQrCode');
    expect(reconnectHandler).not.toContain('/connection/qrcode');
  });

  it('keeps header and table on the global canonical realtime projection', () => {
    expect(
      read('apps/web/src/layouts/components/DefaultLayoutWithVerticalNav.vue')
    ).toContain('<ChannelStatusBanner');
    expect(
      read('apps/web/src/layouts/components/DefaultLayoutWithHorizontalNav.vue')
    ).toContain('<ChannelStatusBanner');
    expect(banner).toContain(
      'channelStatusPresentationStore.applyRealtimeEvent(data)'
    );
    const accountStatusSubscription = page.slice(
      page.indexOf('useResilientCentrifugoSubscription({'),
      page.indexOf(
        'useResilientCentrifugoSubscription({',
        page.indexOf('useResilientCentrifugoSubscription({') + 1
      )
    );
    expect(accountStatusSubscription).not.toContain(
      'acknowledgeRecoveryAfterSubscribed: true'
    );
    expect(accountStatusSubscription).not.toContain(
      'fetchRecentHistoryAndProcess(channel, workerStatusHandler)'
    );
    expect(banner).toContain('canonicalSnapshotIncludesPublication');
    expect(page).toContain('canonicalSnapshotIncludesPublication');
    expect(page).toContain(
      'channelStatusPresentationStore.snapshot(channel.id)'
    );
    const modalStatusProjection = page.slice(
      page.indexOf('const currentConnectionChannelStatus'),
      page.indexOf('const currentConnectionChannelPhone')
    );
    expect(
      modalStatusProjection.indexOf('channelStatusPresentationStore.snapshot')
    ).toBeLessThan(
      modalStatusProjection.indexOf(
        'currentConnectionChannel.value?.status?.id'
      )
    );
    expect(presentationStore).toContain('workerStatusObservedAt');
    expect(presentationStore).toContain('workerObservationComparison !== 1');
  });

  it('keeps modal QR history replay read-only for the global worker cursor', () => {
    expect(modal).toContain('{ commitCursor: false }');
  });

  it('makes the canonical projection authoritative for modal realtime state', () => {
    expect(modal).toContain('useChannelStatusPresentationStore()');
    expect(modal).toContain('canonicalSnapshotIncludesPublication');
    expect(modal).toContain('synchronizeModalWithCanonicalSnapshot');
    expect(modal).toContain(
      "display.connectionStatus !== 'error' &&\n      shouldPreserveActiveQrAttemptOverlay(event)"
    );
    const availableReconciliation = modal.slice(
      modal.indexOf('function prepareConnectionAfterCompletedReset'),
      modal.indexOf('function restoreModalAfterRejectedQrRequest')
    );
    expect(availableReconciliation).toContain(
      'if (statusId === EWorkerStatus.disponible)'
    );
    expect(availableReconciliation).toContain('hasActiveQrAttemptOverlay()');
    expect(modal).toContain("snapshot.source === 'session_removal_ack'");

    const projection = modal.slice(
      modal.indexOf('function applyConnectionPublication'),
      modal.indexOf('function applyDirectConnectionResponse')
    );
    expect(projection.indexOf('applyRealtimeEvent(data)')).toBeLessThan(
      projection.indexOf('applyReducedConnectionState(data, options)')
    );
    expect(projection).toContain(
      'synchronizeModalWithCanonicalSnapshot(presentationSnapshot, data)'
    );
    expect(projection).toContain('isAttemptScopedConnectionPayload(data)');
    expect(projection).toContain(
      'shouldIgnoreQrTerminalFromAnotherAttempt(data)'
    );
    expect(projection).toContain(
      'web.connection_state.previous_attempt_terminal_ignored'
    );

    const attemptFence = modal.slice(
      modal.indexOf('function isAttemptScopedConnectionPayload'),
      modal.indexOf('function isAcceptedQrAttemptResponse')
    );
    expect(attemptFence).toContain(
      'data.connection_attempt_id !== currentAttemptId'
    );
    expect(attemptFence).toContain(
      'data.connection_attempt_id === currentAttemptId'
    );
    expect(attemptFence).toContain('isQrAttemptTerminalPublication(data)');
    expect(attemptFence).toContain('isWhatsappQrAttemptExhaustedState(data)');
    expect(attemptFence).toContain('currentAttemptId &&');

    const terminalFence = modal.slice(
      modal.indexOf('function isQrAttemptTerminalPublication'),
      modal.indexOf('function applyCanonicalAvailableProjection')
    );
    expect(terminalFence).toContain('QR_ATTEMPT_TERMINAL_NATIVE_STATUSES.has');
    expect(terminalFence).toContain(
      '!isCurrentQrAttemptProgressPublication(data)'
    );
    expect(terminalFence).toContain(
      'data.connection_attempt_id === connectionAttemptId.value'
    );
    expect(terminalFence).toContain('shouldIgnoreQrTerminalFromAnotherAttempt');

    const nativeResolution = modal.slice(
      modal.indexOf('function resolveIncomingConnectionStatus'),
      modal.indexOf('function isAttemptScopedConnectionPayload')
    );
    expect(nativeResolution).toContain(
      'isCurrentQrAttemptProgressPublication(data)'
    );
    expect(nativeResolution).toContain('connection_status: undefined');
    expect(nativeResolution).toContain('QR_ATTEMPT_PROGRESS_CODES.has');

    const canonicalSynchronization = modal.slice(
      modal.indexOf('function synchronizeModalWithCanonicalSnapshot'),
      modal.indexOf('function shouldIgnorePhoneUnavailableState')
    );
    expect(canonicalSynchronization).toContain(
      'applyCanonicalAvailableProjection(snapshot)'
    );
    expect(canonicalSynchronization).toContain(
      "snapshot.source === 'session_removal_ack'"
    );

    const projectionGuard = modal.slice(
      modal.indexOf('function shouldProjectConnectionPublicationToCanonical'),
      modal.indexOf('function applyConnectionPublication')
    );
    expect(projectionGuard).toContain(
      "data.event_type === 'status' && data.worker_status_id"
    );

    const handler = modal.slice(
      modal.indexOf('function handleWorkerConnectionMessage'),
      modal.indexOf('useResilientCentrifugoSubscription({')
    );
    expect(handler).toContain('applyConnectionPublication(connectionData)');

    const completedReset = modal.slice(
      modal.indexOf('function prepareConnectionAfterCompletedReset'),
      modal.indexOf('async function requestQrCodeIfReady')
    );
    expect(completedReset).toContain(
      'statusConnection.value = EBaileysConnectionStatus.connecting'
    );
    expect(completedReset).not.toContain('prepareConnectionStart()');
  });

  it('projects a valid recreate ACK without consulting the old row status', () => {
    const recreateHandler = page.slice(
      page.indexOf('const handleRecreate = async'),
      page.indexOf('const handleChannelCreated')
    );
    expect(recreateHandler).toContain(
      'channelStatusPresentationStore.applyAcceptedRecreateAck(ack)'
    );
    expect(recreateHandler).toContain(
      'snapshot?.lifecycleOperationId === ack.operation_id'
    );
    expect(recreateHandler).not.toContain(
      'channel?.status?.id === EWorkerStatus.recreating'
    );
  });

  it('presents a new worker as creating and reconciles its durable bootstrap', () => {
    const creationHandler = page.slice(
      page.indexOf('const handleChannelCreated = async'),
      page.indexOf('const handleChannelUpdated')
    );
    const unofficialCreation = creationHandler.slice(
      creationHandler.indexOf('const createdWorker')
    );

    expect(unofficialCreation).toContain(
      'channelConnectionIsInitialCreation.value = true'
    );
    expect(unofficialCreation).toContain(
      'channelsStore.applyAcceptedCreateAck(createdWorker)'
    );
    expect(unofficialCreation).toContain(
      'createdWorker.worker_status_id ?? EWorkerStatus.creating'
    );
    expect(unofficialCreation).toContain(
      'channelConnectionLifecycleOperationId.value = createdWorker.operation_id'
    );
    expect(unofficialCreation).not.toContain(
      'await channelsStore.listChannels(query.value)'
    );
    expect(
      unofficialCreation.indexOf('isDialogConnectionChannelShow.value = true')
    ).toBeLessThan(
      unofficialCreation.indexOf('void reconcileInitialCreationLifecycle')
    );
    expect(page).toContain(
      ':is-initial-creation="channelConnectionIsInitialCreation"'
    );
    expect(page).toContain('INITIAL_CREATION_RECONCILIATION_DELAYS_MS');
    expect(page).toContain('channelsStore.getWorkerById(workerId, {');
    expect(page).toContain('silent: true');

    expect(modal).toContain('isInitialCreation?: boolean');
    expect(modal).toContain('props.isInitialCreation === true');
    expect(modal).toContain(
      'recreatePhase: projectsInitialCreation ? null : snapshot.recreatePhase'
    );
    expect(modal).toContain(
      'display.workerStatusId === EWorkerStatus.creating'
    );
    expect(store).toContain('resolveActiveHttpLifecycleStatus');
    expect(store).toContain('channelInitialCreationOperationById');
    expect(store).toContain('isInitialCreationTerminalHttpSnapshot');
  });

  it.each(['pt', 'en', 'es'])(
    'provides complete removal copy in %s',
    (locale) => {
      const messages = JSON.parse(
        read('apps/web/src/plugins/i18n/locales/' + locale + '.json')
      ) as Record<string, string>;

      expect(messages.connection_removing_session_title).toBeTruthy();
      expect(messages.connection_removing_session_description).toBeTruthy();
      expect(messages.session_removed_dialog_title).toBeTruthy();
      expect(messages.session_removed_dialog_description).toBeTruthy();
      expect(messages.session_removed_close).toBeTruthy();
      expect(messages.session_removed_reconnect).toBeTruthy();
      expect(messages.worker_connection_disconnect_error).toBeTruthy();
      expect(messages.restart_qrcode).toBeTruthy();
    }
  );
});
