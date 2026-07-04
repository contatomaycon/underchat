<script lang="ts" setup>
import {
  computed,
  onMounted,
  onUnmounted,
  shallowRef,
  toRef,
  watch,
} from 'vue';
import {
  fetchRecentHistoryAndProcess,
  onMessage,
  unsubscribe,
} from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerSecureConnectionSessionResponse } from '@core/schema/worker/secureConnection/response.schema';
import {
  normalizeWorkerConnectionModalState,
  type WorkerConnectionModalState,
} from '@core/common/functions/normalizeWorkerConnectionModalState';
import { reduceWorkerConnectionState } from '@core/common/functions/reduceWorkerConnectionState';
import {
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
  logConnectionLifecycleDebug,
} from '@/@webcore/utils/connectionLifecycleDebug';
import { logLocalConnectionStatus } from '@/@webcore/utils/localConnectionStatusLog';
import ConnectionMethodChooser from './ConnectionMethodChooser.vue';
import ConnectionSecurePanel from './ConnectionSecurePanel.vue';

const channelStore = useChannelsStore();

type ConnectionMethod = 'method_selection' | 'qrcode' | 'secure';

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
}>();

const emit = defineEmits<(e: 'update:modelValue', v: boolean) => void>();

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
const workerConnectionChannel = computed(() =>
  accountId.value ? workerCentrifugoQueue(accountId.value) : ''
);

const MIN_PAIRING_STAGE_MS = 900;
const QR_MAX_AGE_MS = 120_000;
const QR_HISTORY_RECOVERY_LIMIT = 250;
const QR_HISTORY_RECOVERY_DELAYS_MS = [
  1_500, 5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 180_000, 240_000,
] as const;
const QR_REQUESTABLE_WORKER_STATUSES = new Set<string>([
  EWorkerStatus.disponible,
  EWorkerStatus.creating,
  EWorkerStatus.recreating,
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
const sessionReady = shallowRef(props.initialStatusId === EWorkerStatus.online);
const disconnectedByUser = shallowRef(false);
const isResetting = shallowRef(false);
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
const isSecureSessionLoading = shallowRef(false);
const isOpeningSecureHelper = shallowRef(false);
const secureHelperOpenTimeoutId = shallowRef<number | null>(null);
const securePollingIntervalId = shallowRef<number | null>(null);

const secondsNextAttempt = shallowRef(0);
const intervalIdNextAttempt = shallowRef<number | null>(null);
const pairingStartedAt = shallowRef<number | null>(null);
const connectedStateDelayTimeout = shallowRef<number | null>(null);
const lastConnectionPublicationOffset = shallowRef(0);

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
}));

const modalState = computed<WorkerConnectionModalState>(() =>
  normalizeWorkerConnectionModalState(connectionState.value, {
    isResetting: isResetting.value,
  })
);

