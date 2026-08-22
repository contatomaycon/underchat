import { createHash, randomBytes } from 'node:crypto';

export function v7(options?: { msecs?: number }): string {
  const timestamp = options?.msecs ?? Date.now();
  const bytes = Buffer.alloc(16);
  const random = randomBytes(10);
  bytes.writeUIntBE(timestamp, 0, 6);
  bytes[6] = 0x70 | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = 0x80 | (random[2] & 0x3f);
  random.copy(bytes, 9, 3);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const v5Implementation = (value: string, namespace: string): string => {
  const digest = createHash('sha1')
    .update(`${namespace}:${value}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  digest[12] = '5';
  digest[16] = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  const hex = digest.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const v5 = Object.assign(v5Implementation, {
  URL: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
});
