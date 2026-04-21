import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { EncryptService } from '@core/services/encrypt.service';
import { generalEnvironment } from '@core/config/environments';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';

describe('EncryptService', () => {
  it('encrypt returns a deterministic hash for same input', () => {
    const service = new EncryptService();

    const first = service.encrypt('abc');
    const second = service.encrypt('abc');

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('hash uses sha256 with configured salts', () => {
    const service = new EncryptService();

    const expected = createHash('sha256')
      .update(
        `${generalEnvironment.cryptoKeyStart}123${generalEnvironment.cryptoKeyEnd}`
      )
      .digest('hex');

    expect(service.hash(123)).toBe(expected);
  });

  it('sanitize uses known strategy and falls back to original for unknown', () => {
    const service = new EncryptService();

    expect(service.sanitize('11999998888', ETypeSanetize.phone)).toContain('*');
    expect(service.sanitize('raw-value', 'unknown' as never)).toBe('raw-value');
  });
});
