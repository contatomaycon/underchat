import { EWorkerImage } from '../enums/EWorkerImage';
import { EWorkerType } from '../enums/EWorkerType';

export function getImageWorker(workerType: EWorkerType) {
  if (workerType === EWorkerType.whatsapp) {
    return EWorkerImage.whatsapp;
  }

  if (workerType === EWorkerType.telegram) {
    return EWorkerImage.telegram;
  }

  if (workerType === EWorkerType.discord) {
    return EWorkerImage.discord;
  }

  if (workerType === EWorkerType.wwebjs) {
    return EWorkerImage.wwebjs;
  }

  if (workerType === EWorkerType.whatsmeow) {
    return EWorkerImage.whatsmeow;
  }

  return EWorkerImage.baileys;
}
