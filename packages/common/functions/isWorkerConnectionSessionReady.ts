import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';
import { isWhatsappConnectionOnline } from './whatsappConnectionStatus';

export function isWorkerConnectionSessionReady(
  state: Partial<IBaileysConnectionState>
): boolean {
  const providerState = state.provider_state?.trim().toLowerCase();
  const unofficial =
    state.worker_type_id === EWorkerType.baileys ||
    state.worker_type_id === EWorkerType.wwebjs ||
    state.worker_type_id === EWorkerType.whatsmeow;

  return (
    state.status === EBaileysConnectionStatus.connected &&
    state.code === ECodeMessage.connectionEstablished &&
    state.worker_status_id === EWorkerStatus.online &&
    state.session_ready === true &&
    state.authenticated === true &&
    state.can_send === true &&
    state.can_receive_runtime === true &&
    !state.degraded_reason &&
    (!providerState ||
      providerState === 'connected' ||
      providerState === 'open' ||
      providerState === 'online') &&
    Boolean(state.phone?.trim()) &&
    (!unofficial ||
      (state.connection_online_acknowledged === true &&
        isWhatsappConnectionOnline(state.connection_status)))
  );
}
