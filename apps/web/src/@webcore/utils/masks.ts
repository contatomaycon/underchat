import type { MaskInputOptions } from 'maska';

export const ipMask: MaskInputOptions = {
  mask: '#00.#00.#00.#00',
  tokens: {
    0: { pattern: /\d/, optional: true },
  },
  eager: true,
};
