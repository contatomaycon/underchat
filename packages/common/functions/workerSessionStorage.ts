import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';
import { EWorkerType } from '../enums/EWorkerType';

const postgresSessionWorkerTypes = new Set<EWorkerType>([
  EWorkerType.baileys,
  EWorkerType.wwebjs,
  EWorkerType.whatsmeow,
]);

export const supportsWhatsappSessionStorage = (
  workerType: string | null | undefined
): boolean => postgresSessionWorkerTypes.has(workerType as EWorkerType);

export const defaultWorkerSessionStorage = (
  workerType: EWorkerType
): EWorkerSessionStorage =>
  supportsWhatsappSessionStorage(workerType)
    ? EWorkerSessionStorage.postgres
    : EWorkerSessionStorage.legacy_volume;