const isConnected = computed(() => modalState.value === 'connected');
const dialogMaxWidth = computed(() =>
  selectedConnectionMethod.value === 'method_selection' && !isConnected.value
    ? 760
    : 640
);
const isQrAttemptsExpired = computed(
  () => qrMaxAttempts.value > 0 && qrAttempt.value > qrMaxAttempts.value
);
const isBlockingOperation = computed(
  () =>
    modalState.value === 'loggingOut' ||
    modalState.value === 'resetting' ||
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
const showConnectionChooser = computed(
  () =>
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

const showPrimaryActions = computed(() => modalState.value !== 'pairing');
const showQrRetryOnly = computed(
  () =>
    modalState.value === 'disconnected' &&
    isQrAttemptsExpired.value &&
    isWorkerReadyForQr.value
);
const showReconnectAction = computed(
  () =>
    !isConnected.value &&
    isWorkerReadyForQr.value &&
    !showQrRetryOnly.value &&
    !isBlockingOperation.value &&
    modalState.value !== 'pairing' &&
    modalState.value !== 'passkeyRequired' &&
    modalState.value !== 'passkeyConfirmation'
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
  if (!channelId.value) {
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

    externalConnectionUrl.value = link?.url ?? '';
    externalConnectionExpiresAt.value = link?.expires_at ?? null;
  } finally {
    isExternalConnectionLinkLoading.value = false;
  }
}

async function copyExternalConnectionLink() {
  if (!externalConnectionUrl.value) {
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
    ['connected', 'failed', 'expired', 'cancelled'].includes(session.status)
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

function startSecureConnectionPolling() {
  stopSecureConnectionPolling();

  if (!channelId.value || !secureSession.value?.token) {
    return;
  }

  securePollingIntervalId.value = window.setInterval(() => {
    void pollSecureConnectionSession();
  }, 2500);
}

function applySecureConnectionSession(
  session: WorkerSecureConnectionSessionResponse
) {
  secureSession.value = session;
  connectionAttemptId.value = session.connection_attempt_id;
  connectionRuntimeGeneration.value =
    session.runtime_generation ?? connectionRuntimeGeneration.value;

  if (session.status === 'connected') {
    statusConnection.value = EBaileysConnectionStatus.connected;
    statusCode.value = ECodeMessage.connectionEstablished;
    workerStatusId.value = EWorkerStatus.online;
    sessionReady.value = true;
    qrcode.value = undefined;
    qrPending.value = false;
    phoneNumber.value = session.phone ? formatPhoneBR(session.phone) : null;
    clearQrHistoryRecovery();
  }

  if (isSecureConnectionTerminal(session)) {
    stopSecureConnectionPolling();
  }
}

async function pollSecureConnectionSession() {
  if (!channelId.value || !secureSession.value?.token) {
    stopSecureConnectionPolling();
    return;
  }

  const session = await channelStore.viewSecureConnectionSession(
    channelId.value,
    secureSession.value.token,
    { silent: true }
  );

  if (session) {
    applySecureConnectionSession(session);
  }
}

function openSecureHelper() {
  if (!secureSession.value?.deep_link) {
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

async function startSecureConnection(options: { openHelper?: boolean } = {}) {
  if (!channelId.value || isSecureSessionLoading.value) {
    return;
  }

  selectedConnectionMethod.value = 'secure';

  if (secureSession.value && !isSecureConnectionTerminal(secureSession.value)) {
    if (options.openHelper !== false) {
      openSecureHelper();
    }
    startSecureConnectionPolling();
    return;
  }

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

    if (!session) {
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

async function cancelSecureConnection() {
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
  stopSecureConnectionPolling();
  clearSecureHelperOpenTimeout();
  clearQrHistoryRecovery();
}

async function selectConnectionMethod(method: 'secure' | 'qrcode') {
  if (method === 'secure') {
    await startSecureConnection();
    return;
  }

  selectedConnectionMethod.value = 'qrcode';
  await requestQrCodeIfReady({ force: true });
}

function handleSecureConnectionPublication(
  data: WorkerSecureConnectionPublication
) {
  if (!data.secure_connection || data.worker_id !== channelId.value) {
    return;
  }

  applySecureConnectionSession(data.secure_connection);
}

async function switchToSecureConnectionFromPasskeyRequirement() {
  if (selectedConnectionMethod.value === 'secure') {
    return;
  }

  selectedConnectionMethod.value = 'secure';
  await startSecureConnection();
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

  if (
    data.runtime_generation !== undefined &&
    connectionRuntimeGeneration.value !== undefined &&
    data.runtime_generation !== connectionRuntimeGeneration.value
  ) {
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

function hasConfirmedSessionReady(
  data: Partial<IBaileysConnectionState>
): boolean {
  return (
    data.status === EBaileysConnectionStatus.connected &&
    data.code === ECodeMessage.connectionEstablished &&
    data.worker_status_id === EWorkerStatus.online &&
    data.session_ready === true &&
    Boolean(data.phone?.trim())
  );
}

function shouldIgnoreConnectedPayload(
  data: Partial<IBaileysConnectionState>,
  options: { directResponse?: boolean } = {}
): boolean {
  if (!isConnectedPayload(data)) {
    return false;
  }

  if (!hasConfirmedSessionReady(data)) {
    logLocalConnectionStatus('web.connection_modal.connected_ignored', {
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
      reason: 'connected_without_confirmed_session_ready',
      phone: data.phone,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
    });
    return true;
  }

  if (
    connectionAttemptId.value &&
    data.connection_attempt_id !== connectionAttemptId.value
  ) {
    logLocalConnectionStatus('web.connection_modal.connected_ignored', {
      layer: 'web.connection_modal',
      worker_id: data.worker_id ?? channelId.value ?? undefined,
      account_id: data.account_id ?? accountId.value ?? undefined,
      worker_type_id: data.worker_type_id ?? activeWorkerTypeId.value,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      session_ready: data.session_ready,
      reason: 'stale_connection_attempt',
      expected_connection_attempt_id: connectionAttemptId.value,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
    });
    return true;
  }

  const ignored =
    !options.directResponse &&
    !connectionAttemptId.value &&
    props.initialStatusId !== EWorkerStatus.online;
  if (ignored) {
    logLocalConnectionStatus('web.connection_modal.connected_ignored', {
      layer: 'web.connection_modal',
      worker_id: data.worker_id ?? channelId.value ?? undefined,
      account_id: data.account_id ?? accountId.value ?? undefined,
      worker_type_id: data.worker_type_id ?? activeWorkerTypeId.value,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      session_ready: data.session_ready,
      reason: 'terminal_connected_without_active_attempt',
      phone: data.phone,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      initial_worker_status_id: props.initialStatusId,
    });
  }

  return ignored;
}

function canRecoverQrFromRecentHistory(): boolean {
  return (
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
  if (!workerConnectionChannel.value) {
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
      QR_HISTORY_RECOVERY_LIMIT
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

async function recoverQrFromCachedRequest(reason: string): Promise<boolean> {
  if (!channelId.value || !canRecoverQrFromRecentHistory()) {
    return false;
  }

  const currentConnectionAttemptId = connectionAttemptId.value;
  const startedAt = Date.now();

  try {
    logConnectionLifecycleDebug('web.qr_cache_recovery.request', {
      trace_id: ensureDebugTraceId('web_qr_cache_recovery'),
      layer: 'web',
      worker_id: channelId.value,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: currentConnectionAttemptId,
      reason,
    });
    const state = await channelStore.requestConnectionQrCode(channelId.value, {
      silent: true,
      debugTraceId: activeDebugTraceId.value,
    });

    if (state) {
      applyDirectConnectionResponse(state);
    }

    if (!qrcode.value && state?.qr_pending === true) {
      scheduleQrHistoryRecovery('cache_recovery_pending');
    }

    logConnectionLifecycleDebug('web.qr_cache_recovery.response', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value,
      account_id: accountId.value ?? undefined,
      connection_attempt_id:
        state?.connection_attempt_id ?? currentConnectionAttemptId,
      runtime_generation: state?.runtime_generation,
      status: state?.status,
      code: state?.code,
      reason: state?.reason ?? reason,
      duration_ms: Date.now() - startedAt,
      qrcode: state?.qrcode,
      pairing_code: state?.pairing_code,
      has_passkey_public_key: Boolean(state?.passkey_public_key),
      has_passkey_confirmation_code: Boolean(state?.passkey_confirmation_code),
      qr_pending: state?.qr_pending === true,
    });

    return hasActiveConnectionCode.value;
  } catch (error) {
    logConnectionLifecycleDebug('web.qr_cache_recovery.error', {
      trace_id: activeDebugTraceId.value,
      layer: 'web',
      worker_id: channelId.value,
      account_id: accountId.value ?? undefined,
      connection_attempt_id: currentConnectionAttemptId,
      reason,
      duration_ms: Date.now() - startedAt,
      error,
    });
    return false;
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

  for (const delayMs of QR_HISTORY_RECOVERY_DELAYS_MS) {
    const timeoutId = window.setTimeout(() => {
      qrHistoryRecoveryTimeouts.delete(timeoutId);

      if (!canRecoverQrFromRecentHistory()) {
        return;
      }

      void (async () => {
        const recoveryReason = `${reason}:${delayMs}ms`;
        await recoverQrFromRecentHistory(recoveryReason);

        if (!qrcode.value && canRecoverQrFromRecentHistory()) {
          await recoverQrFromCachedRequest(recoveryReason);
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

function prepareConnectionStart(options: { preserveQr?: boolean } = {}) {
  clearQrHistoryRecovery();

  const shouldPreserveQr = options.preserveQr === true && Boolean(qrcode.value);
  const currentQrCode = qrcode.value;
  const currentConnectionAttemptId = connectionAttemptId.value;
  const currentRuntimeGeneration = connectionRuntimeGeneration.value;
  const currentQrPending = qrPending.value;
  const currentQrAttempt = qrAttempt.value;
  const currentQrMaxAttempts = qrMaxAttempts.value;

  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
  qrcode.value = shouldPreserveQr ? currentQrCode : undefined;
  connectionAttemptId.value = shouldPreserveQr
    ? currentConnectionAttemptId
    : undefined;
  connectionRuntimeGeneration.value = shouldPreserveQr
    ? currentRuntimeGeneration
    : undefined;
  qrPending.value = shouldPreserveQr ? currentQrPending : true;
  sessionReady.value = false;
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

function prepareInitialModalState() {
  workerStatusId.value = props.initialStatusId ?? null;

  if (props.initialStatusId !== EWorkerStatus.online) {
    prepareConnectionStart();
    return;
  }

  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  qrcode.value = undefined;
  connectionAttemptId.value = undefined;
  connectionRuntimeGeneration.value = undefined;
  qrPending.value = false;
  sessionReady.value = true;
  resetQrAttempts();
  phoneNumber.value = props.initialPhone
    ? formatPhoneBR(props.initialPhone)
    : null;
  disconnectedByUser.value = false;
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  resetPasskeyState();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

async function requestQrCodeIfReady(
  options: { force?: boolean; preserveQr?: boolean; silent?: boolean } = {}
) {
  if (!channelId.value) return;

  if (
    selectedConnectionMethod.value !== 'qrcode' ||
    !isVisible.value ||
    !isWorkerReadyForQr.value ||
    isConnected.value ||
    isBlockingOperation.value ||
    isRequestingQr.value
  ) {
    return;
  }

  if (!options.force && qrPending.value && Boolean(connectionAttemptId.value)) {
    return;
  }

  if (!options.force && hasActiveConnectionCode.value) {
    return;
  }

  isRequestingQr.value = true;
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
  prepareConnectionStart({ preserveQr: options.preserveQr });

  try {
    const state = await channelStore.requestConnectionQrCode(channelId.value, {
      silent: options.silent,
      debugTraceId,
    });
    if (state) {
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
    isRequestingQr.value = false;
  }
}

async function reconnectChannel() {
  await requestQrCodeIfReady({ force: true, preserveQr: true });
}

async function restartQrCodeAttempt() {
  await reconnectChannel();
}

async function continuePasskeyPairing() {
  if (!channelId.value || !passkeyPublicKey.value) {
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
  if (!channelId.value) {
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

  if (state) {
    applyDirectConnectionResponse(state);
  }

  isPasskeyConfirming.value = false;
}

async function recreateChannelWithFullCleanup() {
  if (!channelId.value) return;

  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.logoutInProgress;
  disconnectedByUser.value = true;
  qrcode.value = undefined;
  qrPending.value = false;
  connectionAttemptId.value = undefined;
  connectionRuntimeGeneration.value = undefined;
  clearQrHistoryRecovery();
  resetQrAttempts();
  resetPairingCodes();
  resetPasskeyState();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
  pairingStartedAt.value = null;

  const debugTraceId = ensureDebugTraceId('web_reset_recreate_modal');
  logConnectionLifecycleDebug('web.connection_reset.submit', {
    trace_id: debugTraceId,
    layer: 'web',
    worker_id: channelId.value,
    account_id: accountId.value ?? undefined,
  });

  const reseted = await channelStore.resetConnectionChannel(channelId.value, {
    debugTraceId,
  });

  if (!reseted) {
    statusConnection.value = EBaileysConnectionStatus.disconnected;
    statusCode.value = ECodeMessage.connectionClosed;
    return;
  }
  logConnectionLifecycleDebug('web.connection_reset.accepted', {
    trace_id: activeDebugTraceId.value,
    layer: 'web',
    worker_id: channelId.value,
    account_id: accountId.value ?? undefined,
  });

  isResetting.value = true;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
}

function scheduleConnectedState(data: IBaileysConnectionState) {
  const startedAt = pairingStartedAt.value;
  if (!startedAt) {
    applyConnectedState(data);
    return;
  }

  const remaining = MIN_PAIRING_STAGE_MS - (Date.now() - startedAt);
  if (remaining <= 0) {
    applyConnectedState(data);
    return;
  }

  clearConnectedStateDelay();
  connectedStateDelayTimeout.value = (
    globalThis as Window & typeof globalThis
  ).setTimeout(() => {
    applyConnectedState(data);
  }, remaining);
}

function applyConnectedState(data: IBaileysConnectionState) {
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

  if (shouldIgnoreConnectedPayload(data, options)) {
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

  const reduced = reduceWorkerConnectionState(connectionState.value, data);
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

  if (
    incomingCode === ECodeMessage.pairingInProgress ||
    incomingCode === ECodeMessage.newLoginAttempt
  ) {
    pairingStartedAt.value = Date.now();
    resetPasskeyState();
  }

  if (next.connection_attempt_id) {
    connectionAttemptId.value = next.connection_attempt_id;
  }

  if (next.runtime_generation !== undefined) {
    connectionRuntimeGeneration.value = next.runtime_generation;
  }

  qrPending.value = next.qr_pending === true;

  if (next.disconnected_user !== undefined) {
    disconnectedByUser.value = next.disconnected_user;
  }

  if (next.session_ready !== undefined) {
    sessionReady.value = next.session_ready === true;
  }

  if (next.worker_status_id && next.worker_status_id !== EWorkerStatus.online) {
    sessionReady.value = false;
  }

  if (hasExceededQrAttempts(next)) {
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
    const hadRecoveryScheduled = qrHistoryRecoveryTimeouts.size > 0;
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

  if (next.phone) {
    phoneNumber.value = formatPhoneBR(next.phone);
  }

  if (next.pairing_code) {
    const [primary, secondary] = splitCode(next.pairing_code);
    pairingCodePrimary.value = primary;
    pairingCodeSecondary.value = secondary;
    passkeyPublicKey.value = undefined;
    passkeyConfirmationPrimary.value = '';
    passkeyConfirmationSecondary.value = '';
    passkeyError.value = null;
  }

  if (next.seconds_until_next_attempt) {
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

function applyDirectConnectionResponse(data: IBaileysConnectionState) {
  applyReducedConnectionState(data, { directResponse: true });
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

  if (shouldIgnoreConnectedPayload(connectionData)) {
    logConnectionLifecycleDebug('web.centrifugo.connected_ignored', {
      trace_id: connectionData.debug_trace_id ?? activeDebugTraceId.value,
      layer: 'web',
      worker_id: connectionData.worker_id,
      account_id: connectionData.account_id,
      worker_type_id: connectionData.worker_type_id,
      connection_attempt_id: connectionData.connection_attempt_id,
      runtime_generation: connectionData.runtime_generation,
      status: connectionData.status,
      code: connectionData.code,
      worker_status_id: connectionData.worker_status_id,
      session_ready: connectionData.session_ready,
      phone: connectionData.phone,
      offset: ctx?.offset,
    });
    return;
  }

  if (connectionData.worker_status_id) {
    workerStatusId.value = connectionData.worker_status_id;
  }

  if (connectionData.worker_status_id === EWorkerStatus.recreating) {
    isResetting.value = true;
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitConnection;
    qrcode.value = undefined;
    qrPending.value = false;
    connectionAttemptId.value = connectionData.connection_attempt_id;
    connectionRuntimeGeneration.value = connectionData.runtime_generation;
    pairingStartedAt.value = null;
    resetPairingCodes();
    resetPasskeyState();
    clearQrHistoryRecovery();
    clearConnectedStateDelay();
    return;
  }

  if (connectionData.worker_status_id === EWorkerStatus.creating) {
    if (hasActiveConnectionCode.value || qrPending.value) {
      return;
    }

    isResetting.value = false;
    prepareConnectionStart();
    return;
  }

  if (connectionData.worker_status_id) {
    isResetting.value = false;
  }

  applyReducedConnectionState(connectionData);

  if (
    connectionData.worker_status_id === EWorkerStatus.disponible &&
    isQrConnectionSelected.value
  ) {
    void requestQrCodeIfReady({ silent: true });
  }
}

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
  await loadExternalConnectionLink();

  globalThis.addEventListener(
    'centrifugo-recovery-failed',
    handleCentrifugoRecoveryFailed as EventListener
  );

  await onMessage(workerConnectionChannel.value, handleWorkerConnectionMessage);
  await fetchRecentHistoryAndProcess(
    workerConnectionChannel.value,
    handleWorkerConnectionMessage
  );
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
  void loadExternalConnectionLink();

  if (isQrConnectionSelected.value) {
    void recoverQrFromRecentHistory('dialog_visible');
    void requestQrCodeIfReady({ silent: true });
  }

  if (selectedConnectionMethod.value === 'secure' && secureSession.value) {
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
  () => props.channelType,
  (workerTypeId) => {
    activeWorkerTypeId.value = workerTypeId ?? null;
    connectionRuntimeGeneration.value = undefined;
  }
);

watch(
  () => props.initialStatusId,
  (statusId) => {
    if (!isVisible.value || !statusId) {
      return;
    }

    workerStatusId.value = statusId;

    if (statusId === EWorkerStatus.creating) {
      isResetting.value = false;
      prepareConnectionStart();
      return;
    }

    if (statusId === EWorkerStatus.recreating) {
      isResetting.value = true;
      prepareConnectionStart();
      return;
    }

    if (statusId === EWorkerStatus.disponible) {
      isResetting.value = false;
      if (isQrConnectionSelected.value) {
        void requestQrCodeIfReady({ silent: true });
      }
    }
  }
);

onUnmounted(() => {
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
  clearQrHistoryRecovery();
  clearSecureHelperOpenTimeout();
  stopSecureConnectionPolling();

  globalThis.removeEventListener(
    'centrifugo-recovery-failed',
    handleCentrifugoRecoveryFailed as EventListener
  );

  if (accountId.value) {
    void unsubscribe(
      workerConnectionChannel.value,
      handleWorkerConnectionMessage
    );
  }
});
</script>

<template>
  <VDialog v-model="isVisible" :max-width="dialogMaxWidth">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard data-testid="connection-dialog">
      <ConnectionMethodChooser
        v-if="showConnectionChooser"
        :disabled="channelStore.loading || isSecureSessionLoading"
        @select="selectConnectionMethod"
      />

      <ConnectionSecurePanel
        v-else-if="selectedConnectionMethod === 'secure' && !isConnected"
        :session="secureSession"
        :loading="isSecureSessionLoading"
        :opening="isOpeningSecureHelper"
        @start="startSecureConnection"
        @open="openSecureHelper"
        @back="returnToConnectionMethodSelection"
        @cancel="cancelSecureConnection"
      />

      <VRow v-else no-gutters>
        <VCol cols="12" sm="8" md="12" lg="7" order="2" order-lg="1">
          <VCardItem>
            <VCardTitle>{{ $t('conection') }}</VCardTitle>
          </VCardItem>

          <VCardText class="connection-stage">
            <div class="connection-visual">
              <VImg
                v-if="modalState === 'qrReady' && qrcode"
                :src="qrcode"
                max-width="240"
                width="240"
                data-testid="connection-qr-image"
              />
              <VProgressCircular
                v-else-if="stageMeta.loading"
                indeterminate
                :color="stageMeta.color"
                size="112"
                width="4"
              >
                <VIcon
                  :icon="stageMeta.icon"
                  :color="stageMeta.color"
                  size="52"
                />
              </VProgressCircular>
              <VIcon
                v-else
                :icon="stageMeta.icon"
                :color="stageMeta.color"
                size="124"
              />
            </div>

            <div class="connection-copy text-center">
              <h4 class="text-h6 mb-2" data-testid="connection-stage-title">
                {{ $t(stageMeta.title) }}
              </h4>
              <p class="text-body-2 mb-0">
                {{ $t(stageMeta.description) }}
              </p>
              <small v-if="isConnected && phoneNumber" class="d-block mt-1">
                {{ phoneNumber }}
              </small>
              <template v-if="modalState === 'phoneUnavailable'">
                <strong class="d-block text-h5 mt-3">{{
                  formattedTime
                }}</strong>
                <small>{{ $t('seconds_until_next_attempt') }}</small>
              </template>
            </div>

            <div v-if="modalState === 'pairing'" class="pairing-code">
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
              v-if="modalState === 'passkeyConfirmation'"
              class="pairing-code"
            >
              <template
                v-if="
                  passkeyConfirmationPrimary && passkeyConfirmationSecondary
                "
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
              v-if="passkeyError"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-4"
            >
              {{ $t(passkeyError) }}
            </VAlert>

            <VProgressLinear
              v-if="modalState === 'qrReady'"
              indeterminate
              color="primary"
              class="connection-progress"
            />
          </VCardText>

          <VCardText v-if="showPrimaryActions" class="d-flex justify-center">
            <div class="d-flex gap-2">
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
                v-else-if="showQrRetryOnly"
                color="primary"
                :disabled="isActionLocked"
                :loading="channelStore.loading"
                @click="restartQrCodeAttempt"
              >
                <VIcon icon="tabler-refresh" start />
                {{ $t('retry_qrcode') }}
              </VBtn>

              <VBtn
                v-else
                :disabled="isActionLocked"
                :loading="channelStore.loading && modalState === 'loggingOut'"
                :color="isConnected ? 'error' : 'primary'"
                @click="recreateChannelWithFullCleanup"
              >
                <VTooltip
                  location="top"
                  activator="parent"
                  transition="scroll-x-transition"
                >
                  <span>{{
                    isConnected ? $t('disconnect') : $t('recreate')
                  }}</span>
                </VTooltip>
                <VIcon
                  :icon="isConnected ? 'tabler-circle-off' : 'tabler-reload'"
                />
              </VBtn>

              <VBtn
                v-if="showReconnectAction"
                :disabled="isActionLocked"
                :loading="channelStore.loading && modalState === 'starting'"
                color="warning"
                data-testid="connection-reconnect"
                @click="reconnectChannel"
              >
                <VTooltip
                  location="top"
                  activator="parent"
                  transition="scroll-x-transition"
                >
                  <span>{{ $t('reconnect') }}</span>
                </VTooltip>
                <VIcon icon="tabler-refresh" />
              </VBtn>
            </div>
          </VCardText>

          <VCardText class="pt-0">
            <div class="external-connection-box">
              <div class="external-connection-header">
                <VIcon icon="tabler-link" color="primary" size="22" />
                <div>
                  <p class="text-body-2 font-weight-medium mb-0">
                    {{ $t('external_connection_link') }}
                  </p>
                  <small class="text-medium-emphasis">
                    {{ $t('external_connection_link_validity') }}
                    <template v-if="externalConnectionExpiresAtFormatted">
                      - {{ externalConnectionExpiresAtFormatted }}
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
                    <VTooltip
                      activator="parent"
                      location="top"
                      transition="scroll-x-transition"
                    >
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
          </VCardText>
        </VCol>

        <VCol
          cols="12"
          sm="4"
          md="12"
          lg="5"
          order="1"
          order-lg="2"
          class="member-pricing-bg"
        >
          <VCardText class="d-flex">
            <VTimeline
              side="end"
              align="start"
              line-inset="8"
              truncate-line="start"
              density="compact"
              class="v-timeline--variant-outlined"
            >
              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="primary" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">
                    {{ $t('open_whatsapp') }}
                  </span>
                  <span class="app-timeline-meta">
                    {{ $t('certify_latest_version') }}
                  </span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="warning" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">{{
                    $t('tap_settings')
                  }}</span>
                  <span class="app-timeline-meta">
                    {{ $t('you_top_right_corner') }}
                  </span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="info" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">
                    {{ $t('select_connected_devices') }}
                  </span>
                  <span class="app-timeline-meta">
                    {{ $t('access_connect_device') }}
                  </span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="success" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">
                    {{ $t('point_camera_screen') }}
                  </span>
                  <span class="app-timeline-meta">{{
                    $t('scan_qr_code')
                  }}</span>
                </div>
              </VTimelineItem>
            </VTimeline>
          </VCardText>
        </VCol>
      </VRow>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.connection-stage {
  display: flex;
  min-block-size: 320px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.connection-visual {
  display: grid;
  min-inline-size: 172px;
  min-block-size: 172px;
  place-items: center;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background-color: rgb(var(--v-theme-surface));
  box-shadow: inset 0 0 0 12px rgba(var(--v-theme-primary), 0.05);
}

.connection-copy {
  max-inline-size: 300px;
  margin-inline: auto;
}

.connection-progress {
  max-inline-size: 240px;
}

.pairing-code {
  display: grid;
  inline-size: min(100%, 260px);
  gap: 8px;
}

.external-connection-box {
  display: grid;
  gap: 10px;
}

.external-connection-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.connection-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.member-pricing-bg {
  position: relative;
  background-color: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.v-btn {
  transform: none;
}
</style>
