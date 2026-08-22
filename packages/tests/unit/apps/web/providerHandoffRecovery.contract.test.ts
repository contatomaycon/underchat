import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readWebSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), 'apps/web/src', relativePath), 'utf8');

const sourceSection = (
  source: string,
  startMarker: string,
  endMarker: string
): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('provider handoff recovery frontend contract', () => {
  const page = readWebSource('pages/channels.vue');
  const configPage = readWebSource('pages/config/channels-tab.vue');
  const editor = readWebSource('components/channel/AppEditChannel.vue');
  const connectionDialog = readWebSource(
    'components/channel/AppConnectChannel.vue'
  );
  const migrationProgress = readWebSource(
    'components/channel/ChannelMigrationProgress.vue'
  );
  const connectionStrategyDialog = readWebSource(
    'components/channel/AppChannelConnectionStrategyDialog.vue'
  );
  const dialog = readWebSource(
    'components/channel/ChannelProviderHandoffRecoveryDialog.vue'
  );
  const composable = readWebSource(
    'composables/useWhatsappProviderHandoffRecovery.ts'
  );
  const sourceRecoveryComposable = readWebSource(
    'composables/useWhatsappProviderHandoffSourceRecovery.ts'
  );
  const iconCss = readWebSource('plugins/iconify/icons.css');
  const migrationLocaleKeys = [
    'connection_migration_status',
    'connection_migration_detailed_description',
    'connection_migration_source',
    'connection_migration_destination',
    'connection_migration_session_protected',
    'connection_migration_route_aria',
    'connection_migration_timeout_status',
    'connection_migration_timeout_title',
    'connection_migration_timeout_description',
    'connection_migration_choose_action',
  ] as const;
  const migrationLocales = ['pt', 'en', 'es'].map(
    (locale) =>
      JSON.parse(
        readWebSource(`plugins/i18n/locales/${locale}.json`)
      ) as Record<string, unknown>
  );
  const centrifugoQueues = readFileSync(
    resolve(process.cwd(), 'packages/common/functions/centrifugoQueue.ts'),
    'utf8'
  );
  const recoveryService = readFileSync(
    resolve(
      process.cwd(),
      'packages/services/whatsappProviderHandoffRecovery.service.ts'
    ),
    'utf8'
  );

  it('carries the source type and exact lifecycle operation into monitoring', () => {
    expect(editor).toContain('previous_worker_type: initialType.value');
    expect(editor).toContain(
      'previous_session_storage: initialSessionStorage.value'
    );
    expect(page).toContain('data.lifecycle_operation_id');
    expect(page).toContain('data.previous_worker_type');
    expect(page).toContain('data.previous_session_storage');
    expect(page).toContain('providerHandoffRecovery.start({');
    expect(composable).toContain(
      'handoffOperationId === context.lifecycleOperationId'
    );
    expect(composable).toContain(
      'candidate.lifecycle_operation_id === candidate.resolution_operation_id'
    );
  });

  it('offers the administrative server selector in edit and routes server changes through the shared strategy decision', () => {
    expect(editor).toContain('EGeneralPermissions.full_access');
    expect(editor).toContain('EGeneralPermissions.full_access_group');
    expect(editor).toContain('await channelStore.listWorkerServers()');
    expect(editor).toContain('v-model="serverId"');
    expect(editor).toContain('payload.server_id = serverId.value;');
    expect(editor).toContain('serverId.value !== initialServerId.value');
    expect(editor).toContain('isConnectionStrategyDialogVisible.value = true;');
    expect(editor).toContain('connection_strategy: connectionStrategy');
    expect(editor).toContain('previous_server_id: initialServerId.value');
    expect(page).toContain('data.previous_server_id !== data.server_id');
    expect(page).toContain(
      ':migration-source-server-name="channelConnectionSourceServerName"'
    );
    expect(page).toContain(
      ':migration-target-server-name="channelConnectionTargetServerName"'
    );
  });

  it('settles a same-provider server migration from its exact recreate terminal', () => {
    expect(page).toContain(
      'A same-provider server migration has no provider-handoff journal'
    );
    expect(page).toContain('isManagerWorkerRecreateCompletedStatusEvent(data)');
    expect(page).toContain(
      'data.lifecycle_operation_id ===\n      channelConnectionLifecycleOperationId.value'
    );
    expect(page).toContain('!providerHandoffRecovery.activeContext.value');
    expect(page).toContain(
      'channelConnectionIsSessionMigration.value = false;'
    );
  });

  it('keeps destructive discard behind an explicit second confirmation', () => {
    expect(dialog).toContain('provider-handoff-discard-confirmation');
    expect(dialog).toContain('provider-handoff-discard-confirm');
    expect(dialog).toContain("emit('discard')");
  });

  it('opens the existing connection-method chooser only after fresh target confirmation', () => {
    expect(page).toContain('if (freshSession)');
    expect(page).toContain('await nextTick();');
    expect(page).toContain('isDialogConnectionChannelShow.value = true;');
    expect(page).toContain('<AppConnectChannel');
    expect(composable).toContain('finishTarget(context, version, true)');
  });

  it('uses one cancelable lookup and realtime-triggered refreshes instead of polling', () => {
    expect(composable).toContain('requestController?.abort();');
    expect(composable).toContain('onBeforeUnmount(stop);');
    expect(composable).toContain('const handleAbsentSnapshot');
    expect(composable).toContain("result.kind === 'not_found'");
    expect(page).toContain('canTreatAbsentHandoffAsTerminal');
    expect(configPage).toContain('canTreatAbsentHandoffAsTerminal');
    expect(composable).toContain('const refresh = async (');
    expect(composable).not.toContain('setTimeout(');
    expect(composable).not.toContain('setInterval(');
    expect(composable).not.toContain('listChannels(');
  });

  it('shows stable handoff references and valid bundled recovery icons', () => {
    expect(dialog).toContain('referenceCode?: string | null;');
    expect(dialog).toContain('showReturn: true');
    expect(dialog).toContain('tabler-database');
    expect(dialog).not.toContain('tabler-database-shield');
    expect(page).toContain(
      ':reference-code="providerHandoffRecovery.handoff.value.handoff_id"'
    );
    expect(connectionDialog).toContain("icon: 'tabler-arrows-right-left'");
    expect(iconCss).toContain('.tabler-arrows-right-left');
    expect(iconCss).toContain('.tabler-database');
  });

  it('presents the live migration route with product labels and accessible motion', () => {
    expect(connectionDialog).toContain('<ChannelMigrationProgress');
    expect(connectionDialog).toContain('v-if="modalState === \'migrating\'"');
    expect(connectionDialog).toContain(':source-type="migrationSourceType"');
    expect(connectionDialog).toContain(':target-type="channelType"');
    expect(page).toContain(
      ':migration-source-type="channelConnectionSourceType"'
    );
    expect(configPage).toContain(
      ':migration-source-type="connectionSourceType"'
    );
    expect(migrationProgress).toContain("label: t('unofficial_socket')");
    expect(migrationProgress).toContain("label: t('unofficial_browser')");
    expect(migrationProgress).toContain("label: t('unofficial_whatsmeow')");
    expect(migrationProgress).toContain('data-testid="migration-source"');
    expect(migrationProgress).toContain('data-testid="migration-target"');
    expect(migrationProgress).toContain('role="status"');
    expect(migrationProgress).toContain('aria-live="polite"');
    expect(migrationProgress).toContain(
      '@media (prefers-reduced-motion: reduce)'
    );
    for (const locale of migrationLocales) {
      for (const key of migrationLocaleKeys) {
        expect(typeof locale[key]).toBe('string');
        expect((locale[key] as string).trim()).not.toBe('');
      }
    }
  });

  it('keeps the strategy close button outside the clipped card surface', () => {
    const template = sourceSection(
      connectionStrategyDialog,
      '<template>',
      '</template>'
    );
    const closeButton = template.indexOf('<DialogCloseBtn');
    const card = template.indexOf('<VCard');

    expect(closeButton).toBeGreaterThanOrEqual(0);
    expect(card).toBeGreaterThan(closeButton);
    expect(connectionStrategyDialog).toContain(
      '.connection-strategy-dialog {\n  overflow: hidden;'
    );
  });

  it('uses product-facing option labels and interactive recovery cards', () => {
    expect(dialog).toContain("baileys: 'unofficial_socket'");
    expect(dialog).toContain("wwebjs: 'unofficial_browser'");
    expect(dialog).toContain("whatsmeow: 'unofficial_whatsmeow'");
    expect(dialog).toContain('t(fallbackLabelKey)');
    expect(dialog).not.toContain('?? provider');
    expect(dialog).toContain(
      'class="handoff-recovery__actions justify-end flex-wrap gap-3"'
    );
    expect(dialog).toContain('variant="outlined"');
    expect(dialog).toContain('<VBtn\n            v-if="showReturn"');
    expect(dialog).not.toContain('<VSpacer v-if="showReturn" />');
  });

  it('keeps both recovery choices visible, explains disabled safety gates, and retries only the accepted decision', () => {
    expect(dialog).toContain('pendingAction?: HandoffAction | null;');
    expect(dialog).toContain('provider-handoff-decision-availability');
    expect(dialog).toContain("emit('retry')");
    expect(dialog).toContain("pendingAction !== 'return'");
    expect(dialog).toContain("pendingAction !== 'discard'");
    expect(dialog).toContain("pendingAction === 'discard'");
    expect(dialog).toContain(
      '// A discard has already been accepted as a one-way destructive recovery.'
    );
    expect(dialog).toContain('class="handoff-recovery__choice"');
    expect(dialog).toContain('@click="handleReturnChoice"');
    expect(dialog).toContain('@click="handleDiscardChoice"');
    expect(dialog).toContain("if (props.recoveryState === 'blocked')");
    expect(dialog).toContain(
      'provider_handoff_recovery_state_blocked_discard_available'
    );
    expect(dialog).not.toContain('provider-handoff-resolution-pending');
    expect(dialog).toContain('-webkit-line-clamp: 2;');
    expect(dialog).toContain('v-if="isDiscardConfirmationVisible"');
    expect(dialog).not.toContain('provider-handoff-retry');
    expect(dialog).not.toContain('provider_handoff_recovery_return_action');
    expect(dialog).not.toContain('provider_handoff_recovery_discard_action');
    expect(dialog).toContain('v-if="isDiscardConfirmationVisible"');
    expect(dialog).not.toContain(
      'v-else\n          class="handoff-recovery__discard-confirmation"'
    );
    expect(composable).toContain('const retry = async () =>');
    expect(composable).toContain('allowPendingRetry = false');
    expect(composable).toContain('const allowsExplicitDiscardOverride =');
    expect(composable).toContain(
      "action === 'discard' && pendingAction.value === 'return'"
    );
    expect(composable).toContain('await observeSnapshot(context, version);');
    expect(page).toContain(
      ':pending-action="providerHandoffRecovery.pendingAction.value"'
    );
    expect(page).toContain('@retry="providerHandoffRecovery.retry()"');
    expect(configPage).toContain(
      ':pending-action="providerHandoffRecovery.pendingAction.value"'
    );
  });

  it('resumes one exact recovery marker after reload without globally polling workers', () => {
    expect(page).toContain('provider_handoff_recovery');
    expect(page).toContain('candidate.marker.handoff_id');
    expect(page).toContain('candidate.marker.lifecycle_operation_id');
    expect(page).toContain("origin: 'resumed'");
    expect(page).toContain("activeContext.value?.origin === 'resumed'");
    expect(composable).toContain(
      "result.handoff.resolution_state === 'running'"
    );
    expect(composable).toContain(
      "result.handoff.resolution_action === 'return'"
    );
  });

  it('retires only a stale handoff whose requested target is acknowledged online', () => {
    expect(composable).toContain(
      'export function isWhatsappProviderHandoffTargetOnline('
    );
    expect(composable).toContain('requireLiveTarget?: boolean;');
    expect(composable).toContain('targetReady?: boolean;');
    expect(composable).toContain("context.origin === 'resumed'");
    expect(composable).toContain('result.handoff.resolution_action === null');
    expect(page).toContain('candidate.marker.target_provider');
    expect(page).toContain('isWhatsappProviderHandoffTargetOnline(');
    expect(configPage).toContain(
      'isWhatsappProviderHandoffTargetOnline(currentChannel, targetProvider)'
    );
  });

  it('transitions the preserved-session dialog to the connected screen after target completion', () => {
    expect(page).toContain(
      '`retainedTargetReady` proves that the exact target is ONLINE'
    );
    const targetReady = sourceSection(
      page,
      'onTargetReady: async (',
      '\n});\n\nconst shouldReconcileConnectionMigration'
    );
    const retainedTarget = targetReady.slice(targetReady.indexOf('} else {'));
    expect(retainedTarget).toContain(
      'isDialogConnectionChannelShow.value = true;'
    );
    expect(retainedTarget).not.toContain(
      'isDialogConnectionChannelShow.value = false;'
    );
    expect(configPage).toContain(
      'Release the protected projection only after the exact target provider'
    );
    expect(configPage).toContain('connectionIsSessionMigration.value = false;');
    expect(page).toContain(
      'freshSession ? freshTargetReady : retainedTargetReady'
    );
    expect(configPage).toContain(
      'freshSession ? !freshTargetReady : !retainedTargetReady'
    );
    expect(connectionDialog).toContain(
      'const isMigrationOutcomePending = shallowRef('
    );
    expect(connectionDialog).toContain("baseModalState.value === 'connected'");
    expect(connectionDialog).toContain(
      "? 'migrating'\n    : baseModalState.value"
    );
    expect(connectionDialog).toContain("{ flush: 'sync', immediate: true }");
  });

  it('keeps the external connection link out of the connected outcome', () => {
    expect(connectionDialog).toContain(
      'const showExternalConnectionLink = computed('
    );
    expect(connectionDialog).toContain('!isConnected.value &&');
    expect(connectionDialog).toContain('v-if="showExternalConnectionLink"');
    expect(connectionDialog).toContain(
      "selectedConnectionMethod.value === 'qrcode'"
    );
    expect(connectionDialog).toContain("externalConnectionUrl.value = '';");
    expect(connectionDialog).toContain(
      'externalConnectionExpiresAt.value = null;'
    );
  });

  it('opens the migration-only dialog in the accepted-edit tick before refreshing the list', () => {
    const updateHandler = sourceSection(
      page,
      'const handleChannelUpdated = async',
      '\nwatch('
    );
    const migrationPath = updateHandler.slice(
      updateHandler.indexOf('const sourceProvider')
    );
    const migrationDialogOpen = migrationPath.indexOf(
      'isDialogConnectionChannelShow.value =\n    isDestructiveReset || isSessionMigration;'
    );
    const handoffMonitorStart = migrationPath.indexOf(
      'providerHandoffRecovery.start({'
    );
    const listRefresh = migrationPath.indexOf(
      'await channelsStore.listChannels(query.value);'
    );

    expect(migrationDialogOpen).toBeGreaterThanOrEqual(0);
    expect(migrationPath.slice(0, migrationDialogOpen)).not.toContain('await ');
    expect(handoffMonitorStart).toBeGreaterThan(migrationDialogOpen);
    expect(listRefresh).toBeGreaterThan(handoffMonitorStart);
    expect(page).toContain(
      ':is-session-migration="channelConnectionIsSessionMigration"'
    );
    expect(page).toContain(
      'pairing/QR/link surface remains fenced by `canOfferNewConnection=false`'
    );
    expect(page).toContain('if (freshSession) {');
    expect(page).toContain('isDialogConnectionChannelShow.value = true;');
  });

  it('closes the informational dialog synchronously before protected recovery work yields', () => {
    const recoveryRequired = sourceSection(
      page,
      'onRecoveryRequired: async (handoff) => {',
      '\n  onSourceReturned:'
    );
    const informationalClose = recoveryRequired.indexOf(
      'isDialogConnectionChannelShow.value = false;'
    );
    const protectedRecovery = recoveryRequired.indexOf(
      'await providerHandoffSourceRecovery.reconcileKnownHandoff(handoff);'
    );

    expect(informationalClose).toBeGreaterThanOrEqual(0);
    expect(protectedRecovery).toBeGreaterThan(informationalClose);
    expect(recoveryRequired.slice(0, informationalClose)).not.toContain(
      'await '
    );
  });

  it('keeps a mounted migration dialog incapable of requesting pairing side effects', () => {
    expect(connectionDialog).toContain(
      'const canOfferNewConnection = computed('
    );
    expect(connectionDialog).toContain(
      'if (!canOfferNewConnection.value || !channelId.value) {'
    );
    expect(connectionDialog).toContain(
      'if (!canOfferNewConnection.value || !channelId.value) return;'
    );
    expect(connectionDialog).toContain(
      'canOfferNewConnection.value &&\n    isQrConnectionSelected.value'
    );
    expect(connectionDialog).toContain(
      'if (!canRecoverQrFromRecentHistory() || !workerConnectionChannel.value)'
    );
    expect(connectionDialog).toContain(
      '<VCardText v-if="canOfferNewConnection" class="pt-0">'
    );
    expect(connectionDialog).toContain('v-if="canOfferNewConnection"');
    expect(connectionDialog).not.toContain(
      '[modalState, () => props.isSessionMigration]'
    );
  });

  it('locks the accepted migration route and exposes a five-minute safe timeout decision', () => {
    expect(migrationProgress).toContain(
      'const lockedSourceType = shallowRef<string | null>(props.sourceType ?? null);'
    );
    expect(migrationProgress).toContain(
      'const lockedTargetType = shallowRef<string | null>(props.targetType ?? null);'
    );
    expect(migrationProgress).toContain(
      'if (!lockedSourceType.value && value) lockedSourceType.value = value;'
    );
    expect(migrationProgress).toContain('maxDurationMs: 5 * 60_000');
    expect(migrationProgress).toContain("emit('timeout');");
    expect(migrationProgress).toContain("emit('cancel')");
    expect(connectionDialog).toContain(
      '@timeout="emit(\'migrationTimedOut\')"'
    );
    expect(connectionDialog).toContain(
      '@cancel="emit(\'migrationCancelRequested\')"'
    );
    expect(page).toContain(
      '@migration-timed-out="requestMigrationDecision(\'timeout\')"'
    );
    expect(page).toContain(
      '@migration-cancel-requested="requestMigrationDecision(\'cancel\')"'
    );
  });

  it('fences secure publications, polling, and actions while the migration-only dialog is visible', () => {
    const securePublication = sourceSection(
      connectionDialog,
      'function handleSecureConnectionPublication(',
      '\nasync function switchToSecureConnectionFromPasskeyRequirement'
    );
    const passkeyPublication = sourceSection(
      connectionDialog,
      'async function switchToSecureConnectionFromPasskeyRequirement()',
      '\nfunction resetPairingCodes'
    );
    const applySecureSession = sourceSection(
      connectionDialog,
      'function applySecureConnectionSession(',
      '\nasync function pollSecureConnectionSession'
    );
    const startSecurePolling = sourceSection(
      connectionDialog,
      'function startSecureConnectionPolling()',
      '\nfunction applySecureConnectionSession'
    );
    const pollSecureSession = sourceSection(
      connectionDialog,
      'async function pollSecureConnectionSession()',
      '\nfunction openSecureHelper'
    );
    const visibleWatcher = sourceSection(
      connectionDialog,
      'watch(isVisible, (visible) => {',
      '\nwatch(\n  () => props.debugTraceId'
    );
    const offerWatcher = sourceSection(
      connectionDialog,
      'watch(\n  canOfferNewConnection,',
      '\nonMounted(async () => {'
    );
    const suspendedOffer = sourceSection(
      connectionDialog,
      'function suspendConnectionOfferSideEffects()',
      '\nfunction startSecureConnectionPolling'
    );

    for (const entrypoint of [
      securePublication,
      passkeyPublication,
      applySecureSession,
      startSecurePolling,
      pollSecureSession,
    ]) {
      expect(entrypoint).toContain('!canOfferNewConnection.value');
    }
    expect(
      startSecurePolling.indexOf('!canOfferNewConnection.value')
    ).toBeLessThan(startSecurePolling.indexOf('window.setInterval('));
    expect(
      pollSecureSession.indexOf('!canOfferNewConnection.value')
    ).toBeLessThan(
      pollSecureSession.indexOf('channelStore.viewSecureConnectionSession(')
    );
    expect(
      securePublication.indexOf('!canOfferNewConnection.value')
    ).toBeLessThan(securePublication.indexOf('applySecureConnectionSession('));
    expect(visibleWatcher).toContain(
      'if (!canOfferNewConnection.value) {\n    suspendConnectionOfferSideEffects();\n    return;'
    );
    expect(offerWatcher).toContain('suspendConnectionOfferSideEffects();');
    expect(suspendedOffer).toContain('stopSecureConnectionPolling();');
    expect(suspendedOffer).toContain(
      "selectedConnectionMethod.value = 'method_selection';"
    );
    expect(suspendedOffer).toContain('secureSession.value = null;');

    for (const guardedAction of [
      'async function startSecureConnection(',
      'async function startChromeExtensionConnection()',
      'async function downloadAuthenticatorInstaller(',
      'async function downloadChromeExtensionPackage()',
      'async function cancelSecureConnection()',
      'async function continuePasskeyPairing()',
      'async function confirmPasskeyPairing()',
    ]) {
      const actionStart = connectionDialog.indexOf(guardedAction);
      const guard = connectionDialog.indexOf(
        '!canOfferNewConnection.value',
        actionStart
      );
      const nextFunction = connectionDialog.indexOf(
        '\nfunction ',
        actionStart + 1
      );
      const nextAsyncFunction = connectionDialog.indexOf(
        '\nasync function ',
        actionStart + 1
      );
      const actionEnd = Math.min(
        ...[nextFunction, nextAsyncFunction].filter(
          (index) => index > actionStart
        )
      );

      expect(actionStart).toBeGreaterThanOrEqual(0);
      expect(guard).toBeGreaterThan(actionStart);
      expect(guard).toBeLessThan(actionEnd);
    }
  });

  it('stops and clears an already active connection offer when migration mode turns on', () => {
    const offerWatcher = sourceSection(
      connectionDialog,
      'watch(\n  canOfferNewConnection,',
      '\nonMounted(async () => {'
    );
    const suspendedOffer = sourceSection(
      connectionDialog,
      'function suspendConnectionOfferSideEffects()',
      '\nfunction startSecureConnectionPolling'
    );
    const stopPolling = suspendedOffer.indexOf(
      'stopSecureConnectionPolling();'
    );
    const clearMethod = suspendedOffer.indexOf(
      "selectedConnectionMethod.value = 'method_selection';"
    );
    const clearSession = suspendedOffer.indexOf('secureSession.value = null;');

    expect(offerWatcher).toContain('if (!canOffer) {');
    expect(offerWatcher).toContain('{ immediate: true }');
    expect(stopPolling).toBeGreaterThanOrEqual(0);
    expect(clearMethod).toBeGreaterThan(stopPolling);
    expect(clearSession).toBeGreaterThan(clearMethod);
    expect(suspendedOffer).toContain('clearQrHistoryRecovery();');
    expect(suspendedOffer).toContain('resetPasskeyState();');
  });

  it('keeps server-only migrations out of the durable provider handoff', () => {
    expect(page).toContain('marker.source_provider === marker.target_provider');
    expect(page).toContain('isSessionMigration &&\n    providerChanged');
  });

  it('reconciles migration state from lifecycle publications without periodic requests', () => {
    const migrationReconciliation = page.slice(
      page.indexOf('reconcileConnectionMigrationTerminalState'),
      page.indexOf('const isInitialCreationLifecycleTerminal')
    );
    expect(page).toContain('reconcileConnectionMigrationTerminalState');
    expect(page).toContain('channelsStore.getWorkerById(workerId)');
    expect(page).toContain('current.status?.id !== EWorkerStatus.error');
    expect(page).toContain('refreshProviderHandoffFromLifecyclePublication');
    expect(configPage).toContain(
      'refreshProviderHandoffFromLifecyclePublication'
    );
    for (const surface of [page, configPage]) {
      const lifecycleRefresh = sourceSection(
        surface,
        'const refreshProviderHandoffFromLifecyclePublication',
        'const refreshProviderHandoffFromTargetProjection'
      );
      expect(lifecycleRefresh).toContain(
        'replayIfInFlight: reachedTerminalState'
      );
    }
    expect(page).not.toContain('connectionMigrationPollTimer');
    expect(configPage).not.toContain('localMigrationPollTimer');
    expect(migrationReconciliation).not.toContain('setTimeout(');
    expect(configPage).not.toContain('setTimeout(');
  });

  it('settles a successful handoff when the target ONLINE projection follows its terminal publication', () => {
    for (const surface of [page, configPage]) {
      expect(surface).toContain('refreshProviderHandoffFromTargetProjection');
      expect(surface).toContain(
        'isWhatsappProviderHandoffTargetOnline(\n      currentChannel,\n      active.targetProvider'
      );
      expect(surface).toContain('terminal: true,');
      expect(surface).toContain('targetReady: true,');
      expect(surface).toContain('replayIfInFlight: true,');
    }

    expect(page).toContain(
      'refreshProviderHandoffFromTargetProjection(channels);'
    );
    expect(configPage).toContain(
      'refreshProviderHandoffFromTargetProjection(currentChannels);'
    );
  });

  it('reconciles an automatic source recovery through the canonical reducer before releasing the legacy mirror', () => {
    const authoritativeGet = sourceRecoveryComposable.indexOf(
      'channelsStore.getWorkerById(candidate.workerId)'
    );
    const canonicalReduction = sourceRecoveryComposable.indexOf(
      'presentationStore.reconcileProviderHandoffSourceRecovery('
    );
    const legacyMirror = sourceRecoveryComposable.indexOf(
      'channelsStore.applyCanonicalProviderHandoffSourceRecovery('
    );

    expect(page).toContain('onRecoveryRequired: async (handoff) => {');
    expect(page).toContain(
      'await providerHandoffSourceRecovery.reconcileKnownHandoff(handoff);'
    );
    expect(authoritativeGet).toBeGreaterThan(-1);
    expect(canonicalReduction).toBeGreaterThan(authoritativeGet);
    expect(legacyMirror).toBeGreaterThan(canonicalReduction);
    expect(sourceRecoveryComposable).toContain(
      'const reconciled = Boolean(acceptance && legacyAccepted);'
    );
  });

  it('reconciles multiple handoff projections without adding another dialog or polling loop', () => {
    expect(
      page.match(/useWhatsappProviderHandoffRecovery\(/gu) ?? []
    ).toHaveLength(1);
    expect(page).toContain('useWhatsappProviderHandoffSourceRecovery()');
    expect(page).toContain(
      'providerHandoffSourceRecovery.refreshFromLifecyclePublication(data)'
    );
    expect(page).toContain('providerHandoffSourceRecovery.refreshAll()');
    expect(sourceRecoveryComposable).toContain(
      'const inFlight = new Map<string, ProviderHandoffSourceRecoveryFlight>();'
    );
    expect(sourceRecoveryComposable).toContain(
      'active.pendingKnownHandoff = knownHandoff;'
    );
    expect(sourceRecoveryComposable).toContain(
      'const pendingKnownHandoff = flight.pendingKnownHandoff;'
    );
    expect(sourceRecoveryComposable).toContain(
      'active.pendingRecoveryPublication = recoveryPublication;'
    );
    expect(sourceRecoveryComposable).toContain(
      'refreshFromRecoveryPublication'
    );
    expect(sourceRecoveryComposable).toContain(
      'const settled = new Set<string>();'
    );
    expect(sourceRecoveryComposable).toContain('watch(candidateSignature');
    expect(sourceRecoveryComposable).not.toContain('setTimeout(');
    expect(sourceRecoveryComposable).not.toContain('setInterval(');
    expect(sourceRecoveryComposable).not.toContain(
      'resolveWhatsappProviderHandoff'
    );
    expect(sourceRecoveryComposable).not.toContain('isDialogVisible');
    expect(page).toContain('completedSourceReturnDialogKeys');
    expect(page).toContain('markSourceReturnDialogCompleted(');
    expect(page).toContain(
      '[providerHandoffResumeCandidate, providerHandoffRecovery.activeContext]'
    );
    expect(page).toContain('if (isAlreadyMonitoring || active) return;');
    expect(page).not.toContain(
      'if (active) {\n      providerHandoffRecovery.stop();'
    );
  });

  it('routes durable recovery terminals through an isolated account channel with exact identity fences', () => {
    expect(centrifugoQueues).toContain(
      'return `worker:handoff_recovery.account#${accountId}`;'
    );
    expect(recoveryService).toContain(
      'await this.centrifugoService.publishSubImmediate('
    );
    expect(
      recoveryService.indexOf("await client.query('COMMIT');")
    ).toBeLessThan(
      recoveryService.indexOf('private async publishTerminalRecovery(')
    );
    expect(page).toContain(
      'workerProviderHandoffRecoveryCentrifugoQueue(user.account_id)'
    );
    expect(page).toContain('data.account_id !== accountId');
    expect(page).toContain(
      'active.lifecycleOperationId === data.handoff_lifecycle_operation_id'
    );
    expect(page).toContain(
      'providerHandoffSourceRecovery.refreshFromRecoveryPublication('
    );
    expect(page).toContain(
      'providerHandoffRecovery.refresh({ replayIfInFlight: true })'
    );
    expect(composable).toContain('pendingRefreshOptions');
    expect(composable).not.toContain('setTimeout(');
    expect(sourceRecoveryComposable).not.toContain('setTimeout(');
  });

  it('applies the accepted edit ACK before waiting for realtime delivery', () => {
    const store = readWebSource('@webcore/stores/channels.ts');
    expect(store).toContain('this.applyAcceptedRecreateAck(result, baseline);');
  });

  it('projects a direct recreate ACK through the canonical status reducer', () => {
    const page = readWebSource('pages/channels.vue');
    const presentationStore = readWebSource(
      '@webcore/stores/channelStatusPresentation.ts'
    );
    expect(page).toContain(
      'channelStatusPresentationStore.applyAcceptedRecreateAck(ack);'
    );
    expect(presentationStore).toContain(
      'buildManagerWorkerRecreatingStatusEvent('
    );
  });
});
