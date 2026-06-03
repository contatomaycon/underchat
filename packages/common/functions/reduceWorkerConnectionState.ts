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

function protectsUserAction(
  current: Partial<IBaileysConnectionState>
): boolean {
  return (
    Boolean(current.qrcode) ||
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

  if (
    attemptMismatch &&
    Boolean(current.qrcode) &&
    !incoming.qrcode &&
    !shouldClearQr(incoming)
  ) {
    return {
      state: current,
      ignored: true,
      reason: 'attempt_mismatch_without_qr',
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

  return {
    state: next,
    ignored: false,
  };
}
