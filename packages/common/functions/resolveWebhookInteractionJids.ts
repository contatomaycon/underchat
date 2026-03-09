import { extractPhoneAndDdi } from './extractPhoneAndDdi';
import { normalizeJid } from './normalizeJid';
import { normalizePhoneToJid } from './normalizePhoneToJid';

export interface IWebhookInteractionJids {
  remoteJid: string;
  remoteJidAlt?: string;
}

interface IResolveWebhookInteractionJidsInput {
  validatedJid?: string | null;
  validatedPhoneWithDdi?: string | null;
  fallbackPhone?: string | null;
  fallbackPhoneDdi?: string | null;
}

function buildPhoneJidFromPhoneWithDdi(
  phoneWithDdi?: string | null
): string | undefined {
  if (!phoneWithDdi) {
    return undefined;
  }

  const extracted = extractPhoneAndDdi(phoneWithDdi);
  if (!extracted) {
    return undefined;
  }

  return normalizePhoneToJid(extracted.phone, extracted.phone_ddi);
}

function buildPhoneJidFromFallback(
  phone?: string | null,
  phoneDdi?: string | null
): string | undefined {
  if (!phone) {
    return undefined;
  }

  return normalizePhoneToJid(phone, phoneDdi ?? null);
}

export function resolveWebhookInteractionJids(
  input: IResolveWebhookInteractionJidsInput
): IWebhookInteractionJids | null {
  const normalizedValidatedJid = normalizeJid(input.validatedJid);
  const validatedJidWithoutLid =
    normalizedValidatedJid && !normalizedValidatedJid.endsWith('@lid')
      ? normalizedValidatedJid
      : undefined;

  const phoneJid =
    buildPhoneJidFromPhoneWithDdi(input.validatedPhoneWithDdi) ??
    buildPhoneJidFromFallback(input.fallbackPhone, input.fallbackPhoneDdi);

  const remoteJid = phoneJid ?? validatedJidWithoutLid;
  if (!remoteJid) {
    return null;
  }

  let remoteJidAlt: string | undefined = undefined;

  if (validatedJidWithoutLid && validatedJidWithoutLid !== remoteJid) {
    remoteJidAlt = validatedJidWithoutLid;
  }

  if (remoteJidAlt === remoteJid) {
    remoteJidAlt = undefined;
  }

  return remoteJidAlt ? { remoteJid, remoteJidAlt } : { remoteJid };
}
