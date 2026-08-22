import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '../enums/EWhatsappConnectionStatus';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';

export type WorkerConnectionModalState =
  | 'starting'
  | 'migrating'
  | 'qrPreparing'
  | 'qrReady'
  | 'pairingInProgress'
  | 'connected'
  | 'loggingOut'
  | 'resetting'
  | 'disconnected'
  | 'phoneUnavailable'
  | 'phoneInput'
  | 'pairing'
  | 'passkeyRequired'
  | 'passkeyConfirmation';

export interface NormalizeWorkerConnectionModalStateContext {
  isResetting?: boolean;
  /**
   * A PostgreSQL-backed provider/server handoff keeps the source session
   * intact until the target is promoted. It must never be presented as a
   * destructive reset while that handoff is in progress.
   */
  isSessionMigration?: boolean;
  /**
   * Explicitly supplied only when the caller has started a destructive
   * conversion (for example legacy_volume -> postgres on a type/server
   * change). Ordinary `recreating` lifecycle publications are not proof that
   * a session was deleted.
   */
  isDestructiveReset?: boolean;
  /**
   * The current modal explicitly started a QR request and still owns its
   * attempt-scoped pending/credential state. During provider bootstrap the
   * last accepted native snapshot can still be `offline`; it must not flash a
   * disconnected screen over the new attempt.
   */
  isQrAttemptActive?: boolean;
  isPhoneNumber?: boolean;
  phoneSent?: boolean;
}

const disconnectedCodes = new Set<ECodeMessage>([
  ECodeMessage.loggedOut,
  ECodeMessage.connectionClosed,
  ECodeMessage.connectionLost,
  ECodeMessage.connectionReplaced,
  ECodeMessage.badSession,
  ECodeMessage.multideviceMismatch,
]);

export function normalizeWorkerConnectionModalState(
  state: Partial<IBaileysConnectionState>,
  context: NormalizeWorkerConnectionModalStateContext = {}
): WorkerConnectionModalState {
  const status = state.status as EBaileysConnectionStatus | undefined;
  const code = state.code as ECodeMessage | undefined;
  const hasExceededQrAttempts =
    typeof state.attempt === 'number' &&
    typeof state.max_attempts === 'number' &&
    state.max_attempts > 0 &&
    state.attempt > state.max_attempts;
  const nativeStatus = state.connection_status?.status;

  // A protected PostgreSQL handoff never asks the operator to pair a new
  // device. Provider QR/pairing/logout/terminal snapshots during this window
  // belong to an unpromoted target or the draining source and are not
  // authorization to leave the migration flow. The caller releases this
  // context only after a durable target or source-recovery decision; that
  // callback replaces this informational dialog with protected recovery UI.
  if (context.isSessionMigration) {
    return 'migrating';
  }

  // Outside a protected handoff, a lifecycle terminal error is authoritative
  // even when the worker has not published a provider-native snapshot.
  if (state.worker_status_id === EWorkerStatus.error) {
    return 'disconnected';
  }

  if (code === ECodeMessage.logoutInProgress) {
    return 'loggingOut';
  }

  if (context.isResetting) {
    return 'resetting';
  }

  if (code === ECodeMessage.phoneNotAvailable) {
    return 'phoneUnavailable';
  }

  if (hasExceededQrAttempts) {
    return 'disconnected';
  }

  if (
    nativeStatus === undefined &&
    (status === EBaileysConnectionStatus.connected ||
      code === ECodeMessage.connectionEstablished)
  ) {
    return 'connected';
  }

  if (context.isPhoneNumber && !context.phoneSent) {
    return 'phoneInput';
  }

  if (
    code === ECodeMessage.pairingInProgress ||
    code === ECodeMessage.newLoginAttempt
  ) {
    return 'pairingInProgress';
  }

  if (code === ECodeMessage.awaitingPairingCode) {
    return 'pairing';
  }

  if (code === ECodeMessage.awaitingPasskey || state.passkey_public_key) {
    return 'passkeyRequired';
  }

  if (
    code === ECodeMessage.awaitingPasskeyConfirmation ||
    state.passkey_confirmation_code
  ) {
    return 'passkeyConfirmation';
  }

  // A QR request is optimistic only until its manager ACK, then remains
  // attempt-scoped until a QR, pairing transition or terminal publication is
  // accepted. Preserve that active window over an older native `offline`
  // checkpoint. Terminal reducers clear these attempt fields before this
  // normalizer runs, so real disconnects and exhausted attempts still win.
  if (
    context.isQrAttemptActive === true &&
    (state.qr_pending === true ||
      code === ECodeMessage.awaitingReadQrCode ||
      Boolean(state.qrcode))
  ) {
    return state.qrcode ? 'qrReady' : 'qrPreparing';
  }

  // The accepted provider-native snapshot is monotonic and therefore wins
  // over legacy status, code and QR fields left by an older publication.
  // Explicit user-action and lifecycle states above remain more specific.
  if (nativeStatus === EWhatsappConnectionStatus.qr) {
    return state.qrcode ? 'qrReady' : 'qrPreparing';
  }

  if (
    nativeStatus === EWhatsappConnectionStatus.offline ||
    nativeStatus === EWhatsappConnectionStatus.loggedOut ||
    nativeStatus === EWhatsappConnectionStatus.invalidSession ||
    nativeStatus === EWhatsappConnectionStatus.conflict ||
    nativeStatus === EWhatsappConnectionStatus.leaseLost ||
    nativeStatus === EWhatsappConnectionStatus.stopped ||
    nativeStatus === EWhatsappConnectionStatus.error
  ) {
    return 'disconnected';
  }

  if (
    (nativeStatus === EWhatsappConnectionStatus.initializing ||
      nativeStatus === EWhatsappConnectionStatus.restoring ||
      nativeStatus === EWhatsappConnectionStatus.connecting) &&
    state.connection_status?.authenticated !== true &&
    state.connection_status?.sessionValid !== true &&
    state.connection_status?.qrAvailable === false
  ) {
    return 'qrPreparing';
  }

  // A non-preserving lifecycle may still need the ordinary connection UI.
  // Protected handoffs have already returned above.
  if (state.worker_status_id === EWorkerStatus.recreating) {
    return context.isDestructiveReset === false ? 'starting' : 'resetting';
  }

  if (nativeStatus !== undefined) {
    if (
      nativeStatus === EWhatsappConnectionStatus.online &&
      (status === EBaileysConnectionStatus.connected ||
        code === ECodeMessage.connectionEstablished)
    ) {
      return 'connected';
    }

    return 'starting';
  }

  if (
    status === EBaileysConnectionStatus.disconnected ||
    (code !== undefined && disconnectedCodes.has(code))
  ) {
    return 'disconnected';
  }

  if (state.qrcode) {
    return 'qrReady';
  }

  if (code === ECodeMessage.awaitingReadQrCode || state.qr_pending === true) {
    return 'qrPreparing';
  }

  return 'starting';
}
