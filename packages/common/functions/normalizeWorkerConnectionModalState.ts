import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';

export type WorkerConnectionModalState =
  | 'starting'
  | 'qrPreparing'
  | 'qrReady'
  | 'connected'
  | 'loggingOut'
  | 'resetting'
  | 'disconnected'
  | 'phoneUnavailable'
  | 'phoneInput'
  | 'pairing';

export interface NormalizeWorkerConnectionModalStateContext {
  isResetting?: boolean;
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

  if (code === ECodeMessage.logoutInProgress) {
    return 'loggingOut';
  }

  if (
    context.isResetting ||
    state.worker_status_id === EWorkerStatus.recreating
  ) {
    return 'resetting';
  }

  if (code === ECodeMessage.phoneNotAvailable) {
    return 'phoneUnavailable';
  }

  if (
    status === EBaileysConnectionStatus.connected ||
    code === ECodeMessage.connectionEstablished
  ) {
    return 'connected';
  }

  if (context.isPhoneNumber && !context.phoneSent) {
    return 'phoneInput';
  }

  if (code === ECodeMessage.awaitingPairingCode) {
    return 'pairing';
  }

  if (code === ECodeMessage.awaitingReadQrCode && state.qrcode) {
    return 'qrReady';
  }

  if (code === ECodeMessage.awaitingReadQrCode) {
    return 'qrPreparing';
  }

  if (
    status === EBaileysConnectionStatus.disconnected ||
    (code !== undefined && disconnectedCodes.has(code))
  ) {
    return 'disconnected';
  }

  return 'starting';
}
