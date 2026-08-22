<script lang="ts" setup>
import {
  computed,
  onMounted,
  onUnmounted,
  shallowRef,
  toRef,
  watch,
} from 'vue';
import { fetchRecentHistoryAndProcess } from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import {
  canonicalSnapshotIncludesPublication,
  isSessionRemovalTerminalPublication,
  type ChannelStatusPresentationSnapshot,
  useChannelStatusPresentationStore,
} from '@/@webcore/stores/channelStatusPresentation';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerSecureConnectionSessionResponse } from '@core/schema/worker/secureConnection/response.schema';
import {
  normalizeWorkerConnectionModalState,
  type WorkerConnectionModalState,
} from '@core/common/functions/normalizeWorkerConnectionModalState';
import { reduceWorkerConnectionState } from '@core/common/functions/reduceWorkerConnectionState';
import { isWorkerConnectionResetGenerationHandoff } from '@core/common/functions/isWorkerConnectionResetGenerationHandoff';
import {
  isWhatsappQrCredentialConsumedState,
  isWhatsappQrCredentialPendingState,
} from '@core/common/functions/isWhatsappQrCredentialConsumedState';
import { isWhatsappQrAttemptExhaustedState } from '@core/common/functions/isWhatsappQrAttemptExhaustedState';
import {
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
  logConnectionLifecycleDebug,
} from '@/@webcore/utils/connectionLifecycleDebug';
import { logLocalConnectionStatus } from '@/@webcore/utils/localConnectionStatusLog';
import ConnectionMethodChooser from './ConnectionMethodChooser.vue';
import ConnectionAuthenticatorInstallPanel from './ConnectionAuthenticatorInstallPanel.vue';
import ConnectionChromeExtensionPanel from './ConnectionChromeExtensionPanel.vue';
import ConnectionSecurePanel from './ConnectionSecurePanel.vue';
import ChannelMigrationProgress from './ChannelMigrationProgress.vue';
import ConnectionLifecycleStage from './ConnectionLifecycleStage.vue';
import { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { WhatsappConnectionStatusProvider } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { applyWhatsappConnectionStatus } from '@core/common/functions/applyWhatsappConnectionStatus';
import {
  isWhatsappConnectionOnline,
  projectWhatsappChannelDisplayStatus,
} from '@core/common/functions/whatsappConnectionStatus';
import {
  evaluateConnectionModalPublication,
  shouldClearConnectionModalQr,
  useWhatsappConnectionStatus,
  type WhatsappConnectionStatusResolution,
} from '@/composables/useWhatsappConnectionStatus';
import { useResilientCentrifugoSubscription } from '@/composables/useResilientCentrifugoSubscription';
import type { DisconnectWorkerConnectionResponse } from '@core/schema/worker/disconnectWorkerConnection/response.schema';

const channelStore = useChannelsStore();
const channelStatusPresentationStore = useChannelStatusPresentationStore();

type ConnectionMethod =
  | 'authenticator_install'
  | 'chrome_extension'
  | 'method_selection'
  | 'qrcode'
  | 'secure';
type AuthenticatorPlatform = 'linux' | 'macos' | 'windows';

type WorkerSecureConnectionPublication = {
  account_id?: string;
  secure_connection?: WorkerSecureConnectionSessionResponse;
  worker_id?: string;
};

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
  channelType: string | null;
  accountId: string | null;
  initialStatusId?: string | null;
  initialPhone?: string | null;
  debugTraceId?: string | null;
  initialConnectionStatus?: IWhatsappConnectionStatus | null;
  initialConnectionStatusSourceId?: string | null;
  initialConnectionStatusOrder?: string | null;
  initialConnectionOnlineAcknowledged?: boolean;
  /** A brand-new worker is bootstrapping; no previous session was removed. */
  isInitialCreation?: boolean;
  /** The source session is being preserved while a PostgreSQL handoff runs. */
  isSessionMigration?: boolean;
  /** Original connection type shown while a preserved-session handoff runs. */
  migrationSourceType?: string | null;
  /** Optional source server label for an administrative server migration. */
  migrationSourceServerName?: string | null;
  /** Optional target server label for an administrative server migration. */
  migrationTargetServerName?: string | null;
  /** This lifecycle request intentionally removed the previous session. */
  isDestructiveReset?: boolean;
  /** Uses the project dialog radius without changing shared channel screens. */
  standardAppearance?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'sessionRemoved', result: DisconnectWorkerConnectionResponse): void;
  (e: 'connectionStarted', workerId: string): void;
  (e: 'migrationCancelRequested'): void;
  (e: 'migrationTimedOut'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');
const channelType = toRef(props, 'channelType');
const accountId = toRef(props, 'accountId');
const activeWorkerTypeId = shallowRef<string | null>(props.channelType ?? null);
const activeDebugTraceId = shallowRef<string | undefined>(
  props.debugTraceId ?? undefined
);
const {
  status: nativeConnectionStatus,
  sourceId: nativeConnectionStatusSourceId,
  order: nativeConnectionStatusOrder,
  accept: acceptNativeConnectionStatus,
  reset: resetNativeConnectionStatus,
} = useWhatsappConnectionStatus();

function connectionStatusProvider(
  workerTypeId: string | null | undefined
): WhatsappConnectionStatusProvider | undefined {
  if (workerTypeId === EWorkerType.baileys) return 'baileys';
  if (workerTypeId === EWorkerType.wwebjs) return 'wwebjs';
  if (workerTypeId === EWorkerType.whatsmeow) return 'whatsmeow';
  return undefined;
}

function acceptInitialNativeConnectionStatus(): void {
  if (!props.initialConnectionStatus) return;
  acceptNativeConnectionStatus({
    snapshot: props.initialConnectionStatus,
    sourceId: props.initialConnectionStatusSourceId,
    order: props.initialConnectionStatusOrder,
    expectedProvider: connectionStatusProvider(props.channelType),
  });
}

acceptInitialNativeConnectionStatus();
const nativeConnectionOnlineAcknowledged = shallowRef(
  props.initialConnectionOnlineAcknowledged === true &&
    isWhatsappConnectionOnline(nativeConnectionStatus.value)
);
const workerConnectionChannel = computed(() =>
  accountId.value ? workerCentrifugoQueue(accountId.value) : ''
);
const canonicalPresentationSnapshot = computed(() =>
  channelId.value
    ? channelStatusPresentationStore.snapshot(channelId.value)
    : undefined
);

const QR_MAX_AGE_MS = 120_000;
const QR_REQUEST_TIMEOUT_MS = 30_000;
const QR_HISTORY_RECOVERY_LIMIT = 250;
const SECURE_CONNECTION_POLL_INTERVAL_MS = 8_000;
const SECURE_CONNECTION_POLLABLE_STATUSES = new Set<string>([
  'session_received',
  'importing',
  'validating_worker',
  'connected',
]);
const QR_HISTORY_RECOVERY_DELAYS_MS = [
  1_500, 5_000, 10_000, 20_000, 40_000, 80_000, 120_000,
] as const;
const QR_REQUESTABLE_WORKER_STATUSES = new Set<string>([
  EWorkerStatus.disponible,
  EWorkerStatus.offline,
  EWorkerStatus.mismatched,
  EWorkerStatus.error,
]);
const QR_ATTEMPT_TERMINAL_WORKER_STATUSES = new Set<string>([
  EWorkerStatus.blocked,
  EWorkerStatus.delete,
  EWorkerStatus.deleting,
  EWorkerStatus.stopped,
]);
const QR_ATTEMPT_TERMINAL_NATIVE_STATUSES = new Set<string>([
  EWhatsappConnectionStatus.conflict,
  EWhatsappConnectionStatus.error,
  EWhatsappConnectionStatus.invalidSession,
  EWhatsappConnectionStatus.leaseLost,
  EWhatsappConnectionStatus.loggedOut,
  EWhatsappConnectionStatus.offline,
]);
const QR_ATTEMPT_PROGRESS_CODES = new Set<ECodeMessage>([
  ECodeMessage.newLoginAttempt,
  ECodeMessage.awaitingReadQrCode,
  ECodeMessage.awaitConnection,
  ECodeMessage.awaitingPairingCode,
  ECodeMessage.pairingInProgress,
  ECodeMessage.awaitingPasskey,
  ECodeMessage.awaitingPasskeyConfirmation,
  ECodeMessage.info,
]);
const qrHistoryRecoveryTimeouts = new Set<number>();
let qrHistoryRecoveryAttemptId: string | undefined;

const statusConnection = shallowRef<EBaileysConnectionStatus>(
  EBaileysConnectionStatus.connecting
);
const statusCode = shallowRef<ECodeMessage>(ECodeMessage.awaitConnection);
const qrcode = shallowRef<string | undefined>();
const passkeyPublicKey = shallowRef<string | undefined>();
const passkeyConfirmationPrimary = shallowRef('');
const passkeyConfirmationSecondary = shallowRef('');
const passkeyError = shallowRef<string | null>(null);
const connectionAttemptId = shallowRef<string | undefined>();
const connectionRuntimeGeneration = shallowRef<number | undefined>();
const qrPending = shallowRef(false);
const qrAttempt = shallowRef(0);
const qrMaxAttempts = shallowRef(0);
const workerStatusId = shallowRef<string | null>(props.initialStatusId ?? null);
const isRequestingQr = shallowRef(false);
const isPasskeyRunning = shallowRef(false);
const isPasskeyConfirming = shallowRef(false);
const phoneNumber = shallowRef<string | null>(null);
const sessionReady = shallowRef(
  props.initialStatusId === EWorkerStatus.online &&
    nativeConnectionOnlineAcknowledged.value &&
    isWhatsappConnectionOnline(nativeConnectionStatus.value)
);
const disconnectedByUser = shallowRef(false);
const isResetting = shallowRef(false);
const isRemovingSession = shallowRef(false);
const connectionStartedEmitted = shallowRef(false);
const pairingCodePrimary = shallowRef('');
const pairingCodeSecondary = shallowRef('');
const externalConnectionUrl = shallowRef('');
const externalConnectionExpiresAt = shallowRef<string | null>(null);
const isExternalConnectionLinkLoading = shallowRef(false);
const isExternalConnectionCopied = shallowRef(false);
const selectedConnectionMethod =
  shallowRef<ConnectionMethod>('method_selection');
const secureSession = shallowRef<WorkerSecureConnectionSessionResponse | null>(
  null
);
const secureConnectionLifecycleFence = shallowRef(false);
const isSecureSessionLoading = shallowRef(false);
const isOpeningSecureHelper = shallowRef(false);
const isDownloadingAuthenticator = shallowRef(false);
const isDownloadingChromeExtension = shallowRef(false);
const secureHelperOpenTimeoutId = shallowRef<number | null>(null);
const securePollingIntervalId = shallowRef<number | null>(null);
const securePollingInFlight = shallowRef(false);

const secondsNextAttempt = shallowRef(0);
const intervalIdNextAttempt = shallowRef<number | null>(null);
const pairingStartedAt = shallowRef<number | null>(null);
const connectedStateDelayTimeout = shallowRef<number | null>(null);
const lastConnectionPublicationOffset = shallowRef(0);
let qrRequestGeneration = 0;

const connectionState = computed<Partial<IBaileysConnectionState>>(() => ({
  status: statusConnection.value,
  code: statusCode.value,
  worker_id: channelId.value ?? '',
  account_id: accountId.value ?? '',
  qrcode: qrcode.value,
  passkey_public_key: passkeyPublicKey.value,
  passkey_pending: Boolean(passkeyPublicKey.value),
  passkey_confirmation_code:
    passkeyConfirmationPrimary.value || passkeyConfirmationSecondary.value
      ? `${passkeyConfirmationPrimary.value}${passkeyConfirmationSecondary.value}`
      : undefined,
  worker_type_id: activeWorkerTypeId.value
    ? (activeWorkerTypeId.value as EWorkerType)
    : undefined,
  connection_attempt_id: connectionAttemptId.value,
  runtime_generation: connectionRuntimeGeneration.value,
  qr_pending: qrPending.value,
  attempt: qrAttempt.value || undefined,
  max_attempts: qrMaxAttempts.value || undefined,
  phone: phoneNumber.value ?? undefined,
  worker_status_id: workerStatusId.value
    ? (workerStatusId.value as EWorkerStatus)
    : undefined,
  session_ready: sessionReady.value,
  disconnected_user: disconnectedByUser.value,
  debug_trace_id: activeDebugTraceId.value,
  connection_status: nativeConnectionStatus.value,
  connection_status_source_id: nativeConnectionStatusSourceId.value,
  connection_status_order: nativeConnectionStatusOrder.value,
  connection_online_acknowledged:
    sessionReady.value &&
    isWhatsappConnectionOnline(nativeConnectionStatus.value),
}));

// A completed handoff and its ONLINE provider projection can arrive through
// different reactive sources in the same frame. Keep the migration surface
// mounted until the local canonical state has consumed a terminal proof;
// otherwise `method_selection` or `recreating` can flash for one render.
const isMigrationOutcomePending = shallowRef(props.isSessionMigration === true);
const canOfferNewConnection = computed(
  () => props.isSessionMigration !== true && !isMigrationOutcomePending.value
);

const isQrAttemptActive = computed(() =>
  Boolean(
    canOfferNewConnection.value &&
    selectedConnectionMethod.value === 'qrcode' &&
    (isRequestingQr.value ||
      (connectionAttemptId.value &&
        (qrPending.value ||
          qrcode.value ||
          pairingStartedAt.value !== null ||
          pairingCodePrimary.value ||
          pairingCodeSecondary.value ||
          passkeyPublicKey.value ||
          passkeyConfirmationPrimary.value ||
          passkeyConfirmationSecondary.value)))
  )
);

const baseModalState = computed<WorkerConnectionModalState>(() =>
  normalizeWorkerConnectionModalState(connectionState.value, {
    isResetting: isResetting.value,
    isSessionMigration: false,
    isDestructiveReset: props.isDestructiveReset === true,
    isQrAttemptActive: isQrAttemptActive.value,
  })
);

const releaseMigrationOutcomeFence = () => {
  if (
    props.isSessionMigration !== true &&
    isMigrationOutcomePending.value &&
    (baseModalState.value === 'connected' ||
      (props.initialStatusId === EWorkerStatus.error &&
        baseModalState.value === 'disconnected'))
  ) {
    isMigrationOutcomePending.value = false;
  }
};

watch(
  [() => props.isSessionMigration, () => props.initialStatusId, baseModalState],
  ([isSessionMigration]) => {
    if (isSessionMigration) {
      isMigrationOutcomePending.value = true;
      return;
    }
    releaseMigrationOutcomeFence();
  },
  { flush: 'sync', immediate: true }
);

const modalState = computed<WorkerConnectionModalState>(() =>
  props.isSessionMigration === true || isMigrationOutcomePending.value
    ? 'migrating'
    : baseModalState.value
);

const isConnected = computed(() => modalState.value === 'connected');
const dialogMaxWidth = computed(() => {
  if (!canOfferNewConnection.value) {
    return 900;
  }

  if (selectedConnectionMethod.value === 'authenticator_install') {
    return 820;
  }

  if (selectedConnectionMethod.value === 'chrome_extension') {
    return 780;
  }

  if (
    selectedConnectionMethod.value === 'method_selection' &&
    !isConnected.value
  ) {
    return 960;
  }

  return 860;
});
const isQrAttemptsExpired = computed(
  () => qrMaxAttempts.value > 0 && qrAttempt.value > qrMaxAttempts.value
);
const isBlockingOperation = computed(
  () =>
    isRemovingSession.value ||
    modalState.value === 'loggingOut' ||
    modalState.value === 'resetting' ||
    modalState.value === 'migrating' ||
    modalState.value === 'pairingInProgress'
);
const isConnectionPreparing = computed(
  () => modalState.value === 'starting' || modalState.value === 'qrPreparing'
);
const isWorkerReadyForQr = computed(
  () =>
    Boolean(workerStatusId.value) &&
    QR_REQUESTABLE_WORKER_STATUSES.has(workerStatusId.value as string)
);
const hasActiveConnectionCode = computed(
  () =>
    Boolean(qrcode.value) ||
    Boolean(pairingCodePrimary.value) ||
    Boolean(pairingCodeSecondary.value) ||
    Boolean(passkeyPublicKey.value) ||
    Boolean(passkeyConfirmationPrimary.value) ||
    Boolean(passkeyConfirmationSecondary.value)
);
const isActionLocked = computed(
  () =>
    channelStore.loading ||
    isRequestingQr.value ||
    isBlockingOperation.value ||
    isConnectionPreparing.value
);

const isQrConnectionSelected = computed(
  () => selectedConnectionMethod.value === 'qrcode'
);
const isChromeExtensionConnectionAvailable = computed(() => {
  const workerTypeId = activeWorkerTypeId.value ?? channelType.value;

  return (
    workerTypeId === EWorkerType.baileys ||
    workerTypeId === EWorkerType.wwebjs ||
    workerTypeId === EWorkerType.whatsmeow
  );
});
const chromeExtensionStoreUrl = computed(
  () => import.meta.env.VITE_UNDERCHAT_CHROME_EXTENSION_URL?.trim() ?? ''
);
const chromeExtensionPackageUrl = computed(() =>
  channelStore.getChromeExtensionPackageUrl()
);
const authenticatorDownloadUrls = computed<
  Record<AuthenticatorPlatform, string>
>(() => ({
  linux: channelStore.getAuthenticatorInstallerUrl('linux'),
  macos: channelStore.getAuthenticatorInstallerUrl('macos'),
  windows: channelStore.getAuthenticatorInstallerUrl('windows'),
}));
const showConnectionChooser = computed(
  () =>
    canOfferNewConnection.value &&
    selectedConnectionMethod.value === 'method_selection' &&
    !isConnected.value &&
    !isBlockingOperation.value
);

const formattedTime = computed(() => {
  const m = Math.floor(secondsNextAttempt.value / 60)
    .toString()
    .padStart(2, '0');
  const s = (secondsNextAttempt.value % 60).toString().padStart(2, '0');

  return `${m}:${s}`;
});

const stageMeta = computed(() => {
  const meta: Record<
    WorkerConnectionModalState,
    {
      title: string;
      description: string;
      icon: string;
      color: string;
      loading?: boolean;
    }
  > = {
    starting: {
      title: 'connection_starting_title',
      description: 'connection_starting_description',
      icon: 'tabler-brand-whatsapp',
      color: 'primary',
      loading: true,
    },
    qrPreparing: {
      title: 'connection_qr_preparing_title',
      description: 'connection_qr_preparing_description',
      icon: 'tabler-qrcode',
      color: 'primary',
      loading: true,
    },
    qrReady: {
      title: 'awaiting_qr_code',
      description: 'connection_qr_ready_description',
      icon: 'tabler-qrcode',
      color: 'primary',
    },
    pairingInProgress: {
      title: 'connection_pairing_title',
      description: 'connection_pairing_description',
      icon: 'tabler-link',
      color: 'primary',
      loading: true,
    },
    connected: {
      title: 'connection_success',
      description: 'connection_success_description',
      icon: 'tabler-brand-whatsapp',
      color: 'success',
    },
    loggingOut: {
      title: 'connection_logout_title',
      description: 'connection_logout_description',
      icon: 'tabler-logout',
      color: 'warning',
      loading: true,
    },
    resetting: {
      title: 'connection_resetting_title',
      description: 'connection_resetting_description',
      icon: 'tabler-refresh',
      color: 'info',
      loading: true,
    },
    migrating: {
      title: 'connection_migrating_title',
      description: 'connection_migrating_description',
      // Keep this in the generated Iconify catalogue. `arrows-exchange` was
      // not emitted in icons.css, which left the migration spinner blank.
      icon: 'tabler-arrows-right-left',
      color: 'info',
      loading: true,
    },
    disconnected: {
      title: isQrAttemptsExpired.value
        ? 'qrcode_attempts_expired_title'
        : disconnectedByUser.value
          ? 'connection_removed'
          : 'connection_disconnected_title',
      description: isQrAttemptsExpired.value
        ? 'qrcode_attempts_expired_description'
        : 'connection_disconnected_description',
      icon: 'tabler-plug-connected-x',
      color: 'error',
    },
    phoneUnavailable: {
      title: 'phone_not_available',
      description: 'wait_until_next_attempt',
      icon: 'tabler-device-mobile-off',
      color: 'warning',
    },
    phoneInput: {
      title: 'for_phone',
      description: 'request_phone_number',
      icon: 'tabler-device-mobile-message',
      color: 'primary',
    },
    pairing: {
      title: 'for_phone',
      description: 'for_phone_description',
      icon: 'tabler-device-mobile-code',
      color: 'primary',
      loading: !pairingCodePrimary.value || !pairingCodeSecondary.value,
    },
    passkeyRequired: {
      title: 'passkey_required_title',
      description: 'passkey_required_description',
      icon: 'tabler-key',
      color: 'primary',
      loading: isPasskeyRunning.value,
    },
    passkeyConfirmation: {
      title: 'passkey_confirmation_title',
      description: 'passkey_confirmation_description',
      icon: 'tabler-shield-check',
      color: 'primary',
      loading: isPasskeyConfirming.value,
    },
  };

  return meta[modalState.value];
});

const visibleStageMeta = computed(() =>
  isRemovingSession.value
    ? {
        title: 'connection_removing_session_title',
        description: 'connection_removing_session_description',
        icon: 'tabler-logout',
        color: 'warning',
        loading: true,
      }
    : stageMeta.value
);

const showQrRestartAction = computed(
  () => modalState.value === 'disconnected' && isWorkerReadyForQr.value
);
const showPrimaryActions = computed(
  () =>
    canOfferNewConnection.value &&
    !isRemovingSession.value &&
    (isConnected.value ||
      showQrRestartAction.value ||
      modalState.value === 'passkeyRequired' ||
      modalState.value === 'passkeyConfirmation')
);
const showExternalConnectionLink = computed(
  () =>
    canOfferNewConnection.value &&
    !isConnected.value &&
    selectedConnectionMethod.value === 'qrcode'
);

const externalConnectionExpiresAtFormatted = computed(() => {
  if (!externalConnectionExpiresAt.value) {
    return '';
  }

  const expiresAt = new Date(externalConnectionExpiresAt.value);
  if (Number.isNaN(expiresAt.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(expiresAt);
});

async function loadExternalConnectionLink() {
  if (!showExternalConnectionLink.value || !channelId.value) {
    externalConnectionUrl.value = '';
    externalConnectionExpiresAt.value = null;
    return;
  }

  isExternalConnectionLinkLoading.value = true;
  isExternalConnectionCopied.value = false;

  try {
    const link = await channelStore.createExternalConnectionLink(
      channelId.value
    );

    if (!showExternalConnectionLink.value) {
      externalConnectionUrl.value = '';
      externalConnectionExpiresAt.value = null;
      return;
    }

    externalConnectionUrl.value = link?.url ?? '';
    externalConnectionExpiresAt.value = link?.expires_at ?? null;
  } finally {
    isExternalConnectionLinkLoading.value = false;
  }
}

async function copyExternalConnectionLink() {
  if (!showExternalConnectionLink.value || !externalConnectionUrl.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(externalConnectionUrl.value);
    isExternalConnectionCopied.value = true;
  } catch {
    return;
  }

  window.setTimeout(() => {
    isExternalConnectionCopied.value = false;
  }, 2000);
}

function isSecureConnectionTerminal(
  session: WorkerSecureConnectionSessionResponse | null
): boolean {
  return Boolean(
    session &&
    ['connected_confirmed', 'failed', 'expired', 'cancelled'].includes(
      session.status
    )
  );
}

function hasSecureConnectionCredentials(
  session: WorkerSecureConnectionSessionResponse | null
): boolean {
  return Boolean(session?.token);
}

function shouldPollSecureConnectionSession(
  session: WorkerSecureConnectionSessionResponse | null
): boolean {
  return Boolean(
    session?.token && SECURE_CONNECTION_POLLABLE_STATUSES.has(session.status)
  );
}

function hasActiveSecureConnectionAttempt(): boolean {
  return Boolean(
    secureSession.value &&
    !isSecureConnectionTerminal(secureSession.value) &&
    hasSecureConnectionCredentials(secureSession.value)
  );
}

function hasReusableSecureConnectionAttempt(): boolean {
  return hasActiveSecureConnectionAttempt();
}

function isSecureConnectionMethodActive(): boolean {
  return (
    selectedConnectionMethod.value === 'secure' ||
    selectedConnectionMethod.value === 'authenticator_install' ||
    selectedConnectionMethod.value === 'chrome_extension'
  );
}

function beginSecureConnectionLifecycleFence(): void {
  secureConnectionLifecycleFence.value = true;
  qrRequestGeneration += 1;
  isRequestingQr.value = false;
  qrcode.value = undefined;
  qrPending.value = false;
  clearQrHistoryRecovery();
}

function releaseSecureConnectionLifecycleFence(): void {
  secureConnectionLifecycleFence.value = false;
}

function shouldApplySecureConnectionPublication(
  session: WorkerSecureConnectionSessionResponse
): boolean {
  if (session.token) {
    return true;
  }

  const current = secureSession.value;
  if (!current) {
    return session.status === 'connected_confirmed';
  }

  const sameAttempt =
    session.connection_attempt_id === current.connection_attempt_id ||
    session.token_hash === current.token_hash;

  if (!sameAttempt) {
    return false;
  }

  return (
    hasSecureConnectionCredentials(current) ||
    session.status === 'connected_confirmed'
  );
}

function clearSecureHelperOpenTimeout() {
  if (secureHelperOpenTimeoutId.value !== null) {
    window.clearTimeout(secureHelperOpenTimeoutId.value);
    secureHelperOpenTimeoutId.value = null;
  }
}

function stopSecureConnectionPolling() {
  if (securePollingIntervalId.value !== null) {
    window.clearInterval(securePollingIntervalId.value);
    securePollingIntervalId.value = null;
  }
}

function suspendConnectionOfferSideEffects() {
  stopSecureConnectionPolling();
  clearSecureHelperOpenTimeout();
  clearQrHistoryRecovery();
  clearNextAttemptCountdown();
  selectedConnectionMethod.value = 'method_selection';
  secureSession.value = null;
  externalConnectionUrl.value = '';
  externalConnectionExpiresAt.value = null;
  isExternalConnectionCopied.value = false;
  isOpeningSecureHelper.value = false;
  qrcode.value = undefined;
  qrPending.value = false;
  isRequestingQr.value = false;
  resetQrAttempts();
  resetPairingCodes();
  resetPasskeyState();
}

function startSecureConnectionPolling() {
  stopSecureConnectionPolling();

  if (
    !canOfferNewConnection.value ||
    !channelId.value ||
    !secureSession.value?.token
  ) {
    return;
  }

  securePollingIntervalId.value = window.setInterval(() => {
    void pollSecureConnectionSession();
  }, SECURE_CONNECTION_POLL_INTERVAL_MS);
}

function applySecureConnectionSession(
  session: WorkerSecureConnectionSessionResponse
) {
  if (!canOfferNewConnection.value) {
    return;
  }

  const previous = secureSession.value;
  const nextSession: WorkerSecureConnectionSessionResponse = {
    ...previous,
    ...session,
    token: session.token ?? previous?.token,
    deep_link: session.deep_link ?? previous?.deep_link,
    helper_download_url:
      session.helper_download_url ?? previous?.helper_download_url,
  };

  if (['failed', 'expired', 'cancelled'].includes(nextSession.status)) {
    releaseSecureConnectionLifecycleFence();
  } else {
    beginSecureConnectionLifecycleFence();
  }

  secureSession.value = nextSession;
  connectionAttemptId.value = nextSession.connection_attempt_id;
  connectionRuntimeGeneration.value =
    nextSession.runtime_generation ?? connectionRuntimeGeneration.value;

  if (
    nextSession.status === 'connected_confirmed' &&
    nativeConnectionOnlineAcknowledged.value &&
    isWhatsappConnectionOnline(nativeConnectionStatus.value)
  ) {
    statusConnection.value = EBaileysConnectionStatus.connected;
    statusCode.value = ECodeMessage.connectionEstablished;
    workerStatusId.value = EWorkerStatus.online;
    sessionReady.value = true;
    qrcode.value = undefined;
    qrPending.value = false;
    phoneNumber.value = nextSession.phone
      ? formatPhoneBR(nextSession.phone)
      : null;
    clearQrHistoryRecovery();
  } else if (nextSession.status === 'connected_confirmed') {
    // The secure helper confirms that the handoff finished, but only the
    // provider itself can confirm that the WhatsApp socket is online.
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitConnection;
    sessionReady.value = false;
  }

  if (['failed', 'expired', 'cancelled'].includes(nextSession.status)) {
    clearConnectedStateDelay();
    statusConnection.value = EBaileysConnectionStatus.disconnected;
    statusCode.value = ECodeMessage.awaitConnection;
    workerStatusId.value = EWorkerStatus.disponible;
    sessionReady.value = false;
  }

  if (isSecureConnectionTerminal(nextSession)) {
    stopSecureConnectionPolling();
    return;
  }

  if (isVisible.value && isSecureConnectionMethodActive()) {
    startSecureConnectionPolling();

    if (shouldPollSecureConnectionSession(nextSession)) {
      void pollSecureConnectionSession();
    }
  }
}

async function pollSecureConnectionSession() {
  if (
    !canOfferNewConnection.value ||
    !channelId.value ||
    !secureSession.value?.token
  ) {
    stopSecureConnectionPolling();
    return;
  }

  if (securePollingInFlight.value) {
    return;
  }

  securePollingInFlight.value = true;

  try {
    const session = await channelStore.viewSecureConnectionSession(
      channelId.value,
      secureSession.value.token,
      { silent: true }
    );

    if (canOfferNewConnection.value && session) {
      applySecureConnectionSession(session);
    }
  } finally {
    securePollingInFlight.value = false;
  }
}

function openSecureHelper() {
  if (!canOfferNewConnection.value || !secureSession.value?.deep_link) {
    return;
  }

  clearSecureHelperOpenTimeout();
  isOpeningSecureHelper.value = true;
  window.location.href = secureSession.value.deep_link;
  secureHelperOpenTimeoutId.value = window.setTimeout(() => {
    isOpeningSecureHelper.value = false;
    secureHelperOpenTimeoutId.value = null;
  }, 1400);
}

async function startSecureConnection(
  options: {
    method?: Extract<ConnectionMethod, 'chrome_extension' | 'secure'>;
    openHelper?: boolean;
  } = {}
) {
  if (
    !canOfferNewConnection.value ||
    !channelId.value ||
    isSecureSessionLoading.value
  ) {
    return;
  }

  emitConnectionStarted();
  beginSecureConnectionLifecycleFence();
  selectedConnectionMethod.value = options.method ?? 'secure';

  if (hasReusableSecureConnectionAttempt()) {
    if (options.openHelper !== false) {
      openSecureHelper();
    }
    startSecureConnectionPolling();
    return;
  }

  secureSession.value = null;
  isSecureSessionLoading.value = true;
  const debugTraceId = ensureDebugTraceId('web_secure_connection_modal');

  try {
    const session = await channelStore.createSecureConnectionSession(
      channelId.value,
      {
        silent: true,
        debugTraceId,
      }
    );

    if (!canOfferNewConnection.value || !session) {
      return;
    }

    applySecureConnectionSession(session);
    startSecureConnectionPolling();

    if (options.openHelper !== false) {
      openSecureHelper();
    }
  } finally {
    isSecureSessionLoading.value = false;
  }
}

async function continueAuthenticatorConnection() {
  await startSecureConnection({ method: 'secure' });
}

async function startChromeExtensionConnection() {
  if (!canOfferNewConnection.value) {
    return;
  }

  if (!isChromeExtensionConnectionAvailable.value) {
    selectedConnectionMethod.value = 'authenticator_install';
    void channelStore.getConnectionDownloadArtifacts({ silent: true });
    return;
  }

  await startSecureConnection({
    method: 'chrome_extension',
    openHelper: false,
  });
}

async function downloadAuthenticatorInstaller(platform: AuthenticatorPlatform) {
  if (!canOfferNewConnection.value) {
    return;
  }

  isDownloadingAuthenticator.value = true;

  try {
    await channelStore.downloadAuthenticatorInstaller(platform);
  } finally {
    isDownloadingAuthenticator.value = false;
  }
}

async function downloadChromeExtensionPackage() {
  if (!canOfferNewConnection.value) {
    return;
  }

  isDownloadingChromeExtension.value = true;

  try {
    await channelStore.downloadChromeExtensionPackage();
  } finally {
    isDownloadingChromeExtension.value = false;
  }
}

async function cancelSecureConnection() {
  if (!canOfferNewConnection.value) {
    return;
  }

  if (!channelId.value || !secureSession.value?.token) {
    selectedConnectionMethod.value = 'method_selection';
    return;
  }

  const session = await channelStore.cancelSecureConnectionSession(
    channelId.value,
    secureSession.value.token
  );

  if (session) {
    applySecureConnectionSession(session);
  }

  selectedConnectionMethod.value = 'method_selection';
}

function returnToConnectionMethodSelection() {
  selectedConnectionMethod.value = 'method_selection';
  qrcode.value = undefined;
  qrPending.value = false;
  connectionAttemptId.value = undefined;
  pairingStartedAt.value = null;
  resetQrAttempts();
  stopSecureConnectionPolling();
  clearSecureHelperOpenTimeout();
  clearQrHistoryRecovery();
}

function emitConnectionStarted(): void {
  if (!channelId.value || connectionStartedEmitted.value) return;
  connectionStartedEmitted.value = true;
  emit('connectionStarted', channelId.value);
}

async function selectConnectionMethod(
  method: 'chrome_extension' | 'secure' | 'qrcode'
) {
  if (!canOfferNewConnection.value) {
    return;
  }

  if (method === 'secure') {
    void channelStore.getConnectionDownloadArtifacts({ silent: true });
    selectedConnectionMethod.value = 'authenticator_install';
    return;
  }

  if (method === 'chrome_extension') {
    if (!isChromeExtensionConnectionAvailable.value) {
      void channelStore.getConnectionDownloadArtifacts({ silent: true });
      selectedConnectionMethod.value = 'authenticator_install';
      return;
    }

    void channelStore.getConnectionDownloadArtifacts({ silent: true });
    await startChromeExtensionConnection();
    return;
  }

  selectedConnectionMethod.value = 'qrcode';
  await Promise.all([
    loadExternalConnectionLink(),
    requestQrCodeIfReady({ force: true }),
  ]);
}

function handleSecureConnectionPublication(
  data: WorkerSecureConnectionPublication
) {
  if (
    !canOfferNewConnection.value ||
    !data.secure_connection ||
    data.worker_id !== channelId.value
  ) {
    return;
  }

  if (!shouldApplySecureConnectionPublication(data.secure_connection)) {
    logConnectionLifecycleDebug('web.secure_connection.publication_ignored', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: data.worker_id,
      account_id: accountId.value ?? undefined,
      incoming_connection_attempt_id:
        data.secure_connection.connection_attempt_id,
      incoming_status: data.secure_connection.status,
      incoming_token_hash: data.secure_connection.token_hash,
      current_connection_attempt_id: secureSession.value?.connection_attempt_id,
      current_status: secureSession.value?.status,
      current_token_hash: secureSession.value?.token_hash,
      reason: 'publication_without_reopen_credentials',
    });
    return;
  }

  applySecureConnectionSession(data.secure_connection);
}

async function switchToSecureConnectionFromPasskeyRequirement() {
  if (!canOfferNewConnection.value) {
    return;
  }

  if (
    selectedConnectionMethod.value === 'secure' ||
    selectedConnectionMethod.value === 'authenticator_install'
  ) {
    return;
  }

  selectedConnectionMethod.value = 'authenticator_install';
}

function resetPairingCodes() {
  pairingCodePrimary.value = '';
  pairingCodeSecondary.value = '';
}

function resetPasskeyState() {
  passkeyPublicKey.value = undefined;
  passkeyConfirmationPrimary.value = '';
  passkeyConfirmationSecondary.value = '';
  passkeyError.value = null;
  isPasskeyRunning.value = false;
  isPasskeyConfirming.value = false;
}

function resetQrAttempts() {
  qrAttempt.value = 0;
  qrMaxAttempts.value = 0;
}

function ensureDebugTraceId(prefix = 'web_connect_modal'): string | undefined {
  if (activeDebugTraceId.value) {
    return activeDebugTraceId.value;
  }

  if (!isConnectionLifecycleDebugEnabled()) {
    return undefined;
  }

  activeDebugTraceId.value = createConnectionLifecycleDebugTraceId(prefix);
  return activeDebugTraceId.value;
}

function hasExceededQrAttempts(data: Partial<IBaileysConnectionState>) {
  return (
    typeof data.attempt === 'number' &&
    typeof data.max_attempts === 'number' &&
    data.max_attempts > 0 &&
    data.attempt > data.max_attempts
  );
}

function hasExhaustedQrAttemptOverlay(): boolean {
  return Boolean(
    selectedConnectionMethod.value === 'qrcode' &&
    hasExceededQrAttempts(connectionState.value)
  );
}

function applyQrAttempts(data: Partial<IBaileysConnectionState>) {
  if (typeof data.attempt === 'number') {
    qrAttempt.value = data.attempt;
  }

  if (typeof data.max_attempts === 'number') {
    qrMaxAttempts.value = data.max_attempts;
  }
}

function splitCode(code: string): [string, string] {
  const normalized = code.replace(/[^A-Za-z0-9]/g, '');
  return [normalized.slice(0, 4), normalized.slice(4)];
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return globalThis
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parsePasskeyRequestOptions(
  publicKeyJson: string
): PublicKeyCredentialRequestOptions {
  type PublicKeyCredentialRequestOptionsJSON = Omit<
    PublicKeyCredentialRequestOptions,
    'allowCredentials' | 'challenge'
  > & {
    challenge: string;
    allowCredentials?: Array<{
      id: string;
      type: PublicKeyCredentialType;
      transports?: AuthenticatorTransport[];
    }>;
  };
  const parsed = JSON.parse(
    publicKeyJson
  ) as PublicKeyCredentialRequestOptionsJSON;
  const credentialConstructor = globalThis.PublicKeyCredential as
    | (typeof PublicKeyCredential & {
        parseRequestOptionsFromJSON?: (
          options: unknown
        ) => PublicKeyCredentialRequestOptions;
      })
    | undefined;

  if (credentialConstructor?.parseRequestOptionsFromJSON) {
    return credentialConstructor.parseRequestOptionsFromJSON(parsed);
  }

  return {
    ...parsed,
    challenge: base64UrlToArrayBuffer(parsed.challenge),
    allowCredentials: parsed.allowCredentials?.map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
  };
}

function serializePasskeyCredential(
  credential: PublicKeyCredential & { toJSON?: () => unknown }
): unknown {
  if (typeof credential.toJSON === 'function') {
    return credential.toJSON();
  }

  const response = credential.response as AuthenticatorResponse & {
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
  };

  if (!response.authenticatorData || !response.signature) {
    throw new Error('Invalid passkey credential response');
  }

  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : null,
    },
  };
}

function clearNextAttemptCountdown() {
  if (intervalIdNextAttempt.value !== null) {
    clearInterval(intervalIdNextAttempt.value);
    intervalIdNextAttempt.value = null;
  }
}

function clearConnectedStateDelay() {
  if (connectedStateDelayTimeout.value !== null) {
    clearTimeout(connectedStateDelayTimeout.value);
    connectedStateDelayTimeout.value = null;
  }
}

function clearQrHistoryRecovery() {
  for (const timeoutId of qrHistoryRecoveryTimeouts) {
    window.clearTimeout(timeoutId);
  }

  qrHistoryRecoveryTimeouts.clear();
  qrHistoryRecoveryAttemptId = undefined;
}

function qrPayloadAgeMs(data: Partial<IBaileysConnectionState>) {
  if (!data.qr_generated_at) {
    return undefined;
  }

  const generatedAtMs = Date.parse(data.qr_generated_at);
  if (!Number.isFinite(generatedAtMs)) {
    return undefined;
  }

  return Math.max(0, Date.now() - generatedAtMs);
}

function isQrPayloadExpired(data: Partial<IBaileysConnectionState>) {
  if (!data.qrcode) {
    return false;
  }

  if (data.expires_at) {
    const expiresAtMs = Date.parse(data.expires_at);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      return true;
    }
  }

  const ageMs = qrPayloadAgeMs(data);
  return ageMs === undefined || ageMs >= QR_MAX_AGE_MS;
}

