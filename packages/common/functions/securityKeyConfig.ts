import { randomBytes } from 'crypto';
import {
  ISecurityKeyConfig,
  TSecurityKeyScope,
} from '../interfaces/ISecurityKeyConfig';

export const SECURITY_KEY_CODE_LENGTH = 10;
export const SECURITY_KEY_LABEL = 'Chave de segurança';
const SECURITY_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECURITY_KEY_LINE_CORE_PATTERN = `${SECURITY_KEY_LABEL}: [A-Z0-9]{${SECURITY_KEY_CODE_LENGTH}}`;
const SECURITY_KEY_MONOSPACE_MARKER = '```';
const SECURITY_KEY_LINE_FORMAT_PATTERNS = [
  SECURITY_KEY_LINE_CORE_PATTERN,
  `_${SECURITY_KEY_LINE_CORE_PATTERN}_`,
  `${SECURITY_KEY_MONOSPACE_MARKER}${SECURITY_KEY_LINE_CORE_PATTERN}${SECURITY_KEY_MONOSPACE_MARKER}`,
  `> ${SECURITY_KEY_LINE_CORE_PATTERN}`,
  `> _${SECURITY_KEY_LINE_CORE_PATTERN}_`,
  `> ${SECURITY_KEY_MONOSPACE_MARKER}${SECURITY_KEY_LINE_CORE_PATTERN}${SECURITY_KEY_MONOSPACE_MARKER}`,
].join('|');
const SECURITY_KEY_LINE_PATTERN = new RegExp(
  `(^|\\n\\n)(?:${SECURITY_KEY_LINE_FORMAT_PATTERNS})$`
);

export const defaultSecurityKeyConfig = (): ISecurityKeyConfig => ({
  enabled: true,
  chatbot: true,
  schedule: true,
  quick_message: true,
});

export const generateSecurityKeyCode = (): string => {
  const code: string[] = [];
  const maxUnbiasedByte =
    Math.floor(256 / SECURITY_KEY_ALPHABET.length) *
    SECURITY_KEY_ALPHABET.length;

  while (code.length < SECURITY_KEY_CODE_LENGTH) {
    for (const byte of randomBytes(SECURITY_KEY_CODE_LENGTH)) {
      if (byte >= maxUnbiasedByte) {
        continue;
      }

      code.push(SECURITY_KEY_ALPHABET[byte % SECURITY_KEY_ALPHABET.length]);

      if (code.length === SECURITY_KEY_CODE_LENGTH) {
        break;
      }
    }
  }

  return code.join('');
};

export const createSecurityKeyLine = (): string =>
  `> ${SECURITY_KEY_MONOSPACE_MARKER}${SECURITY_KEY_LABEL}: ${generateSecurityKeyCode()}${SECURITY_KEY_MONOSPACE_MARKER}`;

export const appendSecurityKeyToText = (
  message: string,
  options?: { allowSecurityKeyOnly?: boolean }
): string => {
  if (!message.trim()) {
    return options?.allowSecurityKeyOnly ? createSecurityKeyLine() : message;
  }

  if (SECURITY_KEY_LINE_PATTERN.test(message)) {
    return message;
  }

  return `${message}\n\n${createSecurityKeyLine()}`;
};

export const shouldApplySecurityKey = (
  config: ISecurityKeyConfig | null | undefined,
  scopes: TSecurityKeyScope[] | null | undefined
): boolean => {
  if (!config?.enabled || !scopes?.length) {
    return false;
  }

  return scopes.some((scope) => config[scope]);
};
