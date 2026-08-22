import { ECodeMessage } from '../enums/ECodeMessage';
import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { EWhatsappConnectionStatus } from '../enums/EWhatsappConnectionStatus';

interface WhatsappQrCredentialConsumedState {
  code?: ECodeMessage | number;
  status?: EBaileysConnectionStatus | string;
  is_new_login?: boolean;
  connection_status?: {
    status?: EWhatsappConnectionStatus | string;
    authenticated?: boolean;
    sessionValid?: boolean | null;
    qrAvailable?: boolean;
  } | null;
}

const AUTHENTICATED_NON_QR_STATES = new Set<string>([
  EWhatsappConnectionStatus.initializing,
  EWhatsappConnectionStatus.restoring,
  EWhatsappConnectionStatus.connecting,
  EWhatsappConnectionStatus.reconnecting,
  EWhatsappConnectionStatus.handoff,
  EWhatsappConnectionStatus.online,
]);

/**
 * Returns true only when the provider has positively acknowledged that the
 * credential shown for the current QR attempt was consumed. This is stronger
 * than a generic `connecting` event and is safe to use for invalidating a
 * cached QR after the caller has validated attempt/type/generation fences.
 */
export function isWhatsappQrCredentialConsumedState(
  state: WhatsappQrCredentialConsumedState | Record<string, unknown>
): boolean {
  const candidate = state as WhatsappQrCredentialConsumedState;
  if (
    candidate.code === ECodeMessage.pairingInProgress ||
    candidate.code === ECodeMessage.newLoginAttempt
  ) {
    return true;
  }

  const snapshot = candidate.connection_status;
  return Boolean(
    snapshot &&
    typeof snapshot.status === 'string' &&
    AUTHENTICATED_NON_QR_STATES.has(snapshot.status) &&
    snapshot.authenticated === true &&
    snapshot.sessionValid === true &&
    snapshot.qrAvailable === false
  );
}

/**
 * Returns true while a QR connection attempt is only being prepared or shown.
 * Generic provider startup (`connecting`/203) is not proof that the user read
 * the QR credential. Callers use this to avoid briefly presenting the
 * post-scan "connecting" state before explicit credential-consumption
 * evidence arrives.
 */
export function isWhatsappQrCredentialPendingState(
  state: WhatsappQrCredentialConsumedState | Record<string, unknown>
): boolean {
  const candidate = state as WhatsappQrCredentialConsumedState;
  if (isWhatsappQrCredentialConsumedState(candidate)) {
    return false;
  }

  return (
    candidate.status === EBaileysConnectionStatus.connecting &&
    (candidate.code === undefined ||
      candidate.code === ECodeMessage.awaitingReadQrCode ||
      candidate.code === ECodeMessage.awaitConnection)
  );
}