function shouldIgnoreConnectionPayloadIdentity(
  data: Partial<IBaileysConnectionState>,
  options: { directResponse?: boolean } = {}
): boolean {
  let expectedWorkerTypeId = activeWorkerTypeId.value ?? channelType.value;
  const hasConnectionCredential = Boolean(
    data.qrcode ||
    data.pairing_code ||
    data.passkey_public_key ||
    data.passkey_confirmation_code
  );

  if (
    options.directResponse &&
    data.worker_type_id &&
    data.worker_type_id !== expectedWorkerTypeId
  ) {
    activeWorkerTypeId.value = data.worker_type_id;
    expectedWorkerTypeId = data.worker_type_id;
  }

  if (
    options.directResponse &&
    data.runtime_generation !== undefined &&
    connectionRuntimeGeneration.value !== undefined &&
    data.runtime_generation !== connectionRuntimeGeneration.value
  ) {
    connectionRuntimeGeneration.value = data.runtime_generation;
  }

  if (
    expectedWorkerTypeId &&
    data.worker_type_id &&
    data.worker_type_id !== expectedWorkerTypeId
  ) {
    return true;
  }

  if (hasConnectionCredential && !data.worker_type_id) {
    return true;
  }

  if (hasConnectionCredential && !data.connection_attempt_id) {
    return true;
  }

  if (
    hasConnectionCredential &&
    connectionRuntimeGeneration.value !== undefined &&
    data.runtime_generation === undefined
  ) {
    return true;
  }

  const currentRuntimeGeneration = connectionRuntimeGeneration.value;
  if (
    data.runtime_generation !== undefined &&
    currentRuntimeGeneration !== undefined &&
    data.runtime_generation !== currentRuntimeGeneration
  ) {
    if (
      isWorkerConnectionResetGenerationHandoff(data, {
        currentCode: statusCode.value,
        currentRuntimeGeneration,
        isResetting: isResetting.value,
      })
    ) {
      return false;
    }

    return true;
  }

  if (isQrPayloadExpired(data)) {
    return true;
  }

  return false;
}

