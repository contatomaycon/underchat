import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { EWorkerStatus } from '../enums/EWorkerStatus';

export function getStatusWorkerConnection(
  status: EBaileysConnectionStatus,
  disconnectedUser?: boolean | null
): EWorkerStatus {
  if (status === EBaileysConnectionStatus.connected) {
    return EWorkerStatus.online;
  }

  if (status === EBaileysConnectionStatus.disconnected && !disconnectedUser) {
    return EWorkerStatus.offline;
  }

  return EWorkerStatus.disponible;
}
