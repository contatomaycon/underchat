<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { isAxiosError } from 'axios';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import {
  normalizeWorkerConnectionModalState,
  type WorkerConnectionModalState,
} from '@core/common/functions/normalizeWorkerConnectionModalState';
import { reduceWorkerConnectionState } from '@core/common/functions/reduceWorkerConnectionState';
import { WorkerExternalConnectionViewResponse } from '@core/schema/worker/externalConnection/response.schema';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { subscribeExternalConnection } from '@/@webcore/centrifugoExternalConnection';
import { logLocalConnectionStatus } from '@/@webcore/utils/localConnectionStatusLog';
import {
  evaluateConnectionModalPublication,
  shouldClearConnectionModalQr,
  useWhatsappConnectionStatus,
  type WhatsappConnectionStatusResolution,
} from '@/composables/useWhatsappConnectionStatus';
import { applyWhatsappConnectionStatus } from '@core/common/functions/applyWhatsappConnectionStatus';
import { isWhatsappConnectionOnline } from '@core/common/functions/whatsappConnectionStatus';
import {
  isWhatsappQrCredentialConsumedState,
  isWhatsappQrCredentialPendingState,
} from '@core/common/functions/isWhatsappQrCredentialConsumedState';
import type {
  IWhatsappConnectionStatus,
  WhatsappConnectionStatusProvider,
} from '@core/common/interfaces/IWhatsappConnectionStatus';

definePage({
  meta: {
    layout: 'blank',
    public: true,
  },
});

const route = useRoute<'connection-external-token'>();
const channelStore = useChannelsStore();

const token = computed(() => {
  const value = route.params.token;
  return Array.isArray(value) ? value[0] : String(value ?? '');
});

const externalConnection =
  shallowRef<WorkerExternalConnectionViewResponse | null>(null);
const isLoading = shallowRef(true);
const isInvalid = shallowRef(false);
const isExpired = shallowRef(false);
const isRequestingQr = shallowRef(false);
const workerStatusId = shallowRef<string | null>(null);
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
const qrPending = shallowRef(false);
const qrAttempt = shallowRef(0);
const qrMaxAttempts = shallowRef(0);
const phoneNumber = shallowRef<string | null>(null);
const sessionReady = shallowRef(false);
const disconnectedByUser = shallowRef(false);
const qrCredentialConsumed = shallowRef(false);
const nativeConnectionWorkerId = shallowRef<string>();
const expiryTimeout = shallowRef<number | null>(null);
const isPasskeyRunning = shallowRef(false);
const isPasskeyConfirming = shallowRef(false);
const {
  status: nativeConnectionStatus,
  sourceId: nativeConnectionStatusSourceId,
  order: nativeConnectionStatusOrder,
  accept: acceptNativeConnectionStatus,
  reset: resetNativeConnectionStatus,
} = useWhatsappConnectionStatus();

function nativeProvider(): WhatsappConnectionStatusProvider | undefined {
  const type = externalConnection.value?.type?.id;
  if (type === EWorkerType.baileys) return 'baileys';
  if (type === EWorkerType.wwebjs) return 'wwebjs';
  if (type === EWorkerType.whatsmeow) return 'whatsmeow';
  return undefined;
}

let unsubscribeExternalConnection: (() => void) | null = null;
let externalSubscriptionRetryTimer: number | null = null;
let externalSubscriptionRetryAttempt = 0;
let externalSubscriptionStopped = false;
let externalSubscriptionGeneration = 0;
const EXTERNAL_SUBSCRIPTION_RETRY_MAX_DELAY_MS = 15_000;

function clearExternalSubscriptionRetry() {
  if (externalSubscriptionRetryTimer !== null) {
    window.clearTimeout(externalSubscriptionRetryTimer);
    externalSubscriptionRetryTimer = null;
  }
}

