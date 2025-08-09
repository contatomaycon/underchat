import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { EWorkerStatus } from '../enums/EWorkerStatus';

export function getStatusWorkerConnection(
  status: EBaileysConnectionStatus,
  phoneNumber: string | null,
  disconnectedUser?: boolean | null
): EWorkerStatus {
  if (status === EBaileysConnectionStatus.connected) {
    return EWorkerStatus.online;
  }

  if (
    status === EBaileysConnectionStatus.disconnected &&
    !disconnectedUser &&
    phoneNumber
  ) {
    return EWorkerStatus.offline;
  }

  return EWorkerStatus.disponible;
}
