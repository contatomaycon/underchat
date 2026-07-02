import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';

export interface WorkerConnectionReducerResult {
  state: Partial<IBaileysConnectionState>;
  ignored: boolean;
  reason?: string;
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
  incoming: Partial<IBaileysConnectionState>
): WorkerConnectionReducerResult {
  const currentAttempt = current.connection_attempt_id;
  const incomingAttempt = incoming.connection_attempt_id;
  const attemptMismatch =
    Boolean(currentAttempt) &&
    Boolean(incomingAttempt) &&
    currentAttempt !== incomingAttempt;

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
  } else if (shouldClearQr(incoming)) {
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
  } else {
    if (current.passkey_public_key) {
      next.passkey_public_key = current.passkey_public_key;
      next.passkey_pending = current.passkey_pending;
    }
    if (current.passkey_confirmation_code) {
      next.passkey_confirmation_code = current.passkey_confirmation_code;
      next.passkey_skip_handoff_ux = current.passkey_skip_handoff_ux;
    }
  }

  return {
    state: next,
    ignored: false,
  };
}