function scheduleExternalSubscriptionRetry() {
  if (
    externalSubscriptionStopped ||
    externalSubscriptionRetryTimer !== null ||
    isInvalid.value ||
    isExpired.value
  ) {
    return;
  }

  const delay = Math.min(
    1_000 * 2 ** externalSubscriptionRetryAttempt,
    EXTERNAL_SUBSCRIPTION_RETRY_MAX_DELAY_MS
  );
  externalSubscriptionRetryAttempt = Math.min(
    externalSubscriptionRetryAttempt + 1,
    10
  );
  externalSubscriptionRetryTimer = window.setTimeout(() => {
    externalSubscriptionRetryTimer = null;
    void loadExternalConnection(false);
  }, delay);
}

const connectionState = computed<Partial<IBaileysConnectionState>>(() => ({
  status: statusConnection.value,
  code: statusCode.value,
  worker_id: externalConnection.value?.worker_id ?? '',
  account_id: externalConnection.value?.account_id ?? '',
  qrcode: qrcode.value,
  passkey_public_key: passkeyPublicKey.value,
  passkey_pending: Boolean(passkeyPublicKey.value),
  passkey_confirmation_code:
    passkeyConfirmationPrimary.value || passkeyConfirmationSecondary.value
      ? `${passkeyConfirmationPrimary.value}${passkeyConfirmationSecondary.value}`
      : undefined,
  connection_attempt_id: connectionAttemptId.value,
  qr_pending: qrPending.value,
  attempt: qrAttempt.value || undefined,
  max_attempts: qrMaxAttempts.value || undefined,
  phone: phoneNumber.value ?? undefined,
  worker_status_id: workerStatusId.value
    ? (workerStatusId.value as EWorkerStatus)
    : undefined,
  session_ready: sessionReady.value,
  disconnected_user: disconnectedByUser.value,
  connection_status: nativeConnectionStatus.value,
  connection_status_source_id: nativeConnectionStatusSourceId.value,
  connection_status_order: nativeConnectionStatusOrder.value,
  connection_online_acknowledged:
    sessionReady.value &&
    isWhatsappConnectionOnline(nativeConnectionStatus.value),
}));

const modalState = computed<WorkerConnectionModalState>(() =>
  normalizeWorkerConnectionModalState(connectionState.value)
);

const isConnected = computed(() => modalState.value === 'connected');
const isQrAttemptsExpired = computed(
  () => qrMaxAttempts.value > 0 && qrAttempt.value > qrMaxAttempts.value
);
const canRetryQrCode = computed(
  () =>
    !isExpired.value &&
    !isInvalid.value &&
    !isConnected.value &&
    !isRequestingQr.value &&
    workerStatusId.value === EWorkerStatus.disponible &&
    modalState.value === 'disconnected' &&
    isQrAttemptsExpired.value
);