function isConnectedPayload(data: Partial<IBaileysConnectionState>): boolean {
  return (
    data.status === EBaileysConnectionStatus.connected ||
    data.code === ECodeMessage.connectionEstablished ||
    data.worker_status_id === EWorkerStatus.online
  );
}

function shouldIgnoreConnectionPayload(
  data: Partial<IBaileysConnectionState>,
  nativeResolution: WhatsappConnectionStatusResolution
): boolean {
  if (
    canOfferNewConnection.value &&
    isConnectedPayload(data) &&
    hasActiveSecureConnectionAttempt() &&
    (isSecureConnectionMethodActive() ||
      data.connection_attempt_id === secureSession.value?.connection_attempt_id)
  ) {
    logLocalConnectionStatus('web.connection_modal.publication_ignored', {
      layer: 'web.connection_modal',
      worker_id: data.worker_id ?? channelId.value ?? undefined,
      account_id: data.account_id ?? accountId.value ?? undefined,
      worker_type_id: data.worker_type_id ?? activeWorkerTypeId.value,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      session_ready: data.session_ready,
      can_send: data.can_send,
      can_receive_runtime: data.can_receive_runtime,
      authenticated: data.authenticated,
      provider_state: data.provider_state,
      degraded_reason: data.degraded_reason,
      reason: 'secure_connection_waiting_connected_confirmed',
      phone: data.phone,
      connection_attempt_id: data.connection_attempt_id,
      secure_connection_attempt_id: secureSession.value?.connection_attempt_id,
      secure_connection_status: secureSession.value?.status,
      runtime_generation: data.runtime_generation,
    });
    return true;
  }

  const decision = evaluateConnectionModalPublication({
    currentAttemptId: connectionAttemptId.value,
    currentConnected: isConnected.value,
    hasDurableNativeOrder: Boolean(nativeConnectionStatusOrder.value),
    incoming: data,
    nativeResolution,
  });
  if (!decision.accepted) {
    logLocalConnectionStatus('web.connection_modal.publication_ignored', {
      layer: 'web.connection_modal',
      worker_id: data.worker_id ?? channelId.value ?? undefined,
      account_id: data.account_id ?? accountId.value ?? undefined,
      worker_type_id: data.worker_type_id ?? activeWorkerTypeId.value,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      session_ready: data.session_ready,
      can_send: data.can_send,
      can_receive_runtime: data.can_receive_runtime,
      authenticated: data.authenticated,
      provider_state: data.provider_state,
      degraded_reason: data.degraded_reason,
      reason: decision.reason,
      phone: data.phone,
      expected_connection_attempt_id: connectionAttemptId.value,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      connection_status_order: data.connection_status_order,
      native_resolution: nativeResolution,
    });
  }

  return !decision.accepted;
}

function canRecoverQrFromRecentHistory(): boolean {
  return (
    canOfferNewConnection.value &&
    isQrConnectionSelected.value &&
    isVisible.value &&
    Boolean(channelId.value) &&
    Boolean(workerConnectionChannel.value) &&
    Boolean(connectionAttemptId.value) &&
    !hasActiveConnectionCode.value &&
    !isConnected.value &&
    !isBlockingOperation.value
  );
}

