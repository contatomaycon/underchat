import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';

export interface IResolveCallEventJidAndPhoneInput {
  chatId?: string | null;
  from?: string | null;
  caller?: string | null;
  callerPn?: string | null;
}

export interface IResolvedCallEventJidAndPhone {
  callJid: string | null;
  callPhone: string | null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePhoneDigits(value: unknown): string | null {
  const input = toNonEmptyString(value);
  if (!input) {
    return null;
  }

  const digits = input.replaceAll(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function isValidJidCandidate(value: string | null): value is string {
  return !!value && value.includes('@');
}

export function resolveCallEventJidAndPhone(
  input: IResolveCallEventJidAndPhoneInput
): IResolvedCallEventJidAndPhone {
  const from = toNonEmptyString(input.from);
  const chatId = toNonEmptyString(input.chatId);
  const caller = toNonEmptyString(input.caller);

  const callJidCandidates = [from, chatId, caller];
  const callJid =
    callJidCandidates.find((candidate) => isValidJidCandidate(candidate)) ??
    null;

  if (!callJid) {
    return {
      callJid: null,
      callPhone: null,
    };
  }

  const callPhone =
    sanitizePhoneDigits(getPhoneFromJid(chatId, from)) ??
    sanitizePhoneDigits(getPhoneFromJid(from, chatId)) ??
    sanitizePhoneDigits(input.callerPn);

  return {
    callJid,
    callPhone,
  };
}
