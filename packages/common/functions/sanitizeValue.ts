import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';

export const sanitizationMap: Record<ETypeSanetize, (value: string) => string> =
  {
    [ETypeSanetize.document]: (value) => {
      const cleaned = value.replace(/\D/g, '');

      if (cleaned.length === 11) {
        return `${cleaned.slice(0, 3)}.***.***-${cleaned.slice(-2)}`;
      }

      if (cleaned.length === 14) {
        return `${cleaned.slice(0, 2)}.***.***/****-${cleaned.slice(-2)}`;
      }

      return (
        '*'.repeat(Math.ceil(value.length / 2)) +
        value.slice(Math.ceil(value.length / 2))
      );
    },

    [ETypeSanetize.email]: (value) => {
      const [localPart, domain] = value.split('@');
      if (!domain || localPart.length < 3) return '*'.repeat(value.length);

      const visibleChars = Math.max(1, Math.floor(localPart.length / 2));
      return `${localPart.slice(0, visibleChars)}${'*'.repeat(localPart.length - visibleChars)}@${domain}`;
    },

    [ETypeSanetize.phone]: (value) => {
      const cleaned = value.replace(/\D/g, '');

      if (cleaned.length === 11) {
        return `(${cleaned.slice(0, 2)}) *****-${cleaned.slice(-4)}`;
      }

      return (
        '*'.repeat(Math.ceil(value.length / 2)) +
        value.slice(Math.ceil(value.length / 2))
      );
    },

    [ETypeSanetize.other]: (value) => {
      const length = value.length;
      const maskCount = Math.ceil(length * 0.25);

      if (maskCount * 2 >= length) {
        return '*'.repeat(length);
      }

      const startMask = '*'.repeat(maskCount);
      const endMask = '*'.repeat(maskCount);
      const middle = value.slice(maskCount, length - maskCount);

      return `${startMask}${middle}${endMask}`;
    },
  };
