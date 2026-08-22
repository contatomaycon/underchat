import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';

interface WhatsappQrAttemptExhaustedState {
  attempt?: number;
  max_attempts?: number;
  connection_attempt_id?: string;
  status?: EBaileysConnectionStatus | string;
  code?: ECodeMessage | number;
}

/**
 * Identifies the explicit, attempt-scoped terminal emitted only after the
 * provider has exhausted its complete QR generation budget. This boundary is
 * deliberately stronger than a generic disconnect: it is safe to evict the
 * cached QR and release exactly the matching active attempt.
 */
export function isWhatsappQrAttemptExhaustedState(
  state: WhatsappQrAttemptExhaustedState | Record<string, unknown>
): boolean {
  const candidate = state as WhatsappQrAttemptExhaustedState;
  const connectionAttemptId = candidate.connection_attempt_id?.trim();

  return Boolean(
    connectionAttemptId &&
    candidate.status === EBaileysConnectionStatus.disconnected &&
    candidate.code === ECodeMessage.connectionClosed &&
    typeof candidate.attempt === 'number' &&
    Number.isSafeInteger(candidate.attempt) &&
    typeof candidate.max_attempts === 'number' &&
    Number.isSafeInteger(candidate.max_attempts) &&
    candidate.max_attempts > 0 &&
    candidate.attempt > candidate.max_attempts
  );
}
