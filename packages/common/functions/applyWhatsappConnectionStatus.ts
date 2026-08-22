import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '../enums/EWhatsappConnectionStatus';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';
import { IWhatsappConnectionStatus } from '../interfaces/IWhatsappConnectionStatus';
import { isWhatsappConnectionOnline } from './whatsappConnectionStatus';

/**
 * Projects provider-native truth onto the legacy UI envelope. It never turns
 * provider ONLINE into channel ONLINE until the fenced runtime and Kafka
 * readiness fields have also been centrally acknowledged.
 */
export function applyWhatsappConnectionStatus(
  input: IBaileysConnectionState,
  snapshot: IWhatsappConnectionStatus
): IBaileysConnectionState {
  const result: IBaileysConnectionState = {
    ...input,
    connection_status: snapshot,
    provider_state: snapshot.status,
    authenticated: snapshot.authenticated,
  };

  // A provider-native transition away from QR is ordered and authoritative.
  // Never let a QR image/pending bit from the previous snapshot survive it.
  // The connection-attempt fence is validated before this projection is
  // applied, so clearing here cannot affect a neighbouring session/attempt.
  if (snapshot.status !== EWhatsappConnectionStatus.qr) {
    delete result.qrcode;
    result.qr_pending = false;
  }
  const centralOnline =
    isWhatsappConnectionOnline(snapshot) &&
    input.worker_status_id === EWorkerStatus.online &&
    input.session_ready === true &&
    input.can_send === true &&
    input.can_receive_runtime === true &&
    input.authenticated === true &&
    input.connection_online_acknowledged === true &&
    Boolean(input.phone?.trim());

  if (centralOnline) {
    result.status = EBaileysConnectionStatus.connected;
    result.code = ECodeMessage.connectionEstablished;
    return result;
  }

  result.session_ready = false;
  result.can_send = false;
  result.can_receive_runtime = false;

  switch (snapshot.status) {
    case EWhatsappConnectionStatus.qr:
      result.status = EBaileysConnectionStatus.connecting;
      result.code = ECodeMessage.awaitingReadQrCode;
      result.qr_pending = snapshot.qrAvailable;
      break;
    case EWhatsappConnectionStatus.loggedOut:
      result.status = EBaileysConnectionStatus.disconnected;
      result.code = ECodeMessage.loggedOut;
      result.disconnected_user = true;
      break;
    case EWhatsappConnectionStatus.invalidSession:
      result.status = EBaileysConnectionStatus.disconnected;
      result.code = ECodeMessage.badSession;
      break;
    case EWhatsappConnectionStatus.conflict:
      result.status = EBaileysConnectionStatus.disconnected;
      result.code = ECodeMessage.connectionReplaced;
      break;
    case EWhatsappConnectionStatus.leaseLost:
    case EWhatsappConnectionStatus.stopped:
      result.status = EBaileysConnectionStatus.disconnected;
      result.code = ECodeMessage.connectionClosed;
      break;
    case EWhatsappConnectionStatus.offline:
    case EWhatsappConnectionStatus.error:
      result.status = EBaileysConnectionStatus.disconnected;
      result.code = ECodeMessage.connectionLost;
      break;
    case EWhatsappConnectionStatus.reconnecting:
    case EWhatsappConnectionStatus.initializing:
    case EWhatsappConnectionStatus.restoring:
    case EWhatsappConnectionStatus.connecting:
    case EWhatsappConnectionStatus.handoff:
    case EWhatsappConnectionStatus.online:
      result.status = EBaileysConnectionStatus.connecting;
      // Keep the provider's more specific post-scan state. Replacing it with
      // awaitConnection would make the QR cache look authoritative again and
      // hide the pairing transition from both connection surfaces.
      result.code =
        input.code === ECodeMessage.pairingInProgress ||
        input.code === ECodeMessage.newLoginAttempt
          ? input.code
          : ECodeMessage.awaitConnection;
      break;
  }
  return result;
}