async function recoverQrFromRecentHistory(reason: string): Promise<number> {
  if (!canRecoverQrFromRecentHistory() || !workerConnectionChannel.value) {
    return 0;
  }

  try {
    logConnectionLifecycleDebug('web.qr_history_recovery.start', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value ?? undefined,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: connectionAttemptId.value,
      reason,
    });
    const processed = await fetchRecentHistoryAndProcess(
      workerConnectionChannel.value,
      handleWorkerConnectionMessage,
      QR_HISTORY_RECOVERY_LIMIT,
      { commitCursor: false }
    );
    logConnectionLifecycleDebug('web.qr_history_recovery.done', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value ?? undefined,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: connectionAttemptId.value,
      reason,
      processed,
    });

    return processed;
  } catch (error) {
    logConnectionLifecycleDebug('web.qr_history_recovery.error', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value ?? undefined,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: connectionAttemptId.value,
      reason,
      error,
    });
    return 0;
  }
}

function scheduleQrHistoryRecovery(reason = 'pending_ack') {
  const attemptId = connectionAttemptId.value;

  if (!canRecoverQrFromRecentHistory()) {
    return;
  }

  if (!attemptId || qrHistoryRecoveryAttemptId === attemptId) {
    return;
  }

  clearQrHistoryRecovery();
  qrHistoryRecoveryAttemptId = attemptId;
  logConnectionLifecycleDebug('web.qr_history_recovery.scheduled', {
    trace_id: activeDebugTraceId.value,
    layer: 'web',
    worker_id: channelId.value ?? undefined,
    account_id: accountId.value ?? undefined,
    connection_attempt_id: attemptId,
    reason,
  });

  const finalDelayMs =
    QR_HISTORY_RECOVERY_DELAYS_MS[QR_HISTORY_RECOVERY_DELAYS_MS.length - 1];
  for (const delayMs of QR_HISTORY_RECOVERY_DELAYS_MS) {
    const timeoutId = window.setTimeout(() => {
      qrHistoryRecoveryTimeouts.delete(timeoutId);

      if (!canRecoverQrFromRecentHistory()) {
        return;
      }

      void (async () => {
        const recoveryReason = `${reason}:${delayMs}ms`;
        await recoverQrFromRecentHistory(recoveryReason);

        if (
          !qrcode.value &&
          delayMs === finalDelayMs &&
          canRecoverQrFromRecentHistory()
        ) {
          restoreModalAfterRejectedQrRequest();
        }
      })().catch((error) => {});
    }, delayMs);

    qrHistoryRecoveryTimeouts.add(timeoutId);
  }
}

function startNextAttemptCountdown() {
  clearNextAttemptCountdown();

  intervalIdNextAttempt.value = (
    globalThis as Window & typeof globalThis
  ).setInterval(() => {
    if (secondsNextAttempt.value > 0) {
      secondsNextAttempt.value--;
      return;
    }

    clearNextAttemptCountdown();
  }, 1000);
}

function prepareConnectionStart(
  options: { awaitingQr?: boolean; preserveQr?: boolean } = {}
) {
  clearQrHistoryRecovery();

  const shouldPreserveQr = options.preserveQr === true && Boolean(qrcode.value);
  const currentQrCode = qrcode.value;
  const currentConnectionAttemptId = connectionAttemptId.value;
  const currentRuntimeGeneration = connectionRuntimeGeneration.value;
  const currentQrPending = qrPending.value;
  const currentQrAttempt = qrAttempt.value;
  const currentQrMaxAttempts = qrMaxAttempts.value;
  const isAwaitingQr = options.awaitingQr === true;

  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = isAwaitingQr
    ? ECodeMessage.awaitingReadQrCode
    : ECodeMessage.awaitConnection;
  qrcode.value = shouldPreserveQr ? currentQrCode : undefined;
  connectionAttemptId.value = shouldPreserveQr
    ? currentConnectionAttemptId
    : undefined;
  connectionRuntimeGeneration.value = shouldPreserveQr
    ? currentRuntimeGeneration
    : undefined;
  // Selecting the QR method is enough to present the pre-read QR stage. It is
  // not evidence that the credential was consumed or that pairing started.
  qrPending.value = shouldPreserveQr ? currentQrPending : isAwaitingQr;
  sessionReady.value = false;
  nativeConnectionOnlineAcknowledged.value = false;
  if (shouldPreserveQr) {
    qrAttempt.value = currentQrAttempt;
    qrMaxAttempts.value = currentQrMaxAttempts;
  } else {
    resetQrAttempts();
  }
  disconnectedByUser.value = false;
  phoneNumber.value = null;
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  resetPasskeyState();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function applyInitialNativeStatusProjection(): boolean {
  const snapshot = nativeConnectionStatus.value;
  if (!snapshot) return false;

  if (props.initialStatusId === EWorkerStatus.disponible) {
    // A persisted AVAILABLE worker is ready for a new method selection. Its
    // last native client may legitimately have ended as `client_destroyed`,
    // but that diagnostic cannot open the modal in a disconnected state.
    resetNativeConnectionStatus();
    prepareConnectionStart();
    return true;
  }

  const centrallyAcknowledgedOnline =
    props.initialStatusId === EWorkerStatus.online &&
    props.initialConnectionOnlineAcknowledged === true &&
    isWhatsappConnectionOnline(snapshot) &&
    Boolean(props.initialPhone?.trim());
  const projected = applyWhatsappConnectionStatus(
    {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: channelId.value ?? '',
      account_id: accountId.value ?? '',
      worker_type_id: activeWorkerTypeId.value as EWorkerType | undefined,
      worker_status_id: props.initialStatusId as EWorkerStatus | undefined,
      phone: props.initialPhone ?? undefined,
      session_ready: centrallyAcknowledgedOnline,
      can_send: centrallyAcknowledgedOnline,
      can_receive_runtime: centrallyAcknowledgedOnline,
      authenticated: centrallyAcknowledgedOnline,
      connection_online_acknowledged: centrallyAcknowledgedOnline,
      connection_status_source_id:
        nativeConnectionStatusSourceId.value ?? undefined,
      connection_status_order: nativeConnectionStatusOrder.value,
    },
    snapshot
  );

  statusConnection.value =
    projected.status ?? EBaileysConnectionStatus.connecting;
  statusCode.value = projected.code ?? ECodeMessage.awaitConnection;
  sessionReady.value = centrallyAcknowledgedOnline;
  disconnectedByUser.value = projected.disconnected_user === true;
  qrPending.value = projected.qr_pending === true;
  if (snapshot.status !== EWhatsappConnectionStatus.qr) {
    qrcode.value = undefined;
    clearQrHistoryRecovery();
  }
  phoneNumber.value = props.initialPhone
    ? formatPhoneBR(props.initialPhone)
    : null;
  return true;
}

function applyAuthoritativeInitialOnlineProjection(): boolean {
  const snapshot = nativeConnectionStatus.value;
  const phone = props.initialPhone?.trim();
  const centrallyAcknowledgedOnline =
    props.initialStatusId === EWorkerStatus.online &&
    props.initialConnectionOnlineAcknowledged === true &&
    Boolean(phone) &&
    isWhatsappConnectionOnline(snapshot);
  if (!snapshot || !centrallyAcknowledgedOnline) {
    return false;
  }

  nativeConnectionOnlineAcknowledged.value = true;
  applyConnectedState({
    status: EBaileysConnectionStatus.connected,
    code: ECodeMessage.connectionEstablished,
    worker_id: channelId.value ?? '',
    account_id: accountId.value ?? '',
    worker_type_id: activeWorkerTypeId.value as EWorkerType | undefined,
    worker_status_id: EWorkerStatus.online,
    phone,
    session_ready: true,
    can_send: true,
    can_receive_runtime: true,
    authenticated: true,
    provider_state: snapshot.status,
    connection_attempt_id: connectionAttemptId.value,
    runtime_generation: connectionRuntimeGeneration.value,
    connection_status: snapshot,
    connection_status_source_id:
      nativeConnectionStatusSourceId.value ?? undefined,
    connection_status_order: nativeConnectionStatusOrder.value,
    connection_online_acknowledged: true,
  });
  logConnectionLifecycleDebug(
    'web.connection_modal.authoritative_projection_applied',
    {
      trace_id: activeDebugTraceId.value,
      layer: 'web.connection_modal',
      worker_id: channelId.value ?? undefined,
      account_id: accountId.value ?? undefined,
      worker_type_id: activeWorkerTypeId.value ?? undefined,
      connection_attempt_id: connectionAttemptId.value,
      runtime_generation: connectionRuntimeGeneration.value,
      connection_status_order: nativeConnectionStatusOrder.value,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
    }
  );
  return true;
}

function prepareInitialModalState() {
  workerStatusId.value = props.initialStatusId ?? null;

  if (canonicalPresentationSnapshot.value) {
    synchronizeModalWithCanonicalSnapshot(canonicalPresentationSnapshot.value);
    return;
  }

  if (applyAuthoritativeInitialOnlineProjection()) {
    return;
  }

  prepareConnectionStart();
  applyInitialNativeStatusProjection();
}

function prepareConnectionAfterCompletedReset(
  statusId: string | null | undefined
) {
  if (statusId === EWorkerStatus.disponible) {
    if (hasExhaustedQrAttemptOverlay()) {
      // The fifth credential expired and the provider published the terminal
      // attempt (6/5). AVAILABLE remains the durable worker truth, but a
      // passive list/status refresh must keep the restart affordance visible.
      workerStatusId.value = EWorkerStatus.disponible;
      isResetting.value = false;
      statusConnection.value = EBaileysConnectionStatus.disconnected;
      statusCode.value = ECodeMessage.connectionClosed;
      sessionReady.value = false;
      disconnectedByUser.value = false;
      nativeConnectionOnlineAcknowledged.value = false;
      return;
    }

    if (hasActiveQrAttemptOverlay()) {
      // The list can move from a stale `offline` projection to the durable
      // `disponible` truth after the manager has already accepted this QR
      // attempt. That prop reconciliation is not a terminal event and must
      // not erase the attempt before the provider publishes its first QR.
      workerStatusId.value = EWorkerStatus.disponible;
      isResetting.value = false;
      sessionReady.value = false;
      disconnectedByUser.value = false;
      logConnectionLifecycleDebug(
        'web.connection_modal.available_projection_preserved',
        {
          trace_id: activeDebugTraceId.value,
          layer: 'web',
          worker_id: channelId.value ?? undefined,
          account_id: accountId.value ?? undefined,
          connection_attempt_id: connectionAttemptId.value,
        }
      );
      return;
    }

    logConnectionLifecycleDebug(
      'web.connection_modal.available_projection_applied',
      {
        trace_id: activeDebugTraceId.value,
        layer: 'web',
        worker_id: channelId.value ?? undefined,
        account_id: accountId.value ?? undefined,
        connection_attempt_id: connectionAttemptId.value,
      }
    );
    isResetting.value = false;
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitConnection;
    sessionReady.value = false;
    disconnectedByUser.value = false;
    nativeConnectionOnlineAcknowledged.value = false;
    resetNativeConnectionStatus();
  }
}

function restoreModalAfterRejectedQrRequest(): void {
  logConnectionLifecycleDebug('web.connection_modal.qr_rejection_restored', {
    trace_id: activeDebugTraceId.value,
    layer: 'web',
    worker_id: channelId.value ?? undefined,
    account_id: accountId.value ?? undefined,
    connection_attempt_id: connectionAttemptId.value,
  });
  qrPending.value = false;
  qrcode.value = undefined;
  connectionAttemptId.value = undefined;
  resetQrAttempts();
  clearQrHistoryRecovery();

  const snapshot = canonicalPresentationSnapshot.value;
  if (snapshot) {
    synchronizeModalWithCanonicalSnapshot(snapshot);
  }

  // A rejected request is not an attempt-scoped terminal publication. Return
  // to the connection method chooser and let the operator start a fresh
  // request; "Canal desconectado" and "Reiniciar QR Code" are reserved for an
  // explicitly correlated terminal after the provider exhausts the attempt.
  returnToConnectionMethodSelection();
  if (!snapshot) {
    resetNativeConnectionStatus();
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitConnection;
    sessionReady.value = false;
  }
}

function releaseQrAttemptOnClose(): void {
  if (!isQrConnectionSelected.value) {
    return;
  }

  // A QR is short lived and the component may also be kept mounted by another
  // caller. Always discard the local credential/attempt on close. Reopening
  // then asks the manager for the current cached credential or a new attempt;
  // it never reuses an expired bitmap or a local pending flag.
  qrRequestGeneration += 1;
  isRequestingQr.value = false;
  qrcode.value = undefined;
  qrPending.value = false;
  connectionAttemptId.value = undefined;
  pairingStartedAt.value = null;
  resetQrAttempts();
  resetPairingCodes();
  resetPasskeyState();
  clearQrHistoryRecovery();
}

async function requestQrCodeIfReady(
  options: { force?: boolean; preserveQr?: boolean; silent?: boolean } = {}
) {
  if (!canOfferNewConnection.value || !channelId.value) return;

  if (
    selectedConnectionMethod.value !== 'qrcode' ||
    !isVisible.value ||
    !isWorkerReadyForQr.value ||
    isConnected.value ||
    secureConnectionLifecycleFence.value ||
    isBlockingOperation.value ||
    isRequestingQr.value
  ) {
    logConnectionLifecycleDebug('web.qr_request_modal.blocked', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value,
      account_id: accountId.value ?? undefined,
      reason: 'request_precondition',
      selected_method: selectedConnectionMethod.value,
      visible: isVisible.value,
      worker_status_id: workerStatusId.value ?? undefined,
      connected: isConnected.value,
      secure_connection_lifecycle_fenced: secureConnectionLifecycleFence.value,
      blocking_operation: isBlockingOperation.value,
      requesting_qr: isRequestingQr.value,
    });
    return;
  }

  if (!options.force && qrPending.value && Boolean(connectionAttemptId.value)) {
    return;
  }

  if (!options.force && hasActiveConnectionCode.value) {
    return;
  }

  isRequestingQr.value = true;
  const requestGeneration = ++qrRequestGeneration;
  const requestedWorkerId = channelId.value;
  const debugTraceId = ensureDebugTraceId('web_qr_request_modal');
  logConnectionLifecycleDebug('web.qr_request_modal.start', {
    trace_id: debugTraceId,
    layer: 'web',
    worker_id: channelId.value,
    account_id: accountId.value ?? undefined,
    worker_type_id: activeWorkerTypeId.value ?? channelType.value ?? undefined,
    force: options.force === true,
    preserve_qr: options.preserveQr === true,
    silent: options.silent === true,
  });
  prepareConnectionStart({
    awaitingQr: true,
    preserveQr: options.preserveQr,
  });

  try {
    const state = await channelStore.requestConnectionQrCode(
      requestedWorkerId,
      {
        silent: options.silent,
        timeoutMs: QR_REQUEST_TIMEOUT_MS,
        debugTraceId,
      }
    );
    if (
      requestGeneration !== qrRequestGeneration ||
      !isVisible.value ||
      channelId.value !== requestedWorkerId ||
      !isQrConnectionSelected.value
    ) {
      return;
    }
    if (!state) {
      // The optimistic pre-read stage must never outlive a rejected request.
      // Reapply the canonical DB/realtime projection and return to the method
      // chooser. A 409/503 (or a lost response) is not proof that the current
      // provider attempt reached its terminal boundary.
      restoreModalAfterRejectedQrRequest();
      return;
    }

    if (!isAcceptedQrAttemptResponse(state)) {
      applyDirectConnectionResponse(state);
      restoreModalAfterRejectedQrRequest();
      return;
    }

    if (canOfferNewConnection.value) {
      // Release a previous session-removal presentation fence only after the
      // manager accepted the new attempt. A rejected request must not make
      // subsequent stale runtime publications look like a new connection.
      emitConnectionStarted();
      activeDebugTraceId.value = state.debug_trace_id ?? debugTraceId;
      applyDirectConnectionResponse(state);

      if (!qrcode.value && state.qr_pending === true) {
        scheduleQrHistoryRecovery('request_qrcode_pending');
      }
    }
  } finally {
    logConnectionLifecycleDebug('web.qr_request_modal.finish', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: connectionAttemptId.value,
      runtime_generation: connectionRuntimeGeneration.value,
      has_qr: Boolean(qrcode.value),
      qr_pending: qrPending.value,
    });
    if (requestGeneration === qrRequestGeneration) {
      isRequestingQr.value = false;
    }
  }
}

