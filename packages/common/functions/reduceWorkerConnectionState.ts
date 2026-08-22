import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';

export interface WorkerConnectionReducerResult {
  state: Partial<IBaileysConnectionState>;
  ignored: boolean;
  reason?: string;
}

export interface WorkerConnectionReducerOptions {
  /**
   * The incoming envelope was projected from a newly accepted, ordered
   * provider-native snapshot. Such a transition is stronger evidence than
   * legacy QR preservation heuristics, while the default remains conservative
   * for unordered legacy publications.
   */
  authoritativeNativeTransition?: boolean;
  /**
   * The provider recycled its internal client before the credential was
   * consumed, but the publication still belongs to the current QR attempt.
   * Keep the last image visible until a replacement or terminal arrives.
   */
  preserveQrDuringActiveAttempt?: boolean;
}

const userActionCodes = new Set<ECodeMessage>([
  ECodeMessage.awaitingReadQrCode,
  ECodeMessage.awaitingPairingCode,
  ECodeMessage.awaitingPasskey,
  ECodeMessage.awaitingPasskeyConfirmation,
  ECodeMessage.pairingInProgress,
  ECodeMessage.newLoginAttempt,
]);

const qrClearingCodes = new Set<ECodeMessage>([
  ECodeMessage.connectionEstablished,
  ECodeMessage.pairingInProgress,
  ECodeMessage.newLoginAttempt,
  ECodeMessage.logoutInProgress,
  ECodeMessage.loggedOut,
  ECodeMessage.connectionLost,
  ECodeMessage.connectionClosed,
  ECodeMessage.connectionReplaced,
  ECodeMessage.badSession,
  ECodeMessage.multideviceMismatch,
  ECodeMessage.phoneNotAvailable,
]);

function isStartupWithoutQr(state: Partial<IBaileysConnectionState>): boolean {
  return (
    state.code === ECodeMessage.awaitConnection &&
    !state.qrcode &&
    state.qr_pending !== true
  );
}

function shouldClearQr(state: Partial<IBaileysConnectionState>): boolean {
  return (
    state.status === EBaileysConnectionStatus.connected ||
    state.status === EBaileysConnectionStatus.disconnected ||
    (state.code !== undefined && qrClearingCodes.has(state.code))
  );
}

function hasUserCredential(state: Partial<IBaileysConnectionState>): boolean {
  return Boolean(
    state.qrcode ||
    state.pairing_code ||
    state.passkey_public_key ||
    state.passkey_confirmation_code
  );
}

function isSuccessfulTerminal(
  state: Partial<IBaileysConnectionState>
): boolean {
  return (
    state.status === EBaileysConnectionStatus.connected ||
    state.code === ECodeMessage.connectionEstablished
  );
}

function protectsUserAction(
  current: Partial<IBaileysConnectionState>
): boolean {
  return (
    hasUserCredential(current) ||
    current.status === EBaileysConnectionStatus.connected ||
    (current.code !== undefined && userActionCodes.has(current.code))
  );
}

