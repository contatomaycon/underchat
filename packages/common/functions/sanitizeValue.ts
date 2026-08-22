import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { normalizeCnpj } from '@core/common/functions/validateCnpj';

export const sanitizationMap: Record<ETypeSanetize, (value: string) => string> =
  {
    [ETypeSanetize.document]: (value) => {
      const cleaned = value.replaceAll(/\D/g, '');
      const cnpj = normalizeCnpj(value);

      if (cleaned.length === 11) {
        return `${cleaned.slice(0, 3)}.***.***-${cleaned.slice(-2)}`;
      }

      if (/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) {
        return `${cnpj.slice(0, 2)}.***.***/****-${cnpj.slice(-2)}`;
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
      const cleaned = value.replaceAll(/\D/g, '');

      if (!cleaned || cleaned.length === 0) {
        return value;
      }

      if (cleaned.length === 11) {
        const ddd = cleaned.slice(0, 2);
        const last4 = cleaned.slice(-4);
        return `(${ddd}) *****-${last4}`;
      }

      if (cleaned.length === 10) {
        const ddd = cleaned.slice(0, 2);
        const last4 = cleaned.slice(-4);
        return `(${ddd}) ****-${last4}`;
      }

      if (cleaned.length >= 8) {
        const ddd = cleaned.length >= 10 ? cleaned.slice(0, 2) : '';
        const last4 = cleaned.slice(-4);
        const maskLength = cleaned.length - (ddd ? 2 : 0) - 4;
        const mask = '*'.repeat(Math.max(0, maskLength));

        if (ddd) {
          return `(${ddd}) ${mask}-${last4}`;
        }
        return `${mask}-${last4}`;
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