const expiresAtFormatted = computed(() => {
  if (!externalConnection.value?.expires_at) {
    return '';
  }

  const expiresAt = new Date(externalConnection.value.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(expiresAt);
});

const stageMeta = computed(() => {
  if (isExpired.value) {
    return {
      title: 'external_connection_expired_title',
      description: 'external_connection_expired_description',
      icon: 'tabler-clock-exclamation',
      color: 'warning',
      loading: false,
    };
  }

  if (isInvalid.value) {
    return {
      title: 'external_connection_invalid_title',
      description: 'external_connection_invalid_description',
      icon: 'tabler-link-off',
      color: 'error',
      loading: false,
    };
  }

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
      icon: 'tabler-arrows-right-left',
      color: 'info',
      loading: true,
    },
    disconnected: {
      title: isQrAttemptsExpired.value
        ? 'qrcode_attempts_expired_title'
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
      title: 'connection_qr_preparing_title',
      description: 'connection_qr_preparing_description',
      icon: 'tabler-qrcode',
      color: 'primary',
      loading: true,
    },
    pairing: {
      title: 'connection_pairing_title',
      description: 'connection_pairing_description',
      icon: 'tabler-link',
      color: 'primary',
      loading: true,
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

function clearExpiryTimeout() {
  if (expiryTimeout.value !== null) {
    window.clearTimeout(expiryTimeout.value);
    expiryTimeout.value = null;
  }
}

function markExpired() {
  isExpired.value = true;
  qrcode.value = undefined;
  resetPasskeyState();
  isRequestingQr.value = false;

  if (unsubscribeExternalConnection) {
    unsubscribeExternalConnection();
    unsubscribeExternalConnection = null;
  }
}

function scheduleExpiry(expiresAt: string) {
  clearExpiryTimeout();

  const expiresAtDate = new Date(expiresAt);
  const delay = expiresAtDate.getTime() - Date.now();

  if (!Number.isFinite(delay) || delay <= 0) {
    markExpired();
    return;
  }

  expiryTimeout.value = window.setTimeout(markExpired, delay);
}

function resetQrAttempts() {
  qrAttempt.value = 0;
  qrMaxAttempts.value = 0;
}

function resetPasskeyState() {
  passkeyPublicKey.value = undefined;
  passkeyConfirmationPrimary.value = '';
  passkeyConfirmationSecondary.value = '';
  passkeyError.value = null;
  isPasskeyRunning.value = false;
  isPasskeyConfirming.value = false;
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
  const decision = evaluateConnectionModalPublication({
    currentAttemptId: connectionAttemptId.value,
    currentConnected: isConnected.value,
    hasDurableNativeOrder: Boolean(nativeConnectionStatusOrder.value),
    incoming: data,
    nativeResolution,
  });
  if (!decision.accepted) {
    logLocalConnectionStatus('web.external_connection.publication_ignored', {
      layer: 'web.external_connection',
      worker_id: data.worker_id ?? externalConnection.value?.worker_id,
      account_id: data.account_id ?? externalConnection.value?.account_id,
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
      reason: decision.reason,
      phone: data.phone,
      expected_connection_attempt_id: connectionAttemptId.value,
      connection_attempt_id: data.connection_attempt_id,
      connection_status_order: data.connection_status_order,
      native_resolution: nativeResolution,
    });
  }

  return !decision.accepted;
}

function setInitialStateFromWorker(data: WorkerExternalConnectionViewResponse) {
  const hadCurrentNativeState =
    nativeConnectionWorkerId.value === data.worker_id &&
    nativeConnectionStatus.value !== undefined;
  if (!hadCurrentNativeState) {
    resetNativeConnectionStatus();
    nativeConnectionWorkerId.value = data.worker_id;
  }
  let acceptedNativeStatus: IWhatsappConnectionStatus | undefined =
    nativeConnectionStatus.value;
  let nativeResolution: WhatsappConnectionStatusResolution = 'none';
  if (data.connection_status) {
    const acceptance = acceptNativeConnectionStatus({
      snapshot: data.connection_status,
      sourceId: data.connection_status_source_id,
      order: data.connection_status_order,
      expectedProvider: nativeProvider(),
    });
    if (acceptance.outcome === 'invalid' || acceptance.outcome === 'stale') {
      return;
    }
    acceptedNativeStatus = acceptance.snapshot ?? nativeConnectionStatus.value;
    nativeResolution = acceptance.outcome;
  }

  const centrallyAcknowledgedOnline =
    data.status?.id === EWorkerStatus.online &&
    data.connection_online_acknowledged === true &&
    isWhatsappConnectionOnline(acceptedNativeStatus) &&
    Boolean(data.number?.trim());
  if (
    hadCurrentNativeState &&
    (!data.connection_status ||
      (nativeResolution === 'duplicate' && !centrallyAcknowledgedOnline))
  ) {
    // A fallback HTTP response may race a newer Centrifugo publication. The
    // native outbox cursor wins. A duplicate snapshot may still carry the
    // later central ONLINE acknowledgement; otherwise it cannot replace an
    // active QR/terminal state.
    return;
  }
  workerStatusId.value = data.status?.id ?? null;
  phoneNumber.value = data.number ? formatPhoneBR(data.number) : null;
  resetQrAttempts();
  connectionAttemptId.value = undefined;
  qrPending.value = false;
  qrCredentialConsumed.value = false;
  resetPasskeyState();

  if (acceptedNativeStatus) {
    const projected = applyWhatsappConnectionStatus(
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.type?.id as EWorkerType | undefined,
        worker_status_id: data.status?.id as EWorkerStatus | undefined,
        phone: data.number ?? undefined,
        session_ready: centrallyAcknowledgedOnline,
        can_send: centrallyAcknowledgedOnline,
        can_receive_runtime: centrallyAcknowledgedOnline,
        authenticated: centrallyAcknowledgedOnline,
        connection_online_acknowledged: centrallyAcknowledgedOnline,
        connection_status_source_id:
          nativeConnectionStatusSourceId.value ?? undefined,
        connection_status_order: nativeConnectionStatusOrder.value,
      },
      acceptedNativeStatus
    );
    statusConnection.value =
      projected.status ?? EBaileysConnectionStatus.connecting;
    statusCode.value = projected.code ?? ECodeMessage.awaitConnection;
    sessionReady.value = centrallyAcknowledgedOnline;
    disconnectedByUser.value = projected.disconnected_user === true;
    qrPending.value = projected.qr_pending === true;
    qrCredentialConsumed.value = isWhatsappQrCredentialConsumedState(projected);
    qrcode.value = undefined;
    return;
  }

  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
  sessionReady.value = false;
  disconnectedByUser.value = false;
  qrCredentialConsumed.value = false;
  qrcode.value = undefined;
  resetPasskeyState();
}

function applyConnectedState(data: IBaileysConnectionState) {
  logLocalConnectionStatus('web.external_connection.connected_applied', {
    layer: 'web.external_connection',
    worker_id: data.worker_id,
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
  });
  workerStatusId.value = EWorkerStatus.online;
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  sessionReady.value = true;
  qrcode.value = undefined;
  resetPasskeyState();
  qrPending.value = false;
  connectionAttemptId.value =
    data.connection_attempt_id ?? connectionAttemptId.value;
  phoneNumber.value = data.phone
    ? formatPhoneBR(data.phone)
    : phoneNumber.value;
  disconnectedByUser.value = false;
  qrCredentialConsumed.value = true;
  isRequestingQr.value = false;
  resetQrAttempts();
}

function applyConnectionState(data: IBaileysConnectionState) {
  if (
    isExpired.value ||
    !externalConnection.value ||
    data.worker_id !== externalConnection.value.worker_id
  ) {
    return;
  }

  let nativeResolution: WhatsappConnectionStatusResolution = 'none';
  if (data.connection_status) {
    const accepted = acceptNativeConnectionStatus({
      snapshot: data.connection_status,
      sourceId: data.connection_status_source_id,
      order: data.connection_status_order,
      expectedProvider: nativeProvider(),
    });
    if (
      !accepted.snapshot ||
      accepted.outcome === 'invalid' ||
      accepted.outcome === 'stale'
    ) {
      return;
    }
    nativeResolution = accepted.outcome;
    data = applyWhatsappConnectionStatus(
      {
        ...data,
        connection_status_source_id: nativeConnectionStatusSourceId.value,
      },
      accepted.snapshot
    );
  } else if (isConnectedPayload(data)) {
    return;
  }

  if (shouldIgnoreConnectionPayload(data, nativeResolution)) {
    return;
  }

  if (
    shouldClearConnectionModalQr({
      nativeResolution,
      snapshot: data.connection_status,
    })
  ) {
    qrcode.value = undefined;
    qrPending.value = false;
  }

  const reduced = reduceWorkerConnectionState(connectionState.value, data, {
    authoritativeNativeTransition: nativeResolution === 'accepted',
  });
  if (reduced.ignored) {
    return;
  }

  if (data.worker_status_id) {
    workerStatusId.value = data.worker_status_id;
  }

  const next = reduced.state;
  const incomingStatus = data.status as EBaileysConnectionStatus | undefined;
  const incomingCode = data.code as ECodeMessage | undefined;
  const isConnectedEvent =
    incomingStatus === EBaileysConnectionStatus.connected ||
    incomingCode === ECodeMessage.connectionEstablished;

  if (isConnectedEvent) {
    applyConnectedState(data);
    return;
  }

  if (isWhatsappQrCredentialConsumedState(data)) {
    qrCredentialConsumed.value = true;
  }
  const keepAwaitingQrCredential =
    !qrCredentialConsumed.value && isWhatsappQrCredentialPendingState(data);

  applyQrAttempts(next);

  if (next.connection_attempt_id) {
    connectionAttemptId.value = next.connection_attempt_id;
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

  if (hasExceededQrAttempts(next)) {
    qrcode.value = undefined;
    resetPasskeyState();
    qrPending.value = false;
    isRequestingQr.value = false;
  } else if (next.passkey_public_key) {
    qrcode.value = undefined;
    passkeyPublicKey.value = next.passkey_public_key;
    passkeyConfirmationPrimary.value = '';
    passkeyConfirmationSecondary.value = '';
    passkeyError.value = null;
    qrPending.value = false;
    isRequestingQr.value = false;
  } else if (next.passkey_confirmation_code) {
    qrcode.value = undefined;
    passkeyPublicKey.value = undefined;
    const [primary, secondary] = splitCode(next.passkey_confirmation_code);
    passkeyConfirmationPrimary.value = primary;
    passkeyConfirmationSecondary.value = secondary;
    passkeyError.value = null;
    qrPending.value = false;
    isRequestingQr.value = false;
  } else if (next.qrcode) {
    qrcode.value = next.qrcode;
    resetPasskeyState();
    isRequestingQr.value = false;
  } else if (next.qr_pending === true) {
    qrcode.value = undefined;
  } else {
    qrcode.value = undefined;
  }

  if (incomingStatus === EBaileysConnectionStatus.disconnected) {
    qrPending.value = false;
    isRequestingQr.value = false;
    resetPasskeyState();
  }

  if (incomingStatus) {
    statusConnection.value = incomingStatus;
  }

  if (incomingCode && incomingCode !== ECodeMessage.info) {
    statusCode.value = incomingCode;
  }

  if (keepAwaitingQrCredential) {
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitingReadQrCode;
    qrPending.value = !qrcode.value;
  }

  if (
    incomingCode === ECodeMessage.pairingInProgress ||
    incomingCode === ECodeMessage.newLoginAttempt
  ) {
    resetPasskeyState();
  }

  if (next.phone) {
    phoneNumber.value = formatPhoneBR(next.phone);
  }

  isRequestingQr.value = false;
}

function applyDirectConnectionResponse(data: IBaileysConnectionState) {
  if (shouldClearPasskeyForDirectResponse(data)) {
    resetPasskeyState();
  }

  applyConnectionState(data);
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

function handleWorkerConnectionMessage(data: IBaileysConnectionState) {
  logLocalConnectionStatus('web.external_connection.message_received', {
    layer: 'web.external_connection',
    worker_id: data.worker_id,
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
  });
  applyConnectionState(data);

  if (data.worker_status_id === EWorkerStatus.disponible) {
    void requestQrCode({ silent: true });
  }
}

async function requestQrCode(
  options: { force?: boolean; silent?: boolean } = {}
) {
  if (
    isExpired.value ||
    isConnected.value ||
    !token.value ||
    workerStatusId.value !== EWorkerStatus.disponible ||
    isRequestingQr.value
  ) {
    return;
  }

  if (!options.force && qrPending.value && Boolean(connectionAttemptId.value)) {
    return;
  }

  if (
    !options.force &&
    (passkeyPublicKey.value ||
      passkeyConfirmationPrimary.value ||
      passkeyConfirmationSecondary.value)
  ) {
    return;
  }

  isRequestingQr.value = true;
  qrCredentialConsumed.value = false;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  if (!qrcode.value) {
    statusCode.value = ECodeMessage.awaitingReadQrCode;
    qrPending.value = true;
  }
  if (!connectionAttemptId.value) {
    resetQrAttempts();
  }

  try {
    const state = await channelStore.requestExternalConnectionQrCode(
      token.value
    );

    if (!state) {
      await loadExternalConnection(false);
      return;
    }

    applyDirectConnectionResponse(state);
  } finally {
    isRequestingQr.value = false;
  }
}

async function continuePasskeyPairing() {
  if (!token.value || !passkeyPublicKey.value) {
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

    const state = await channelStore.sendExternalConnectionPasskeyResponse(
      token.value,
      {
        connection_attempt_id: connectionAttemptId.value,
        passkey_response: passkeyResponse,
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
  if (!token.value) {
    return;
  }

  isPasskeyConfirming.value = true;
  const state = await channelStore.confirmExternalConnectionPasskey(
    token.value,
    {
      connection_attempt_id: connectionAttemptId.value,
    }
  );

  if (state) {
    applyDirectConnectionResponse(state);
  }

  isPasskeyConfirming.value = false;
}

async function subscribeToExternalConnection(
  data: WorkerExternalConnectionViewResponse
) {
  const generation = ++externalSubscriptionGeneration;
  if (unsubscribeExternalConnection) {
    unsubscribeExternalConnection();
    unsubscribeExternalConnection = null;
  }

  try {
    const cleanup = await subscribeExternalConnection(
      {
        url: data.centrifugo_url,
        connectionToken: data.centrifugo_connection_token,
        subscriptionToken: data.centrifugo_subscription_token,
        channel: data.centrifugo_channel,
      },
      handleWorkerConnectionMessage
    );
    if (
      externalSubscriptionStopped ||
      generation !== externalSubscriptionGeneration
    ) {
      cleanup();
      return;
    }
    unsubscribeExternalConnection = cleanup;
    externalSubscriptionRetryAttempt = 0;
    clearExternalSubscriptionRetry();
  } catch (error) {
    if (
      externalSubscriptionStopped ||
      generation !== externalSubscriptionGeneration
    ) {
      return;
    }
    logLocalConnectionStatus('web.external_connection.subscription_failed', {
      layer: 'web.external_connection',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.type?.id,
      connection_attempt_id: connectionAttemptId.value,
      reason:
        error instanceof Error
          ? error.name || 'external_subscription_failed'
          : 'external_subscription_failed',
      retry_attempt: externalSubscriptionRetryAttempt,
    });
    scheduleExternalSubscriptionRetry();
  }
}

async function loadExternalConnection(requestQr = true) {
  let viewData: WorkerExternalConnectionViewResponse | null = null;

  try {
    isInvalid.value = false;
    isExpired.value = false;
    const response = await axios.get<
      IApiResponse<WorkerExternalConnectionViewResponse>
    >(`/worker/external-connection/${encodeURIComponent(token.value)}`);
    const data = response?.data;

    if (!data?.status || !data?.data) {
      isInvalid.value = true;
      return;
    }

    externalConnection.value = data.data;
    viewData = data.data;
    scheduleExpiry(data.data.expires_at);
    setInitialStateFromWorker(data.data);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 410) {
      isExpired.value = true;
      return;
    }

    isInvalid.value = true;
  } finally {
    isLoading.value = false;
  }

  if (!viewData || isInvalid.value || isExpired.value) {
    return;
  }

  await subscribeToExternalConnection(viewData);

  if (
    requestQr &&
    !isConnected.value &&
    !isExpired.value &&
    workerStatusId.value === EWorkerStatus.disponible
  ) {
    await requestQrCode();
  }
}

onMounted(async () => {
  if (!token.value) {
    isInvalid.value = true;
    isLoading.value = false;
    return;
  }

  await loadExternalConnection();
});

onUnmounted(() => {
  externalSubscriptionStopped = true;
  externalSubscriptionGeneration += 1;
  clearExternalSubscriptionRetry();
  clearExpiryTimeout();

  if (unsubscribeExternalConnection) {
    unsubscribeExternalConnection();
    unsubscribeExternalConnection = null;
  }
});
</script>

<template>
  <main
    class="external-connection-page bg-surface"
    data-testid="external-connection-page"
  >
    <VCard class="external-connection-card" elevation="8">
      <VRow no-gutters>
        <VCol cols="12" lg="7" order="2" order-lg="1">
          <VCardItem>
            <VCardTitle>{{ $t('external_connection_page_title') }}</VCardTitle>
          </VCardItem>

          <VCardText class="public-connection-stage">
            <div class="connection-visual">
              <VImg
                v-if="modalState === 'qrReady' && qrcode && !isExpired"
                :src="qrcode"
                max-width="240"
                width="240"
                data-testid="external-connection-qr-image"
              />
              <VProgressCircular
                v-else-if="isLoading || stageMeta.loading || isRequestingQr"
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
              <h4 class="text-h6 mb-2">{{ $t(stageMeta.title) }}</h4>
              <p class="text-body-2 mb-0">
                {{ $t(stageMeta.description) }}
              </p>
              <small v-if="isConnected && phoneNumber" class="d-block mt-1">
                {{ phoneNumber }}
              </small>
              <small
                v-if="!isExpired && expiresAtFormatted"
                class="d-block mt-3 text-medium-emphasis"
              >
                {{ $t('external_connection_link_validity') }} -
                {{ expiresAtFormatted }}
              </small>
            </div>

            <VProgressLinear
              v-if="modalState === 'qrReady' && !isExpired"
              indeterminate
              color="primary"
              class="connection-progress"
            />

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

            <VBtn
              v-if="modalState === 'passkeyRequired' && !isExpired"
              color="primary"
              :loading="isPasskeyRunning"
              :disabled="isPasskeyRunning || !passkeyPublicKey"
              @click="continuePasskeyPairing"
            >
              <VIcon icon="tabler-key" start />
              {{ $t('passkey_continue') }}
            </VBtn>

            <VBtn
              v-if="modalState === 'passkeyConfirmation' && !isExpired"
              color="primary"
              :loading="isPasskeyConfirming"
              :disabled="isPasskeyConfirming"
              @click="confirmPasskeyPairing"
            >
              <VIcon icon="tabler-shield-check" start />
              {{ $t('confirm') }}
            </VBtn>

            <VBtn
              v-if="canRetryQrCode"
              color="primary"
              :loading="isRequestingQr"
              :disabled="isRequestingQr"
              @click="requestQrCode({ force: true })"
            >
              <VIcon icon="tabler-refresh" start />
              {{ $t('retry_qrcode') }}
            </VBtn>
          </VCardText>
        </VCol>

        <VCol cols="12" lg="5" order="1" order-lg="2" class="connection-side">
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
                  <span class="app-timeline-title">
                    {{ $t('tap_settings') }}
                  </span>
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
                  <span class="app-timeline-meta">
                    {{ $t('scan_qr_code') }}
                  </span>
                </div>
              </VTimelineItem>
            </VTimeline>
          </VCardText>
        </VCol>
      </VRow>
    </VCard>
  </main>
</template>

<style lang="scss" scoped>
.external-connection-page {
  display: grid;
  min-block-size: 100vh;
  padding: 24px;
  place-items: center;
}

.external-connection-card {
  inline-size: min(100%, 920px);
  overflow: hidden;
  border-radius: 8px;
}

.public-connection-stage {
  display: flex;
  min-block-size: 420px;
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
  max-inline-size: 320px;
  margin-inline: auto;
}

.connection-progress {
  max-inline-size: 240px;
}

.pairing-code {
  display: flex;
  max-inline-size: 300px;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.connection-side {
  position: relative;
  background-color: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.connection-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.v-btn {
  transform: none;
}
</style>
