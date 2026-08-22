import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const channelsStore = read('apps/web/src/@webcore/stores/channels.ts');
const dashboardStore = read('apps/web/src/@webcore/stores/dashboard.ts');
const channelsPage = read('apps/web/src/pages/channels.vue');
const banner = read('apps/web/src/components/ChannelStatusBanner.vue');
const channelStatusPresentationStore = read(
  'apps/web/src/@webcore/stores/channelStatusPresentation.ts'
);
const channelStatusPresentation = read(
  'apps/web/src/@webcore/utils/channelStatusPresentation.ts'
);
const connectionModal = read(
  'apps/web/src/components/channel/AppConnectChannel.vue'
);
const configChannelsPage = read('apps/web/src/pages/config/channels-tab.vue');
const webConnectionDebug = read(
  'apps/web/src/@webcore/utils/connectionLifecycleDebug.ts'
);
const webViteConfig = read('apps/web/vite.config.ts');
const externalConnection = read(
  'apps/web/src/pages/connection/external/[token].vue'
);
const connectionStatusLocales = ['pt', 'en', 'es'].map((locale) =>
  JSON.parse(read(`apps/web/src/plugins/i18n/locales/${locale}.json`))
);

describe('web WhatsApp connection status projection contract', () => {
  it('orders realtime state by the trusted decimal outbox cursor', () => {
    for (const source of [channelsStore, dashboardStore, banner]) {
      expect(source).toContain('normalizeWhatsappConnectionStatusOrder');
      expect(source).toContain('compareWhatsappConnectionStatusOrders');
    }
    expect(channelsStore).toContain('channel.connection_status_order');
    expect(channelsStore).toContain(
      'input.connection_online_acknowledged === true'
    );
  });

  it('derives missing event identity from persisted channel fences', () => {
    expect(channelsStore).toContain('evaluateWhatsappRealtimeStatusFence({');
    expect(channelsStore).toContain('persistedWorkerTypeId');
    expect(channelsStore).toContain('channel?.runtime_generation');
    expect(banner).toContain('persistedWorkerTypeByWorker');
    expect(banner).toContain('runtimeGenerationByWorker');
    expect(banner).toContain('evaluateWhatsappRealtimeStatusFence({');
  });

  it('does not let telemetry mutate the business status in browser state', () => {
    expect(channelsStore).toContain("input.event_type === 'status'");
    expect(channelsStore).toContain(
      'channel.status.id = input.worker_status_id'
    );
    expect(banner).toContain(
      "const mutatesWorkerStatus = data.event_type === 'status'"
    );
    expect(channelsPage).toContain("data.event_type === 'status'");
  });

  it('uses the common lifecycle-aware fail-closed projection in every channel status surface', () => {
    expect(channelStatusPresentation).toContain(
      'projectWhatsappChannelDisplayStatus(input)'
    );
    for (const surface of [channelsPage, banner]) {
      expect(surface).toContain('useChannelStatusPresentationStore()');
    }
    for (const surface of [channelsPage, banner, configChannelsPage]) {
      expect(surface).toContain('resolveChannelStatusPresentation(');
    }
    expect(channelsPage).not.toContain("key: 'connection_status'");
    expect(channelsPage).not.toContain('#item.connection_status');
    expect(channelsPage).toContain('resolveChannelStatusVariant(item)');
    expect(configChannelsPage).toContain('resolveStatusVariant(item)');
    expect(configChannelsPage).toContain(
      'recreatePhase: channel.recreate_phase'
    );
  });

  it('renders every customer-visible transient status as a localized label', () => {
    expect(channelStatusPresentation).toContain("text: t('connecting')");
    for (const locale of connectionStatusLocales) {
      expect(locale.connecting).toEqual(expect.any(String));
      expect(locale.connecting.trim()).not.toBe('');
    }
  });

  it('uses customer-facing channel labels without changing lifecycle IDs', () => {
    expect(channelStatusPresentation).toContain("t('channel_connected')");
    expect(channelStatusPresentation).toContain("t('awaiting_qr_code')");
    expect(connectionStatusLocales[0].channel_connected).toBe('Conectado');
    expect(connectionStatusLocales[0].awaiting_qr_code).toBe(
      'Aguardando leitura do QR code'
    );
  });

  it('keeps unofficial worker ONLINE as connecting without a central ACK', () => {
    expect(channelStatusPresentationStore).toContain(
      'channel.connection_online_acknowledged === true'
    );
    expect(banner).toContain(
      'presentationSnapshot?.connectionOnlineAcknowledged === true'
    );
    expect(connectionModal).toContain(
      'props.initialConnectionOnlineAcknowledged === true &&'
    );
    expect(connectionModal).toContain(
      'data.connection_online_acknowledged !== true'
    );
    expect(connectionModal).toContain(
      'nativeConnectionOnlineAcknowledged.value &&'
    );
  });

  it('reconciles the banner after remount without polling and replays the subscription gap', () => {
    expect(banner).toContain('getDashboardOfflineChannels(true)');
    expect(banner).toContain('fetchRecentHistoryAndProcess(');
    expect(banner).toContain('workerStatusOffsetByWorker');
    expect(banner).not.toContain('setInterval(');
  });

  it('does not render lifecycle deletion statuses in the offline banner', () => {
    expect(banner).toContain('hiddenLifecycleDeletionStatuses');
    expect(banner).toContain('EWorkerStatus.deleting');
    expect(banner).toContain('EWorkerStatus.delete');
    expect(banner).toContain('!hiddenLifecycleDeletionStatuses.has');
  });

  it('keeps banner recreation fenced from late events of the retired runtime', () => {
    expect(banner).toContain('managerLifecycleRuntimeFence');
    expect(banner).toContain('createManagerWorkerLifecycleRuntimeFence()');
    expect(
      banner.match(/!managerLifecycleRuntimeFence\.acceptProviderRuntime\(\{/gu)
    ).toHaveLength(3);

    const seedBranch = banner.indexOf(
      'const seedNativeConnectionOrdering = () =>'
    );
    const seedRuntimeFence = banner.indexOf(
      '!managerLifecycleRuntimeFence.acceptProviderRuntime({',
      seedBranch
    );
    const staleHttpLifecycleRestore = banner.indexOf(
      'dashboardStore.updateOfflineChannelStatus(',
      seedRuntimeFence
    );
    expect(seedRuntimeFence).toBeGreaterThan(seedBranch);
    expect(staleHttpLifecycleRestore).toBeGreaterThan(seedRuntimeFence);

    const nativeBranch = banner.indexOf(
      'if (data.connection_status !== undefined)'
    );
    const runtimeFence = banner.indexOf(
      '!managerLifecycleRuntimeFence.acceptProviderRuntime({',
      nativeBranch
    );
    const nativeProjectionMutation = banner.indexOf(
      'persistedWorkerTypeByWorker.set',
      runtimeFence
    );
    expect(nativeBranch).toBeGreaterThan(-1);
    expect(runtimeFence).toBeGreaterThan(nativeBranch);
    expect(nativeProjectionMutation).toBeGreaterThan(runtimeFence);
  });

  it('derives banner membership from the canonical accepted lifecycle snapshot', () => {
    expect(banner).toContain(
      'const presentationAccepted =\n    channelStatusPresentationStore.applyRealtimeEvent(data);'
    );
    expect(banner).toContain(
      'managerLifecycleRuntimeFence.synchronizeAuthoritativeState({'
    );
    const acceptedLifecycle = banner.indexOf(
      'presentationSnapshot?.lifecycleOperationId'
    );
    const createsLifecycleRow = banner.indexOf(
      'dashboardStore.applyOfflineChannelStatusEvent({',
      acceptedLifecycle
    );
    expect(acceptedLifecycle).toBeGreaterThan(-1);
    expect(createsLifecycleRow).toBeGreaterThan(acceptedLifecycle);

    const terminalBranch = banner.indexOf(
      'isManagerWorkerRecreateCompletedStatusEvent(data)'
    );
    const removesOnline = banner.indexOf(
      'dashboardStore.removeOfflineChannel(data.worker_id);',
      terminalBranch
    );
    const keepsDisponibleWarning = banner.indexOf(
      'statusId: EWorkerStatus.disponible',
      removesOnline
    );
    expect(terminalBranch).toBeGreaterThan(-1);
    expect(removesOnline).toBeGreaterThan(terminalBranch);
    expect(keepsDisponibleWarning).toBeGreaterThan(removesOnline);
  });

  it('does not let rejected pre-terminal native or raw events recreate a banner row', () => {
    expect(banner).toContain('canonicalSnapshotIncludesPublication');
    const canonicalGate = banner.indexOf('if (!presentationObserved) return;');
    const nativeBranch = banner.indexOf(
      'if (data.connection_status !== undefined)'
    );
    const rawBranch = banner.indexOf(
      'const realtimeFence = evaluateWhatsappRealtimeStatusFence({',
      nativeBranch + 1
    );
    expect(canonicalGate).toBeGreaterThan(-1);
    expect(nativeBranch).toBeGreaterThan(canonicalGate);
    expect(rawBranch).toBeGreaterThan(nativeBranch);
  });

  it('recovers worker-status subscriptions without requiring a page refresh', () => {
    for (const source of [channelsPage, banner, configChannelsPage]) {
      expect(source).toContain('useResilientCentrifugoSubscription({');
      expect(source).toContain('acknowledgeRecoveryAfterSubscribed: true');
    }
    expect(connectionModal).toContain('useResilientCentrifugoSubscription({');
    expect(channelsPage).toContain(
      'await channelsStore.listChannels(query.value);'
    );
    expect(configChannelsPage).toContain(
      'await Promise.all([loadStatistics(), loadChannels()]);'
    );
    expect(connectionModal).toContain('await loadExternalConnectionLink();');
    expect(connectionModal).toContain(
      "recoverQrFromRecentHistory('subscription_ready')"
    );
    expect(connectionModal).not.toContain(
      'await onMessage(workerConnectionChannel.value'
    );
    expect(externalConnection).toContain(
      'scheduleExternalSubscriptionRetry();'
    );
    expect(externalConnection).toContain('void loadExternalConnection(false);');
  });

  it('projects persisted native non-online states on both connection reload surfaces', () => {
    expect(connectionModal).toContain('applyInitialNativeStatusProjection()');
    expect(connectionModal).toContain('applyWhatsappConnectionStatus(');
    expect(externalConnection).toContain('acceptedNativeStatus');
    expect(externalConnection).toContain('applyWhatsappConnectionStatus(');
    expect(externalConnection).toContain(
      'projected.disconnected_user === true'
    );
  });

  it('keeps the reactive channel store authoritative while its modal is open', () => {
    expect(channelsPage).toMatch(
      /currentConnectionChannel\.value\?\.type\?\.id\s*\?\?\s*channelConnectionType\.value/u
    );
    expect(channelsPage).toMatch(
      /currentConnectionChannel\.value\?\.status\?\.id\s*\?\?\s*channelConnectionStatus\.value/u
    );
  });

  it('keeps both QR surfaces monotonic after a durable ONLINE acknowledgement', () => {
    for (const source of [connectionModal, externalConnection]) {
      expect(source).toContain('evaluateConnectionModalPublication({');
      expect(source).toContain('shouldClearConnectionModalQr({');
      expect(source).toContain('nativeResolution');
      expect(source).toContain('nativeConnectionStatusOrder.value');
    }
    expect(connectionModal).toContain(
      'applyAuthoritativeInitialOnlineProjection()'
    );
    expect(connectionModal).toContain(
      "'web.connection_modal.authoritative_projection_applied'"
    );
    expect(externalConnection).toContain(
      "nativeResolution === 'duplicate' && !centrallyAcknowledgedOnline"
    );
  });

  it('does not turn an attempt-scoped terminal QR publication into a new request loop', () => {
    expect(connectionModal).toMatch(
      /presentationSnapshot\?\.workerStatusId === EWorkerStatus\.disponible[\s\S]+!connectionData\.connection_attempt_id\s*&&\s*!connectionAttemptId\.value[\s\S]+requestQrCodeIfReady\(\{ silent: true \}\)/u
    );
  });

  it('keeps a rotated QR credential when its attached native snapshot is a duplicate', () => {
    expect(connectionModal).toMatch(
      /acceptance\.outcome === 'stale'\s*&&\s*isCurrentQrAttemptProgressPublication\(data\)/u
    );
    expect(connectionModal).toContain('connection_status: undefined');
    expect(connectionModal).toContain("nativeResolution: 'none'");
  });

  it('enables safe browser lifecycle traces from the shared WhatsApp debug switch', () => {
    expect(webConnectionDebug).toContain(
      "import.meta.env.WHATSAPP_SESSION_DEBUG_ENABLED === 'true'"
    );
    expect(webViteConfig).toContain(
      "'import.meta.env.WHATSAPP_SESSION_DEBUG_ENABLED'"
    );
    expect(webViteConfig).not.toContain("envPrefix: 'WHATSAPP_SESSION_'");
  });
});