async function reconnectChannel() {
  await requestQrCodeIfReady({ force: true, preserveQr: false });
}

async function restartQrCodeAttempt() {
  // A disconnected provider does not require a new container. Reopen the QR
  // attempt on the current fenced runtime and release only the session-removal
  // presentation fence once this new attempt is explicitly requested.
  selectedConnectionMethod.value = 'qrcode';
  await Promise.all([loadExternalConnectionLink(), reconnectChannel()]);
}

async function continuePasskeyPairing() {
  if (
    !canOfferNewConnection.value ||
    !channelId.value ||
    !passkeyPublicKey.value
  ) {
    return;
  }

  passkeyError.value = null;

  if (!globalThis.isSecureContext) {
    passkeyError.value = 'passkey_secure_context_required';
    return;
  }

  if (
    !globalThis.navigator?.credentials?.get ||
    typeof globalThis.PublicKeyCredential === 'undefined'
  ) {
    passkeyError.value = 'passkey_browser_unsupported';
    return;
  }

  isPasskeyRunning.value = true;
  const debugTraceId = ensureDebugTraceId('web_passkey_modal');

  try {
    const publicKey = parsePasskeyRequestOptions(passkeyPublicKey.value);
    const credential = (await navigator.credentials.get({
      publicKey,
    })) as (PublicKeyCredential & { toJSON?: () => unknown }) | null;

    if (!credential) {
      passkeyError.value = 'passkey_cancelled';
      return;
    }

    const passkeyResponse = serializePasskeyCredential(credential);

    const state = await channelStore.sendConnectionPasskeyResponse(
      channelId.value,
      {
        connection_attempt_id: connectionAttemptId.value,
        passkey_response: passkeyResponse,
      },
      {
        silent: true,
        debugTraceId,
      }
    );

    if (!canOfferNewConnection.value) {
      return;
    }

    if (!state) {
      passkeyError.value = 'passkey_failed';
      return;
    }

    applyDirectConnectionResponse(state);
  } catch (error) {
    passkeyError.value =
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'passkey_cancelled'
        : 'passkey_failed';
  } finally {
    isPasskeyRunning.value = false;
  }
}

async function confirmPasskeyPairing() {
  if (!canOfferNewConnection.value || !channelId.value) {
    return;
  }

  isPasskeyConfirming.value = true;
  const state = await channelStore.confirmConnectionPasskey(
    channelId.value,
    {
      connection_attempt_id: connectionAttemptId.value,
    },
    {
      silent: true,
      debugTraceId: activeDebugTraceId.value,
    }
  );

  if (canOfferNewConnection.value && state) {
    applyDirectConnectionResponse(state);
  }

  isPasskeyConfirming.value = false;
}

async function disconnectChannelSession(): Promise<void> {
  if (
    !canOfferNewConnection.value ||
    !channelId.value ||
    !isConnected.value ||
    isRemovingSession.value
  ) {
    return;
  }

  isRemovingSession.value = true;
  suspendConnectionOfferSideEffects();
  const debugTraceId = ensureDebugTraceId('web_disconnect_connection_modal');
  logConnectionLifecycleDebug('web.connection_disconnect.submit', {
    trace_id: debugTraceId,
    layer: 'web',
    worker_id: channelId.value,
    account_id: accountId.value ?? undefined,
  });

  const result = await channelStore.disconnectConnectionChannel(
    channelId.value,
    { debugTraceId }
  );
  if (!result) {
    isRemovingSession.value = false;
    if (isVisible.value) {
      void loadExternalConnectionLink();
    }
    return;
  }

  releaseSecureConnectionLifecycleFence();
  workerStatusId.value = EWorkerStatus.disponible;
  statusConnection.value = EBaileysConnectionStatus.disconnected;
  statusCode.value = ECodeMessage.connectionClosed;
  disconnectedByUser.value = true;
  connectionStartedEmitted.value = false;
  sessionReady.value = false;
  phoneNumber.value = null;
  isResetting.value = false;
  connectionRuntimeGeneration.value = result.runtime_generation;
  resetNativeConnectionStatus();
  nativeConnectionOnlineAcknowledged.value = false;
  logConnectionLifecycleDebug('web.connection_disconnect.completed', {
    trace_id: result.debug_trace_id ?? debugTraceId,
    layer: 'web',
    worker_id: result.worker_id,
    account_id: accountId.value ?? undefined,
    runtime_generation: result.runtime_generation,
    status: 'session_removed',
  });
  emit('sessionRemoved', result);
}

function scheduleConnectedState(data: IBaileysConnectionState) {
  // The central/native readiness envelope is already the fail-closed proof of
  // connection. Delaying it for presentation left the QR authoritative in the
  // modal while the channel list was already connected, and allowed a queued
  // QR recovery callback to cancel the pending terminal state.
  applyConnectedState(data);
}