export function reduceWorkerConnectionState(
  current: Partial<IBaileysConnectionState>,
  incoming: Partial<IBaileysConnectionState>,
  options: WorkerConnectionReducerOptions = {}
): WorkerConnectionReducerResult {
  const preserveLegacyCredential =
    options.authoritativeNativeTransition !== true;
  const authoritativeNativeClearsQr =
    options.authoritativeNativeTransition === true &&
    options.preserveQrDuringActiveAttempt !== true &&
    incoming.connection_status?.status !== undefined &&
    incoming.connection_status.status !== 'qr';
  const currentAttempt = current.connection_attempt_id;
  const incomingAttempt = incoming.connection_attempt_id;
  const attemptMismatch =
    Boolean(currentAttempt) &&
    Boolean(incomingAttempt) &&
    currentAttempt !== incomingAttempt;
  const sameOrUnknownAttempt =
    !currentAttempt || !incomingAttempt || currentAttempt === incomingAttempt;

  // An explicit attempt mismatch is a hard fence even for an otherwise
  // authoritative native snapshot. Native ordering can invalidate stale QR
  // data inside the same attempt, but it cannot cross into another pairing
  // lifecycle.
  if (attemptMismatch && isSuccessfulTerminal(incoming)) {
    return {
      state: current,
      ignored: true,
      reason: 'attempt_mismatch_connected',
    };
  }

  if (
    attemptMismatch &&
    hasUserCredential(current) &&
    !hasUserCredential(incoming) &&
    !isSuccessfulTerminal(incoming)
  ) {
    return {
      state: current,
      ignored: true,
      reason: shouldClearQr(incoming)
        ? 'attempt_mismatch_terminal_without_qr'
        : 'attempt_mismatch_without_qr',
    };
  }

  if (
    preserveLegacyCredential &&
    isStartupWithoutQr(incoming) &&
    protectsUserAction(current) &&
    !shouldClearQr(incoming)
  ) {
    return {
      state: current,
      ignored: true,
      reason: 'stale_startup_without_qr',
    };
  }

  if (
    preserveLegacyCredential &&
    current.qrcode &&
    !incoming.qrcode &&
    incoming.qr_pending === true &&
    !shouldClearQr(incoming)
  ) {
    return {
      state: current,
      ignored: true,
      reason: 'pending_without_qr_after_qr',
    };
  }

  const next: Partial<IBaileysConnectionState> = {
    ...current,
    ...incoming,
  };

  if (incoming.qrcode) {
    next.qrcode = incoming.qrcode;
    next.qr_pending = false;
    if (!sameOrUnknownAttempt) {
      delete next.passkey_public_key;
      delete next.passkey_confirmation_code;
      delete next.passkey_pending;
      delete next.passkey_skip_handoff_ux;
    }
  } else if (shouldClearQr(incoming) || authoritativeNativeClearsQr) {
    delete next.qrcode;
  } else if (current.qrcode) {
    next.qrcode = current.qrcode;
  }

  if (incoming.passkey_public_key) {
    next.passkey_public_key = incoming.passkey_public_key;
    next.passkey_pending = incoming.passkey_pending ?? true;
    delete next.qrcode;
    delete next.pairing_code;
    delete next.passkey_confirmation_code;
  } else if (incoming.passkey_confirmation_code) {
    next.passkey_confirmation_code = incoming.passkey_confirmation_code;
    next.passkey_skip_handoff_ux = incoming.passkey_skip_handoff_ux;
    next.passkey_pending = false;
    delete next.qrcode;
    delete next.pairing_code;
    delete next.passkey_public_key;
  } else if (incoming.pairing_code) {
    delete next.passkey_public_key;
    delete next.passkey_confirmation_code;
    delete next.passkey_pending;
    delete next.passkey_skip_handoff_ux;
  } else if (shouldClearQr(incoming)) {
    delete next.passkey_public_key;
    delete next.passkey_confirmation_code;
    delete next.passkey_pending;
    delete next.passkey_skip_handoff_ux;
  } else if (sameOrUnknownAttempt || !hasUserCredential(incoming)) {
    if (current.passkey_public_key) {
      next.passkey_public_key = current.passkey_public_key;
      next.passkey_pending = current.passkey_pending;
      next.code = ECodeMessage.awaitingPasskey;
      delete next.qrcode;
      delete next.pairing_code;
      delete next.passkey_confirmation_code;
    }
    if (current.passkey_confirmation_code) {
      next.passkey_confirmation_code = current.passkey_confirmation_code;
      next.passkey_skip_handoff_ux = current.passkey_skip_handoff_ux;
      next.code = ECodeMessage.awaitingPasskeyConfirmation;
      next.passkey_pending = false;
      delete next.qrcode;
      delete next.pairing_code;
      delete next.passkey_public_key;
    }
  }

  return {
    state: next,
    ignored: false,
  };
}
