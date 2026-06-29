import { EWorkerType } from '../enums/EWorkerType';

export const isOfficialWhatsappWorker = (
  workerTypeId?: string | null
): boolean => workerTypeId === EWorkerType.whatsapp;

export const assertNonOfficialRuntimeFeature = (
  workerTypeId: string | null | undefined,
  message = 'whatsapp_official_runtime_action_not_supported'
): void => {
  if (isOfficialWhatsappWorker(workerTypeId)) {
    throw new Error(message);
  }
};

export const hasWorkerConfigProxyFields = (
  input: Record<string, unknown>
): boolean =>
  [
    'proxy_enabled',
    'proxy_protocol',
    'proxy_host',
    'proxy_port',
    'proxy_username',
    'proxy_password',
  ].some((field) => Object.prototype.hasOwnProperty.call(input, field));
