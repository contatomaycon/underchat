import type { MaskInputOptions } from 'maska';

export const ipMask: MaskInputOptions = {
  mask: '#00.#00.#00.#00',
  tokens: {
    0: { pattern: /\d/, optional: true },
  },
  eager: true,
};

export const cnpjAlphanumericMask: MaskInputOptions = {
  mask: 'SS.SSS.SSS/SSSS-##',
  tokens: {
    S: {
      pattern: /[a-zA-Z0-9]/,
      transform: (character) => character.toUpperCase(),
    },
  },
};