function applyConnectedState(data: IBaileysConnectionState) {
  if (
    data.connection_online_acknowledged !== true ||
    !isWhatsappConnectionOnline(data.connection_status)
  ) {
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitConnection;
    sessionReady.value = false;
    return;
  }
  logLocalConnectionStatus('web.connection_modal.connected_applied', {
    layer: 'web.connection_modal',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id ?? activeWorkerTypeId.value,
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
  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  phoneNumber.value = data.phone ? formatPhoneBR(data.phone) : null;
  sessionReady.value = true;
  disconnectedByUser.value = false;
  workerStatusId.value = EWorkerStatus.online;
  isRequestingQr.value = false;
  qrcode.value = undefined;
  qrPending.value = false;
  externalConnectionUrl.value = '';
  externalConnectionExpiresAt.value = null;
  connectionAttemptId.value =
    data.connection_attempt_id ?? connectionAttemptId.value;
  connectionRuntimeGeneration.value =
    data.runtime_generation ?? connectionRuntimeGeneration.value;
  resetQrAttempts();
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  resetPasskeyState();
  clearQrHistoryRecovery();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function clearCanonicalConnectionArtifacts(): void {
  qrcode.value = undefined;
  qrPending.value = false;
  connectionAttemptId.value = undefined;
  isRequestingQr.value = false;
  phoneNumber.value = null;
  pairingStartedAt.value = null;
  resetQrAttempts();
  resetPairingCodes();
  resetPasskeyState();
  clearQrHistoryRecovery();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function applyCanonicalDisconnectedProjection(
  snapshot: ChannelStatusPresentationSnapshot,
  sessionRemoved: boolean
): void {
  logConnectionLifecycleDebug(
    'web.connection_modal.canonical_disconnect_applied',
    {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value ?? undefined,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: connectionAttemptId.value,
      runtime_generation: snapshot.runtimeGeneration ?? undefined,
      worker_status_id: snapshot.workerStatusId,
      source: snapshot.source,
      session_removed: sessionRemoved,
    }
  );
  workerStatusId.value = snapshot.workerStatusId;
  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.disconnected;
  statusCode.value = ECodeMessage.connectionClosed;
  sessionReady.value = false;
  disconnectedByUser.value = sessionRemoved;
  if (sessionRemoved) {
    connectionStartedEmitted.value = false;
    releaseSecureConnectionLifecycleFence();
  }
  nativeConnectionOnlineAcknowledged.value = false;
  resetNativeConnectionStatus();
  clearCanonicalConnectionArtifacts();
}

function restoreExhaustedQrAttemptTerminal(
  event: IBaileysConnectionState,
  maxAttempts: number
): void {
  qrMaxAttempts.value = maxAttempts;
  qrAttempt.value = maxAttempts + 1;
  connectionAttemptId.value = event.connection_attempt_id;
  connectionRuntimeGeneration.value =
    event.runtime_generation ?? connectionRuntimeGeneration.value;
  statusConnection.value = EBaileysConnectionStatus.disconnected;
  statusCode.value = ECodeMessage.connectionClosed;
  qrcode.value = undefined;
  qrPending.value = false;
  isRequestingQr.value = false;
}

function applyCanonicalConnectedProjection(
  snapshot: ChannelStatusPresentationSnapshot,
  event?: IBaileysConnectionState
): void {
  if (!isWhatsappConnectionOnline(nativeConnectionStatus.value)) {
    // A lifecycle completion can carry the durable ONLINE acknowledgement
    // without repeating the provider envelope. The canonical snapshot is the
    // authority in that case; an older local QR/offline envelope must not win.
    resetNativeConnectionStatus();
  }
  workerStatusId.value = EWorkerStatus.online;
  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  sessionReady.value = true;
  disconnectedByUser.value = false;
  nativeConnectionOnlineAcknowledged.value = true;
  connectionRuntimeGeneration.value = snapshot.runtimeGeneration ?? undefined;
  const phone = event?.phone?.trim() || props.initialPhone?.trim();
  if (phone) {
    phoneNumber.value = formatPhoneBR(phone);
  }
  qrcode.value = undefined;
  qrPending.value = false;
  externalConnectionUrl.value = '';
  externalConnectionExpiresAt.value = null;
  isRequestingQr.value = false;
  resetQrAttempts();
  resetPairingCodes();
  resetPasskeyState();
  clearQrHistoryRecovery();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function hasActiveQrAttemptOverlay(): boolean {
  return isQrAttemptActive.value;
}

function shouldPreserveActiveQrAttemptOverlay(
  event?: IBaileysConnectionState
): boolean {
  return Boolean(
    hasActiveQrAttemptOverlay() &&
    (!event || !isCurrentQrAttemptTerminalPublication(event))
  );
}

function isQrAttemptTerminalPublication(
  data: Partial<IBaileysConnectionState>
): boolean {
  return Boolean(
    data.status === EBaileysConnectionStatus.disconnected ||
    hasExceededQrAttempts(data) ||
    (data.worker_status_id !== undefined &&
      QR_ATTEMPT_TERMINAL_WORKER_STATUSES.has(data.worker_status_id)) ||
    (data.connection_status?.status !== undefined &&
      QR_ATTEMPT_TERMINAL_NATIVE_STATUSES.has(data.connection_status.status) &&
      !isCurrentQrAttemptProgressPublication(data)) ||
    (data.event_type === 'status' &&
      data.session_removed === true &&
      data.disconnected_user === true)
  );
}

function isCurrentQrAttemptTerminalPublication(
  data: Partial<IBaileysConnectionState>
): boolean {
  return Boolean(
    connectionAttemptId.value &&
    data.connection_attempt_id === connectionAttemptId.value &&
    isQrAttemptTerminalPublication(data)
  );
}

function shouldIgnoreQrTerminalFromAnotherAttempt(
  data: Partial<IBaileysConnectionState>
): boolean {
  return Boolean(
    hasActiveQrAttemptOverlay() &&
    isQrAttemptTerminalPublication(data) &&
    !isCurrentQrAttemptTerminalPublication(data)
  );
}

function applyCanonicalAvailableProjection(
  snapshot: ChannelStatusPresentationSnapshot
): void {
  workerStatusId.value = EWorkerStatus.disponible;
  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
  sessionReady.value = false;
  disconnectedByUser.value = false;
  nativeConnectionOnlineAcknowledged.value = false;
  resetNativeConnectionStatus();
  clearCanonicalConnectionArtifacts();
  connectionRuntimeGeneration.value =
    snapshot.runtimeGeneration ?? connectionRuntimeGeneration.value;
}

/**
 * Status copy, row badge and header badge all derive from this snapshot. The
 * modal keeps QR/passkey payloads locally, but never owns lifecycle ordering
 * or the final customer-facing connection state.
 */
function synchronizeModalWithCanonicalSnapshot(
  snapshot: ChannelStatusPresentationSnapshot,
  event?: IBaileysConnectionState
): void {
  if (!channelId.value || snapshot.workerId !== channelId.value) return;

  const projectsInitialCreation =
    props.isInitialCreation === true &&
    props.initialStatusId === EWorkerStatus.creating &&
    (snapshot.workerStatusId === EWorkerStatus.creating ||
      snapshot.workerStatusId === EWorkerStatus.recreating);
  const modalWorkerStatusId = projectsInitialCreation
    ? EWorkerStatus.creating
    : snapshot.workerStatusId;

  workerStatusId.value = modalWorkerStatusId;
  activeWorkerTypeId.value = snapshot.workerTypeId ?? activeWorkerTypeId.value;
  connectionRuntimeGeneration.value =
    snapshot.runtimeGeneration ?? connectionRuntimeGeneration.value;
  nativeConnectionOnlineAcknowledged.value =
    snapshot.connectionOnlineAcknowledged === true;

  const display = projectWhatsappChannelDisplayStatus({
    workerTypeId: snapshot.workerTypeId,
    workerStatusId: modalWorkerStatusId,
    recreatePhase: projectsInitialCreation ? null : snapshot.recreatePhase,
    connectionStatus: snapshot.connectionStatus,
    connectionOnlineAcknowledged: snapshot.connectionOnlineAcknowledged,
  });

  if (display.kind === 'worker') {
    if (display.workerStatusId === EWorkerStatus.creating) {
      isResetting.value = false;
      statusConnection.value = EBaileysConnectionStatus.connecting;
      statusCode.value = ECodeMessage.awaitConnection;
      sessionReady.value = false;
      disconnectedByUser.value = false;
      nativeConnectionOnlineAcknowledged.value = false;
      return;
    }

    if (display.workerStatusId === EWorkerStatus.recreating) {
      isResetting.value = props.isSessionMigration !== true;
      statusConnection.value = EBaileysConnectionStatus.connecting;
      statusCode.value = ECodeMessage.awaitConnection;
      sessionReady.value = false;
      disconnectedByUser.value = false;
      nativeConnectionOnlineAcknowledged.value = false;
      resetNativeConnectionStatus();
      clearCanonicalConnectionArtifacts();
      return;
    }

    if (display.workerStatusId === EWorkerStatus.disponible) {
      const sessionRemoved = event
        ? isSessionRemovalTerminalPublication(event)
        : snapshot.source === 'session_removal_ack' &&
          !connectionStartedEmitted.value;
      const currentAttemptTerminal = event
        ? isCurrentQrAttemptTerminalPublication(event)
        : false;
      const exhaustedQrMaxAttempts =
        currentAttemptTerminal &&
        qrMaxAttempts.value > 0 &&
        qrAttempt.value >= qrMaxAttempts.value
          ? qrMaxAttempts.value
          : undefined;
      if (hasExhaustedQrAttemptOverlay() && !event) {
        // Preserve the terminal UX produced after the fifth QR expires. The
        // DB correctly stays AVAILABLE so the user can start another attempt;
        // it is not a command to erase the current modal's restart state.
        isResetting.value = false;
        statusConnection.value = EBaileysConnectionStatus.disconnected;
        statusCode.value = ECodeMessage.connectionClosed;
        sessionReady.value = false;
        disconnectedByUser.value = false;
        nativeConnectionOnlineAcknowledged.value = false;
        return;
      }
      if (shouldPreserveActiveQrAttemptOverlay(event)) {
        // `disponible` is the durable DB truth while an empty session waits
        // for a QR. It is compatible with the modal's attempt-scoped payload
        // and must not erase an accepted pending ACK/QR during a list refresh
        // or because the previous internal client published a late terminal.
        isResetting.value = false;
        sessionReady.value = false;
        disconnectedByUser.value = false;
        nativeConnectionOnlineAcknowledged.value = false;
        return;
      }
      if (sessionRemoved || currentAttemptTerminal) {
        applyCanonicalDisconnectedProjection(snapshot, sessionRemoved);
        if (event && exhaustedQrMaxAttempts !== undefined) {
          // The central worker-status projection intentionally carries only
          // the lifecycle terminal. The modal already observed 5/5 on this
          // exact attempt, so restore 6/5 locally and keep Restart visible.
          restoreExhaustedQrAttemptTerminal(event, exhaustedQrMaxAttempts);
        }
        return;
      }
      applyCanonicalAvailableProjection(snapshot);
      return;
    }

    if (display.workerStatusId === EWorkerStatus.connecting) {
      isResetting.value = false;
      statusConnection.value = EBaileysConnectionStatus.connecting;
      statusCode.value = ECodeMessage.pairingInProgress;
      qrPending.value = false;
      sessionReady.value = false;
      disconnectedByUser.value = false;
      nativeConnectionOnlineAcknowledged.value = false;
      return;
    }

    if (
      display.workerStatusId === EWorkerStatus.offline ||
      display.workerStatusId === EWorkerStatus.error ||
      display.workerStatusId === EWorkerStatus.mismatched
    ) {
      if (shouldPreserveActiveQrAttemptOverlay(event)) {
        // These durable states can legitimately start a fresh connection.
        // A list refresh must not replace an accepted attempt-scoped pending
        // ACK/QR with the older disconnected projection underneath it.
        isResetting.value = false;
        sessionReady.value = false;
        disconnectedByUser.value = false;
        nativeConnectionOnlineAcknowledged.value = false;
        return;
      }
      applyCanonicalDisconnectedProjection(snapshot, false);
      return;
    }

    if (
      display.workerStatusId === EWorkerStatus.stopped ||
      display.workerStatusId === EWorkerStatus.blocked ||
      display.workerStatusId === EWorkerStatus.deleting ||
      display.workerStatusId === EWorkerStatus.delete
    ) {
      applyCanonicalDisconnectedProjection(snapshot, false);
      return;
    }

    if (display.workerStatusId === EWorkerStatus.online) {
      applyCanonicalConnectedProjection(snapshot, event);
      return;
    }

    return;
  }

  if (display.connectionStatus === 'online') {
    applyCanonicalConnectedProjection(snapshot, event);
    return;
  }

  if (
    display.connectionStatus === 'offline' ||
    display.connectionStatus === 'reconnect_required' ||
    display.connectionStatus === 'error'
  ) {
    if (
      display.connectionStatus !== 'error' &&
      shouldPreserveActiveQrAttemptOverlay(event)
    ) {
      // A canonical-store refresh can still expose the provider's last
      // terminal checkpoint while the new attempt is bootstrapping. Preserve
      // the attempt both for passive refreshes and for non-terminal events
      // fenced to its exact connection_attempt_id. A terminal publication is
      // deliberately not attempt-scoped and still replaces the overlay.
      isResetting.value = false;
      sessionReady.value = false;
      disconnectedByUser.value = false;
      nativeConnectionOnlineAcknowledged.value = false;
      return;
    }
    applyCanonicalDisconnectedProjection(snapshot, false);
    return;
  }

  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  sessionReady.value = false;
  disconnectedByUser.value = false;
  nativeConnectionOnlineAcknowledged.value = false;

  if (display.connectionStatus === 'qr') {
    if (nativeConnectionStatus.value?.status !== EWhatsappConnectionStatus.qr) {
      resetNativeConnectionStatus();
    }
    statusCode.value = ECodeMessage.awaitingReadQrCode;
    qrPending.value = !qrcode.value;
    return;
  }

  if (
    statusCode.value === ECodeMessage.connectionEstablished ||
    statusCode.value === ECodeMessage.logoutInProgress ||
    statusCode.value === ECodeMessage.connectionClosed
  ) {
    statusCode.value = ECodeMessage.awaitConnection;
  }
}

function shouldIgnorePhoneUnavailableState(
  data: IBaileysConnectionState
): boolean {
  const incomingStatus = data.status as EBaileysConnectionStatus | undefined;
  const incomingCode = data.code as ECodeMessage | undefined;
  const isIncomingConnected =
    incomingStatus === EBaileysConnectionStatus.connected ||
    incomingCode === ECodeMessage.connectionEstablished;

  return (
    statusCode.value === ECodeMessage.phoneNotAvailable && !isIncomingConnected
  );
}

function shouldPreserveCurrentQrDuringAttemptProgress(
  data: Partial<IBaileysConnectionState>
): boolean {
  return Boolean(
    qrcode.value &&
    connectionAttemptId.value &&
    data.connection_attempt_id === connectionAttemptId.value &&
    isCurrentQrAttemptProgressPublication(data) &&
    !isWhatsappQrCredentialConsumedState(data)
  );
}

function applyReducedConnectionState(
  data: IBaileysConnectionState,
  options: { directResponse?: boolean } = {}
) {
  if (!channelId.value || data.worker_id !== channelId.value) {
    return;
  }

  if (shouldIgnoreConnectionPayloadIdentity(data, options)) {
    logConnectionLifecycleDebug('web.connection_state.identity_ignored', {
      trace_id: data.debug_trace_id ?? activeDebugTraceId.value,
      layer: 'web',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      status: data.status,
      code: data.code,
      reason: data.reason,
      qrcode: data.qrcode,
      pairing_code: data.pairing_code,
      has_passkey_public_key: Boolean(data.passkey_public_key),
      has_passkey_confirmation_code: Boolean(data.passkey_confirmation_code),
    });
    return;
  }

  const resolved = resolveIncomingConnectionStatus(data);
  if (!resolved) {
    logConnectionLifecycleDebug('web.connection_state.native_ignored', {
      trace_id: data.debug_trace_id ?? activeDebugTraceId.value,
      layer: 'web',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      status: data.status,
      code: data.code,
      reason: 'native_connection_status_invalid_or_stale',
    });
    return;
  }
  data = resolved.data;

  if (shouldIgnoreConnectionPayload(data, resolved.nativeResolution)) {
    logConnectionLifecycleDebug('web.connection_state.connected_ignored', {
      trace_id: data.debug_trace_id ?? activeDebugTraceId.value,
      layer: 'web',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      status: data.status,
      code: data.code,
      worker_status_id: data.worker_status_id,
      session_ready: data.session_ready,
      phone: data.phone,
      reason: data.reason,
    });
    return;
  }

  if (resolved.nativeResolution === 'none') {
    nativeConnectionOnlineAcknowledged.value = false;
  }

  const preserveCurrentQr = shouldPreserveCurrentQrDuringAttemptProgress(data);

  if (
    shouldClearConnectionModalQr({
      nativeResolution: resolved.nativeResolution,
      snapshot: data.connection_status,
      preserveCurrentQr,
    })
  ) {
    qrcode.value = undefined;
    qrPending.value = false;
    clearQrHistoryRecovery();
  }

  if (options.directResponse && shouldClearPasskeyForDirectResponse(data)) {
    resetPasskeyState();
  }

  activeDebugTraceId.value = data.debug_trace_id ?? activeDebugTraceId.value;

  if (data.worker_type_id) {
    activeWorkerTypeId.value = data.worker_type_id;
  }

  if (data.runtime_generation !== undefined) {
    connectionRuntimeGeneration.value = data.runtime_generation;
  }

  if (shouldIgnorePhoneUnavailableState(data)) {
    return;
  }

  const reduced = reduceWorkerConnectionState(connectionState.value, data, {
    authoritativeNativeTransition: resolved.nativeResolution === 'accepted',
    preserveQrDuringActiveAttempt: preserveCurrentQr,
  });
  if (reduced.ignored) {
    logConnectionLifecycleDebug('web.connection_state.reduced_ignored', {
      trace_id: data.debug_trace_id ?? activeDebugTraceId.value,
      layer: 'web',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      status: data.status,
      code: data.code,
      reason: data.reason,
    });
    return;
  }

  const next = reduced.state;

  if (data.worker_status_id === EWorkerStatus.recreating) {
    workerStatusId.value = EWorkerStatus.recreating;
    const isTargetNativeMigrationState =
      props.isSessionMigration === true &&
      data.connection_status?.status !== undefined &&
      data.connection_status.status !== EWhatsappConnectionStatus.handoff;

    if (!isTargetNativeMigrationState) {
      isResetting.value = props.isSessionMigration !== true;
      statusConnection.value = EBaileysConnectionStatus.connecting;
      statusCode.value = ECodeMessage.awaitConnection;
      qrcode.value = undefined;
      qrPending.value = false;
      connectionAttemptId.value = data.connection_attempt_id;
      connectionRuntimeGeneration.value = data.runtime_generation;
      pairingStartedAt.value = null;
      resetPairingCodes();
      resetPasskeyState();
      clearQrHistoryRecovery();
      clearConnectedStateDelay();
      return;
    }

    isResetting.value = false;
  }

  if (data.worker_status_id === EWorkerStatus.creating) {
    if (hasActiveConnectionCode.value || qrPending.value) {
      return;
    }

    workerStatusId.value = EWorkerStatus.creating;
    isResetting.value = false;
    prepareConnectionStart();
    return;
  }

  if (data.worker_status_id) {
    workerStatusId.value = data.worker_status_id;
    isResetting.value = false;
    prepareConnectionAfterCompletedReset(data.worker_status_id);
  }

  applyQrAttempts(next);

  const incomingStatus = data.status as EBaileysConnectionStatus | undefined;
  const incomingCode = data.code as ECodeMessage | undefined;
  const isConnectedEvent =
    incomingStatus === EBaileysConnectionStatus.connected ||
    incomingCode === ECodeMessage.connectionEstablished;

  if (isConnectedEvent) {
    scheduleConnectedState(data);
    return;
  }

  clearConnectedStateDelay();

  const qrCredentialConsumed = isWhatsappQrCredentialConsumedState(data);
  const keepAwaitingQrCredential =
    canOfferNewConnection.value &&
    isQrConnectionSelected.value &&
    pairingStartedAt.value === null &&
    isWhatsappQrCredentialPendingState(data);

  if (canOfferNewConnection.value && qrCredentialConsumed) {
    pairingStartedAt.value = Date.now();
    resetPasskeyState();
  }

  if (next.connection_attempt_id) {
    connectionAttemptId.value = next.connection_attempt_id;
  }

  if (next.runtime_generation !== undefined) {
    connectionRuntimeGeneration.value = next.runtime_generation;
  }

  qrPending.value = keepAwaitingQrCredential
    ? !qrcode.value
    : next.qr_pending === true;

  if (next.disconnected_user !== undefined) {
    disconnectedByUser.value = next.disconnected_user;
  }

  if (next.session_ready !== undefined) {
    sessionReady.value = next.session_ready === true;
  }

  if (next.worker_status_id && next.worker_status_id !== EWorkerStatus.online) {
    sessionReady.value = false;
  }

  if (!canOfferNewConnection.value) {
    qrcode.value = undefined;
    qrPending.value = false;
    isRequestingQr.value = false;
    resetPairingCodes();
    resetPasskeyState();
    clearQrHistoryRecovery();
  } else if (hasExceededQrAttempts(next)) {
    qrcode.value = undefined;
    resetPasskeyState();
    qrPending.value = false;
    isRequestingQr.value = false;
    clearQrHistoryRecovery();
  } else if (next.passkey_public_key) {
    void switchToSecureConnectionFromPasskeyRequirement();
    qrcode.value = undefined;
    resetPairingCodes();
    passkeyPublicKey.value = next.passkey_public_key;
    passkeyConfirmationPrimary.value = '';
    passkeyConfirmationSecondary.value = '';
    passkeyError.value = null;
    qrPending.value = false;
    isRequestingQr.value = false;
    clearQrHistoryRecovery();
  } else if (next.passkey_confirmation_code) {
    void switchToSecureConnectionFromPasskeyRequirement();
    qrcode.value = undefined;
    resetPairingCodes();
    passkeyPublicKey.value = undefined;
    const [primary, secondary] = splitCode(next.passkey_confirmation_code);
    passkeyConfirmationPrimary.value = primary;
    passkeyConfirmationSecondary.value = secondary;
    passkeyError.value = null;
    qrPending.value = false;
    isRequestingQr.value = false;
    clearQrHistoryRecovery();
  } else if (next.qrcode) {
    qrcode.value = next.qrcode;
    resetPasskeyState();
    isRequestingQr.value = false;
    clearQrHistoryRecovery();
  } else {
    qrcode.value = undefined;
    if (next.qr_pending === true && next.connection_attempt_id) {
      scheduleQrHistoryRecovery('stream_pending');
    }
  }

  if (incomingStatus === EBaileysConnectionStatus.disconnected) {
    isRequestingQr.value = false;
    resetPasskeyState();
    clearQrHistoryRecovery();
  }

  if (incomingStatus) {
    const isInfo = incomingStatus === EBaileysConnectionStatus.info;
    if (
      !isInfo ||
      statusConnection.value !== EBaileysConnectionStatus.connected
    ) {
      statusConnection.value = incomingStatus;
    }
  }

  if (incomingCode && incomingCode !== ECodeMessage.info) {
    statusCode.value = incomingCode;
  }

  if (keepAwaitingQrCredential) {
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitingReadQrCode;
    qrPending.value = !qrcode.value;
  }

  if (next.phone) {
    phoneNumber.value = formatPhoneBR(next.phone);
  }

  if (canOfferNewConnection.value && next.pairing_code) {
    const [primary, secondary] = splitCode(next.pairing_code);
    pairingCodePrimary.value = primary;
    pairingCodeSecondary.value = secondary;
    passkeyPublicKey.value = undefined;
    passkeyConfirmationPrimary.value = '';
    passkeyConfirmationSecondary.value = '';
    passkeyError.value = null;
  }

  if (canOfferNewConnection.value && next.seconds_until_next_attempt) {
    secondsNextAttempt.value = next.seconds_until_next_attempt;
    startNextAttemptCountdown();
  }

  logConnectionLifecycleDebug('web.connection_state.applied', {
    trace_id: activeDebugTraceId.value,
    layer: 'web',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    connection_attempt_id: connectionAttemptId.value,
    runtime_generation: connectionRuntimeGeneration.value,
    status: statusConnection.value,
    code: statusCode.value,
    reason: data.reason,
    qrcode: data.qrcode,
    pairing_code: data.pairing_code,
    has_passkey_public_key: Boolean(data.passkey_public_key),
    has_passkey_confirmation_code: Boolean(data.passkey_confirmation_code),
    qr_pending: qrPending.value,
    modal_state: modalState.value,
  });
}

function resolveIncomingConnectionStatus(data: IBaileysConnectionState):
  | {
      data: IBaileysConnectionState;
      nativeResolution: WhatsappConnectionStatusResolution;
    }
  | undefined {
  if (!data.connection_status) {
    const claimsOnline =
      data.worker_status_id === EWorkerStatus.online ||
      data.status === EBaileysConnectionStatus.connected ||
      data.code === ECodeMessage.connectionEstablished;
    if (claimsOnline) return undefined;
    return { data, nativeResolution: 'none' };
  }

  if (
    QR_ATTEMPT_TERMINAL_NATIVE_STATUSES.has(data.connection_status.status) &&
    isCurrentQrAttemptProgressPublication(data)
  ) {
    // Status envelopes can carry the last persisted native snapshot alongside
    // a newer attempt-scoped progress event. WhatsMeow exposes this race as
    // `pairingInProgress + native stopped/disconnected` for a few hundred
    // milliseconds before its new socket publishes `connecting/qr`. Keep the
    // progress event and wait for that ordered native transition.
    return {
      data: {
        ...data,
        connection_status: undefined,
        connection_status_source_id: undefined,
        connection_status_order: undefined,
      },
      nativeResolution: 'none',
    };
  }

  const acceptance = acceptNativeConnectionStatus({
    snapshot: data.connection_status,
    sourceId: data.connection_status_source_id,
    order: data.connection_status_order,
    expectedProvider: connectionStatusProvider(
      data.worker_type_id ?? activeWorkerTypeId.value
    ),
  });

  if (
    acceptance.outcome === 'stale' &&
    isCurrentQrAttemptProgressPublication(data)
  ) {
    // A QR rotation is attempt-scoped progress even when the provider has not
    // changed its native `qr` snapshot. WWebJS legitimately emits several
    // distinct credentials under the same native source/sequence while its
    // internal client is recycled. Ignore only the duplicate native evidence;
    // never discard the newer credential carried by the same envelope.
    return {
      data: {
        ...data,
        connection_status: undefined,
        connection_status_source_id: undefined,
        connection_status_order: undefined,
      },
      nativeResolution: 'none',
    };
  }

  if (
    !acceptance.snapshot ||
    acceptance.outcome === 'invalid' ||
    acceptance.outcome === 'stale'
  ) {
    return undefined;
  }
  nativeConnectionOnlineAcknowledged.value =
    data.connection_online_acknowledged === true &&
    isWhatsappConnectionOnline(acceptance.snapshot);
  return {
    data: applyWhatsappConnectionStatus(
      {
        ...data,
        connection_status_source_id: nativeConnectionStatusSourceId.value,
      },
      acceptance.snapshot
    ),
    nativeResolution: acceptance.outcome,
  };
}

function isCurrentQrAttemptProgressPublication(
  data: Partial<IBaileysConnectionState>
): boolean {
  if (
    !canOfferNewConnection.value ||
    !isQrConnectionSelected.value ||
    !data.connection_attempt_id
  ) {
    return false;
  }

  const currentAttemptId = connectionAttemptId.value;
  const ownsAttempt = currentAttemptId
    ? data.connection_attempt_id === currentAttemptId
    : isRequestingQr.value;
  if (!ownsAttempt) return false;

  if (
    data.status === EBaileysConnectionStatus.disconnected ||
    hasExceededQrAttempts(data) ||
    (data.worker_status_id !== undefined &&
      QR_ATTEMPT_TERMINAL_WORKER_STATUSES.has(data.worker_status_id)) ||
    (data.event_type === 'status' &&
      data.session_removed === true &&
      data.disconnected_user === true)
  ) {
    return false;
  }

  return Boolean(
    data.status === EBaileysConnectionStatus.connecting ||
    (data.code !== undefined && QR_ATTEMPT_PROGRESS_CODES.has(data.code)) ||
    data.qr_pending === true ||
    data.qrcode ||
    data.pairing_code ||
    data.passkey_public_key ||
    data.passkey_confirmation_code
  );
}

function isAttemptScopedConnectionPayload(
  data: Partial<IBaileysConnectionState>
): boolean {
  if (!data.connection_attempt_id) return false;

  const currentAttemptId = connectionAttemptId.value;
  if (currentAttemptId && data.connection_attempt_id !== currentAttemptId) {
    return false;
  }

  if (isQrAttemptTerminalPublication(data)) {
    // QR exhaustion deliberately does not mutate the durable worker status:
    // the runtime remains AVAILABLE for the next request. It is nevertheless
    // an authoritative terminal for this exact modal attempt and must reach
    // the local reducer so Restart becomes available without a page reload.
    return Boolean(currentAttemptId && isWhatsappQrAttemptExhaustedState(data));
  }

  return (
    data.connection_attempt_id === currentAttemptId ||
    data.qr_pending === true ||
    Boolean(data.qrcode) ||
    Boolean(data.pairing_code) ||
    Boolean(data.passkey_public_key) ||
    Boolean(data.passkey_confirmation_code) ||
    data.code === ECodeMessage.awaitingReadQrCode ||
    data.code === ECodeMessage.awaitingPairingCode ||
    data.code === ECodeMessage.awaitingPasskey ||
    data.code === ECodeMessage.awaitingPasskeyConfirmation ||
    data.code === ECodeMessage.pairingInProgress ||
    data.code === ECodeMessage.newLoginAttempt
  );
}

function isAcceptedQrAttemptResponse(data: IBaileysConnectionState): boolean {
  return Boolean(
    data.connection_attempt_id &&
    (data.qr_pending === true ||
      data.qrcode ||
      data.pairing_code ||
      data.passkey_public_key ||
      data.passkey_confirmation_code ||
      (data.connection_online_acknowledged === true &&
        isWhatsappConnectionOnline(data.connection_status)))
  );
}

function shouldProjectConnectionPublicationToCanonical(
  data: IBaileysConnectionState
): boolean {
  return Boolean(
    data.connection_status ||
    (data.event_type === 'status' && data.worker_status_id) ||
    data.worker_status_observed_at ||
    data.lifecycle_operation_id ||
    data.recreate_phase ||
    data.recreate_phase_observed_at ||
    data.recreate_completed_at ||
    isSessionRemovalTerminalPublication(data)
  );
}

function applyConnectionPublication(
  data: IBaileysConnectionState,
  options: { directResponse?: boolean } = {}
): boolean {
  const attemptScoped = isAttemptScopedConnectionPayload(data);
  const ignoredQrTerminal = shouldIgnoreQrTerminalFromAnotherAttempt(data);
  let presentationAccepted = false;
  if (shouldProjectConnectionPublicationToCanonical(data)) {
    presentationAccepted =
      channelStatusPresentationStore.applyRealtimeEvent(data);
  }

  const presentationSnapshot = channelStatusPresentationStore.snapshot(
    data.worker_id
  );
  const presentationObserved = Boolean(
    presentationSnapshot &&
    (presentationAccepted ||
      canonicalSnapshotIncludesPublication(presentationSnapshot, data))
  );
  if (!presentationObserved && !attemptScoped) {
    return false;
  }

  if (presentationObserved && presentationSnapshot) {
    synchronizeModalWithCanonicalSnapshot(presentationSnapshot, data);
  }

  if (ignoredQrTerminal) {
    logConnectionLifecycleDebug(
      'web.connection_state.previous_attempt_terminal_ignored',
      {
        trace_id: data.debug_trace_id ?? activeDebugTraceId.value,
        layer: 'web',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        connection_attempt_id: data.connection_attempt_id,
        expected_connection_attempt_id: connectionAttemptId.value,
        runtime_generation: data.runtime_generation,
        status: data.status,
        code: data.code,
        reason: data.reason,
      }
    );
    return true;
  }

  // Credentials and pending ACKs are attempt-scoped modal data, not global
  // lifecycle truth. Apply them after the canonical projection so an ordinary
  // DB refresh to `disponible` cannot erase a valid QR attempt. For terminal
  // lifecycle events, reapply the canonical snapshot last as a fail-closed
  // guard against legacy fields in the same envelope.
  applyReducedConnectionState(data, options);
  if (presentationObserved && presentationSnapshot && !attemptScoped) {
    synchronizeModalWithCanonicalSnapshot(presentationSnapshot, data);
  }

  return true;
}

function applyDirectConnectionResponse(data: IBaileysConnectionState) {
  applyConnectionPublication(data, { directResponse: true });
}

function shouldClearPasskeyForDirectResponse(
  data: Partial<IBaileysConnectionState>
): boolean {
  return (
    data.code === ECodeMessage.pairingInProgress &&
    !data.passkey_public_key &&
    !data.passkey_confirmation_code
  );
}

async function recoverQrAfterCentrifugoRecoveryFailure() {
  if (!channelId.value || !workerConnectionChannel.value) {
    return;
  }

  await recoverQrFromRecentHistory('centrifugo_recovery_failed');
}

function handleCentrifugoRecoveryFailed(event: Event) {
  const detail = (event as CustomEvent<{ channel?: string }>).detail;
  if (detail?.channel !== workerConnectionChannel.value) {
    return;
  }

  void recoverQrAfterCentrifugoRecoveryFailure();
}

function shouldProcessConnectionPublication(ctx?: {
  offset?: number;
}): boolean {
  if (!ctx?.offset) {
    return true;
  }

  if (ctx.offset <= lastConnectionPublicationOffset.value) {
    return false;
  }

  lastConnectionPublicationOffset.value = ctx.offset;
  return true;
}

function handleWorkerConnectionMessage(
  data: IBaileysConnectionState | WorkerSecureConnectionPublication,
  ctx?: { offset?: number }
) {
  if (!channelId.value || data.worker_id !== channelId.value) {
    return;
  }

  if ('secure_connection' in data && data.secure_connection) {
    handleSecureConnectionPublication(data);
    return;
  }

  const connectionData = data as IBaileysConnectionState;
  activeDebugTraceId.value =
    connectionData.debug_trace_id ?? activeDebugTraceId.value;
  logLocalConnectionStatus('web.connection_modal.message_received', {
    layer: 'web.connection_modal',
    worker_id: connectionData.worker_id,
    account_id: connectionData.account_id,
    worker_type_id: connectionData.worker_type_id,
    worker_status_id: connectionData.worker_status_id,
    status: connectionData.status,
    code: connectionData.code,
    session_ready: connectionData.session_ready,
    can_send: connectionData.can_send,
    can_receive_runtime: connectionData.can_receive_runtime,
    authenticated: connectionData.authenticated,
    provider_state: connectionData.provider_state,
    degraded_reason: connectionData.degraded_reason,
    phone: connectionData.phone,
    connection_attempt_id: connectionData.connection_attempt_id,
    runtime_generation: connectionData.runtime_generation,
    offset: ctx?.offset,
  });
  logConnectionLifecycleDebug('web.centrifugo.connection_message', {
    trace_id: activeDebugTraceId.value,
    layer: 'web',
    worker_id: connectionData.worker_id,
    account_id: connectionData.account_id,
    worker_type_id: connectionData.worker_type_id,
    connection_attempt_id: connectionData.connection_attempt_id,
    runtime_generation: connectionData.runtime_generation,
    status: connectionData.status,
    code: connectionData.code,
    reason: connectionData.reason,
    qrcode: connectionData.qrcode,
    pairing_code: connectionData.pairing_code,
    has_passkey_public_key: Boolean(connectionData.passkey_public_key),
    has_passkey_confirmation_code: Boolean(
      connectionData.passkey_confirmation_code
    ),
    offset: ctx?.offset,
  });

  if (shouldIgnoreConnectionPayloadIdentity(connectionData)) {
    return;
  }

  if (!shouldProcessConnectionPublication(ctx)) {
    return;
  }

  if (!applyConnectionPublication(connectionData)) {
    logLocalConnectionStatus(
      'web.connection_modal.rejected_by_canonical_projection',
      {
        layer: 'web.connection_modal',
        worker_id: connectionData.worker_id,
        account_id: connectionData.account_id,
        worker_type_id: connectionData.worker_type_id,
        worker_status_id: connectionData.worker_status_id,
        runtime_generation: connectionData.runtime_generation,
        offset: ctx?.offset,
      }
    );
    return;
  }

  const presentationSnapshot = channelStatusPresentationStore.snapshot(
    connectionData.worker_id
  );

  if (
    presentationSnapshot?.workerStatusId === EWorkerStatus.disponible &&
    (presentationSnapshot.source !== 'session_removal_ack' ||
      connectionStartedEmitted.value) &&
    isQrConnectionSelected.value &&
    !connectionData.connection_attempt_id &&
    !connectionAttemptId.value
  ) {
    // Attempt-scoped terminal/transient publications belong to the request
    // that produced them. Starting another request here creates a feedback
    // loop (terminal -> new QR -> terminal) and can replace a QR that the same
    // attempt publishes milliseconds later. Canonical lifecycle availability
    // without an attempt id still auto-starts QR after create/recreate.
    void requestQrCodeIfReady({ silent: true });
  }
}

useResilientCentrifugoSubscription({
  channel: workerConnectionChannel,
  handler: handleWorkerConnectionMessage,
  onSubscribed: async () => {
    if (canRecoverQrFromRecentHistory()) {
      await recoverQrFromRecentHistory('subscription_ready');
    }
  },
  debugContext: () => ({
    trace_id: activeDebugTraceId.value,
    account_id: accountId.value ?? undefined,
    worker_id: channelId.value ?? undefined,
    worker_type_id: activeWorkerTypeId.value ?? channelType.value ?? undefined,
    connection_attempt_id: connectionAttemptId.value,
    runtime_generation: connectionRuntimeGeneration.value,
    layer: 'web.connection_modal',
  }),
});

watch(
  canOfferNewConnection,
  (canOffer) => {
    if (!canOffer) {
      suspendConnectionOfferSideEffects();
    }
  },
  { immediate: true }
);

watch(
  canonicalPresentationSnapshot,
  (snapshot) => {
    if (snapshot) {
      synchronizeModalWithCanonicalSnapshot(snapshot);
    }
  },
  { immediate: true }
);

onMounted(async () => {
  if (!channelId.value || !accountId.value) {
    return;
  }

  ensureDebugTraceId('web_connection_modal_mount');
  logConnectionLifecycleDebug('web.connection_modal.mounted', {
    trace_id: activeDebugTraceId.value,
    layer: 'web',
    worker_id: channelId.value,
    account_id: accountId.value,
    worker_type_id: activeWorkerTypeId.value ?? channelType.value ?? undefined,
    status: props.initialStatusId ?? undefined,
  });
  prepareInitialModalState();
  if (!canOfferNewConnection.value) {
    suspendConnectionOfferSideEffects();
  }

  globalThis.addEventListener(
    'centrifugo-recovery-failed',
    handleCentrifugoRecoveryFailed as EventListener
  );

  if (showExternalConnectionLink.value) {
    await loadExternalConnectionLink();
  }

  // Do not replay the whole account history before a connection attempt is
  // known. A terminal event from a previous runtime generation (for example,
  // logoutInProgress) can otherwise replace the authoritative list status and
  // leave a currently available channel stuck in a blocking modal state.
  // QR history recovery is started after the direct QR response supplies the
  // current connection_attempt_id and runtime_generation.
});

watch(isVisible, (visible) => {
  if (!visible) {
    logConnectionLifecycleDebug('web.connection_modal.closed', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value ?? undefined,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: connectionAttemptId.value,
      runtime_generation: connectionRuntimeGeneration.value,
      status: statusConnection.value,
      code: statusCode.value,
    });
    releaseQrAttemptOnClose();
    clearQrHistoryRecovery();
    clearSecureHelperOpenTimeout();
    stopSecureConnectionPolling();
    if (
      !secureSession.value ||
      isSecureConnectionTerminal(secureSession.value)
    ) {
      selectedConnectionMethod.value = 'method_selection';
    }
    return;
  }

  ensureDebugTraceId('web_connection_modal_visible');
  logConnectionLifecycleDebug('web.connection_modal.visible', {
    trace_id: activeDebugTraceId.value,
    layer: 'web',
    worker_id: channelId.value ?? undefined,
    account_id: accountId.value ?? undefined,
  });
  if (!canOfferNewConnection.value) {
    suspendConnectionOfferSideEffects();
    return;
  }

  if (showExternalConnectionLink.value) {
    void loadExternalConnectionLink();
  }
  void channelStore.getConnectionDownloadArtifacts({ silent: true });

  if (isQrConnectionSelected.value) {
    void recoverQrFromRecentHistory('dialog_visible');
    void requestQrCodeIfReady({ silent: true });
  }

  if (
    (selectedConnectionMethod.value === 'secure' ||
      selectedConnectionMethod.value === 'chrome_extension') &&
    secureSession.value
  ) {
    startSecureConnectionPolling();
    void pollSecureConnectionSession();
  }
});

watch(
  () => props.debugTraceId,
  (debugTraceId) => {
    activeDebugTraceId.value = debugTraceId ?? activeDebugTraceId.value;
  }
);

watch(
  [
    () => props.channelId,
    () => props.channelType,
    () => props.initialConnectionStatus,
    () => props.initialConnectionStatusSourceId,
    () => props.initialConnectionStatusOrder,
    () => props.initialConnectionOnlineAcknowledged,
    () => props.initialStatusId,
  ],
  (
    [
      channelID,
      workerTypeId,
      initialConnectionStatus,
      sourceID,
      statusOrder,
      onlineAcknowledged,
      statusID,
    ],
    [previousChannelID, previousWorkerTypeID]
  ) => {
    const channelChanged =
      channelID !== previousChannelID || workerTypeId !== previousWorkerTypeID;
    if (channelChanged) {
      releaseSecureConnectionLifecycleFence();
      resetNativeConnectionStatus();
      nativeConnectionOnlineAcknowledged.value = false;
      connectionRuntimeGeneration.value = undefined;
    }
    activeWorkerTypeId.value = workerTypeId ?? null;
    if (initialConnectionStatus) {
      const acceptance = acceptNativeConnectionStatus({
        snapshot: initialConnectionStatus,
        sourceId: sourceID,
        order: statusOrder,
        expectedProvider: connectionStatusProvider(workerTypeId),
      });
      if (
        !channelChanged &&
        (acceptance.outcome === 'stale' || acceptance.outcome === 'invalid')
      ) {
        return;
      }
    }
    nativeConnectionOnlineAcknowledged.value =
      onlineAcknowledged === true &&
      isWhatsappConnectionOnline(nativeConnectionStatus.value);
    const presentationSnapshot = canonicalPresentationSnapshot.value;
    if (presentationSnapshot) {
      synchronizeModalWithCanonicalSnapshot(presentationSnapshot);
      return;
    }
    if (statusID === EWorkerStatus.online) {
      if (!applyAuthoritativeInitialOnlineProjection()) {
        sessionReady.value = false;
      }
    } else if (nativeConnectionStatus.value) {
      applyInitialNativeStatusProjection();
    }
  }
);

watch(
  () => props.initialStatusId,
  (statusId) => {
    if (!isVisible.value || !statusId) {
      return;
    }

    const presentationSnapshot = canonicalPresentationSnapshot.value;
    if (presentationSnapshot) {
      synchronizeModalWithCanonicalSnapshot(presentationSnapshot);
      if (
        presentationSnapshot.workerStatusId === EWorkerStatus.disponible &&
        presentationSnapshot.source !== 'session_removal_ack' &&
        isQrConnectionSelected.value &&
        !connectionAttemptId.value
      ) {
        void requestQrCodeIfReady({ silent: true });
      }
      return;
    }

    workerStatusId.value = statusId;

    if (statusId === EWorkerStatus.creating) {
      isResetting.value = false;
      prepareConnectionStart();
      return;
    }

    if (statusId === EWorkerStatus.recreating) {
      isResetting.value = props.isSessionMigration !== true;
      prepareConnectionStart();
      return;
    }

    if (statusId === EWorkerStatus.disponible) {
      prepareConnectionAfterCompletedReset(statusId);
      if (isQrConnectionSelected.value && !connectionAttemptId.value) {
        void requestQrCodeIfReady({ silent: true });
      }
    }
  }
);

onUnmounted(() => {
  releaseQrAttemptOnClose();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
  clearQrHistoryRecovery();
  clearSecureHelperOpenTimeout();
  stopSecureConnectionPolling();

  globalThis.removeEventListener(
    'centrifugo-recovery-failed',
    handleCentrifugoRecoveryFailed as EventListener
  );
});
</script>

<template>
  <VDialog v-model="isVisible" :max-width="dialogMaxWidth">
    <DialogCloseBtn
      v-if="modalState !== 'migrating'"
      @click="isVisible = false"
    />

    <VCard
      :class="[
        'connection-dialog-card',
        { 'connection-dialog-card--standard': standardAppearance },
      ]"
      data-testid="connection-dialog"
    >
      <ChannelMigrationProgress
        v-if="modalState === 'migrating'"
        :source-type="migrationSourceType"
        :target-type="channelType"
        :source-server-name="migrationSourceServerName"
        :target-server-name="migrationTargetServerName"
        :live-status="nativeConnectionStatus?.status"
        @cancel="emit('migrationCancelRequested')"
        @timeout="emit('migrationTimedOut')"
      />

      <ConnectionMethodChooser
        v-else-if="showConnectionChooser"
        :disabled="channelStore.loading || isSecureSessionLoading"
        :show-chrome-extension="isChromeExtensionConnectionAvailable"
        @select="selectConnectionMethod"
      />

      <ConnectionAuthenticatorInstallPanel
        v-else-if="
          canOfferNewConnection &&
          selectedConnectionMethod === 'authenticator_install' &&
          !isConnected
        "
        :disabled="isSecureSessionLoading"
        :downloading="isDownloadingAuthenticator"
        :download-urls="authenticatorDownloadUrls"
        @download="downloadAuthenticatorInstaller"
        @continue="continueAuthenticatorConnection"
        @back="returnToConnectionMethodSelection"
        @cancel="returnToConnectionMethodSelection"
      />

      <ConnectionSecurePanel
        v-else-if="
          canOfferNewConnection &&
          selectedConnectionMethod === 'secure' &&
          !isConnected
        "
        :session="secureSession"
        :loading="isSecureSessionLoading"
        :opening="isOpeningSecureHelper"
        @start="startSecureConnection"
        @open="openSecureHelper"
        @back="returnToConnectionMethodSelection"
        @cancel="cancelSecureConnection"
      />

      <ConnectionChromeExtensionPanel
        v-else-if="
          canOfferNewConnection &&
          selectedConnectionMethod === 'chrome_extension' &&
          !isConnected
        "
        :session="secureSession"
        :loading="isSecureSessionLoading"
        :downloading="isDownloadingChromeExtension"
        :disabled="channelStore.loading"
        :download-url="chromeExtensionPackageUrl"
        :extension-url="chromeExtensionStoreUrl"
        @start="startChromeExtensionConnection"
        @download="downloadChromeExtensionPackage"
        @back="returnToConnectionMethodSelection"
        @cancel="cancelSecureConnection"
      />

      <div v-else class="connection-stage-shell">
        <VCardText v-if="canOfferNewConnection" class="pt-0">
          <ConnectionLifecycleStage
            :state="modalState"
            :title-key="visibleStageMeta.title"
            :description-key="visibleStageMeta.description"
            :icon="visibleStageMeta.icon"
            :loading="visibleStageMeta.loading"
            :qr-code="canOfferNewConnection ? qrcode : undefined"
            :channel-type="activeWorkerTypeId ?? channelType"
            :phone-number="
              isConnected && !isRemovingSession ? phoneNumber : null
            "
            :qr-attempt="qrAttempt"
            :qr-max-attempts="qrMaxAttempts"
            :secondary-value="
              modalState === 'phoneUnavailable' ? formattedTime : null
            "
          />

          <div
            v-if="canOfferNewConnection && modalState === 'pairing'"
            class="pairing-code connection-stage-shell__code"
          >
            <template v-if="pairingCodePrimary && pairingCodeSecondary">
              <VOtpInput
                v-model="pairingCodePrimary"
                disabled
                length="4"
                type="text"
                class="pa-0"
                :focused="false"
              />
              <VOtpInput
                v-model="pairingCodeSecondary"
                disabled
                length="4"
                type="text"
                class="pa-0"
                :focused="false"
              />
            </template>
            <VProgressLinear v-else indeterminate color="primary" />
          </div>

          <div
            v-if="canOfferNewConnection && modalState === 'passkeyConfirmation'"
            class="pairing-code connection-stage-shell__code"
          >
            <template
              v-if="passkeyConfirmationPrimary && passkeyConfirmationSecondary"
            >
              <VOtpInput
                v-model="passkeyConfirmationPrimary"
                disabled
                length="4"
                type="text"
                class="pa-0"
                :focused="false"
              />
              <VOtpInput
                v-model="passkeyConfirmationSecondary"
                disabled
                length="4"
                type="text"
                class="pa-0"
                :focused="false"
              />
            </template>
            <VProgressLinear v-else indeterminate color="primary" />
          </div>

          <VAlert
            v-if="canOfferNewConnection && passkeyError"
            type="error"
            variant="tonal"
            density="compact"
            class="connection-stage-shell__alert"
          >
            {{ $t(passkeyError) }}
          </VAlert>

          <div
            v-if="showPrimaryActions || canOfferNewConnection"
            class="connection-stage-shell__footer"
          >
            <div
              v-if="showExternalConnectionLink"
              class="external-connection-box"
            >
              <div class="external-connection-header">
                <span class="external-connection-header__icon">
                  <VIcon icon="tabler-link" size="20" />
                </span>
                <div>
                  <p>{{ $t('external_connection_link') }}</p>
                  <small>
                    {{ $t('external_connection_link_validity') }}
                    <template v-if="externalConnectionExpiresAtFormatted">
                      · {{ externalConnectionExpiresAtFormatted }}
                    </template>
                  </small>
                </div>
              </div>

              <AppTextField
                v-model="externalConnectionUrl"
                readonly
                density="compact"
                hide-details
                data-testid="external-connection-url"
                :loading="isExternalConnectionLinkLoading"
                :placeholder="$t('external_connection_link_loading')"
              >
                <template #append-inner>
                  <VBtn
                    icon
                    variant="text"
                    size="small"
                    :disabled="
                      !externalConnectionUrl || isExternalConnectionLinkLoading
                    "
                    @click.stop="copyExternalConnectionLink"
                  >
                    <VIcon
                      :icon="
                        isExternalConnectionCopied
                          ? 'tabler-check'
                          : 'tabler-copy'
                      "
                    />
                    <VTooltip activator="parent" location="top">
                      <span>
                        {{
                          isExternalConnectionCopied
                            ? $t('external_connection_link_copied')
                            : $t('copy_external_connection_link')
                        }}
                      </span>
                    </VTooltip>
                  </VBtn>
                </template>
              </AppTextField>
            </div>

            <div
              v-if="showPrimaryActions"
              class="connection-stage-shell__actions"
            >
              <VBtn
                v-if="modalState === 'passkeyRequired'"
                color="primary"
                :disabled="isPasskeyRunning || !passkeyPublicKey"
                :loading="isPasskeyRunning"
                @click="continuePasskeyPairing"
              >
                <VIcon icon="tabler-key" start />
                {{ $t('passkey_continue') }}
              </VBtn>

              <VBtn
                v-else-if="modalState === 'passkeyConfirmation'"
                color="primary"
                :disabled="isPasskeyConfirming"
                :loading="isPasskeyConfirming"
                @click="confirmPasskeyPairing"
              >
                <VIcon icon="tabler-shield-check" start />
                {{ $t('confirm') }}
              </VBtn>

              <VBtn
                v-else-if="showQrRestartAction"
                color="primary"
                :disabled="isActionLocked"
                :loading="channelStore.loading"
                data-testid="connection-restart-qrcode"
                @click="restartQrCodeAttempt"
              >
                <VIcon icon="tabler-refresh" start />
                {{ $t('restart_qrcode') }}
              </VBtn>

              <VBtn
                v-else-if="isConnected"
                :disabled="isActionLocked"
                :loading="channelStore.loading && isRemovingSession"
                color="error"
                variant="tonal"
                data-testid="connection-disconnect"
                @click="disconnectChannelSession"
              >
                <VIcon icon="tabler-circle-off" start />
                {{ $t('disconnect') }}
              </VBtn>
            </div>
          </div>
        </VCardText>
      </div>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.connection-stage-shell {
  display: grid;
  background: rgb(var(--v-theme-surface));
}

.connection-stage-shell > :deep(.v-card-text) {
  padding: 0 !important;
}

.pairing-code {
  display: grid;
  inline-size: min(100%, 260px);
  gap: 8px;
}

.connection-stage-shell__code,
.connection-stage-shell__alert {
  margin-block-start: 18px;
  margin-inline: auto;
}

.connection-stage-shell__alert {
  inline-size: calc(100% - 60px);
}

.connection-stage-shell__footer {
  display: grid;
  align-items: end;
  gap: 20px;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 20px 30px 26px;
  border-block-start: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.external-connection-box {
  display: grid;
  max-inline-size: 520px;
  gap: 11px;
}

.external-connection-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.external-connection-header__icon {
  display: grid;
  flex: 0 0 36px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.09);
  block-size: 36px;
  color: rgb(var(--v-theme-primary));
  inline-size: 36px;
  place-items: center;
}

.external-connection-header p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.82rem;
  font-weight: 700;
}

.external-connection-header small {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.71rem;
  line-height: 1.4;
}

.connection-stage-shell__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.v-btn {
  transform: none;
}

.connection-dialog-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), 0.14);
  border-radius: 22px;
  box-shadow: 0 30px 90px rgba(24, 39, 75, 0.18);
}

.connection-dialog-card--standard {
  border-radius: 6px;
}

@media (max-width: 720px) {
  .connection-stage-shell__footer {
    align-items: stretch;
    grid-template-columns: 1fr;
    padding: 20px;
  }

  .connection-stage-shell__actions {
    justify-content: stretch;
  }

  .connection-stage-shell__actions :deep(.v-btn) {
    flex: 1 1 auto;
  }

  .connection-stage-shell__alert {
    inline-size: calc(100% - 40px);
  }
}
</style>
