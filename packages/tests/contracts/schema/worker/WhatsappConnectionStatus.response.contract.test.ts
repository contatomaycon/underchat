import { Value } from '@sinclair/typebox/value';
import {
  whatsappConnectionStatusSchema,
  whatsappConnectionStatusOrderSchema,
  whatsappConnectionStatusSourceIdSchema,
} from '@core/schema/common/whatsappConnectionStatus.schema';

const snapshot = {
  provider: 'whatsmeow',
  status: 'online',
  connected: true,
  authenticated: true,
  sessionValid: true,
  recoverable: true,
  qrAvailable: false,
  sequence: 1,
  changedAt: '2026-08-04T12:00:00.000Z',
  reason: 'connection_validated',
};

describe('WhatsApp native connection response schema', () => {
  it('accepts the canonical secret-free snapshot and source UUID', () => {
    expect(Value.Check(whatsappConnectionStatusSchema, snapshot)).toBe(true);
    expect(
      Value.Check(
        whatsappConnectionStatusSourceIdSchema,
        '11111111-1111-4111-8111-111111111111'
      )
    ).toBe(true);
    expect(
      Value.Check(
        whatsappConnectionStatusSourceIdSchema,
        '019fccbb-05eb-7126-bb30-fc6bf21226a8'
      )
    ).toBe(true);
  });

  it.each([
    { ...snapshot, sequence: -1 },
    { ...snapshot, sequence: 0 },
    { ...snapshot, sequence: 1.5 },
    { ...snapshot, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...snapshot, reason: 'raw error with credentials' },
  ])('rejects an unsafe or non-monotonic wire snapshot', (value) => {
    expect(Value.Check(whatsappConnectionStatusSchema, value)).toBe(false);
  });

  it('rejects a non-UUID source identifier', () => {
    expect(
      Value.Check(whatsappConnectionStatusSourceIdSchema, 'client-1')
    ).toBe(false);
  });

  it('carries the durable bigint order only as a lossless decimal string', () => {
    expect(
      Value.Check(whatsappConnectionStatusOrderSchema, '9223372036854775807')
    ).toBe(true);
    expect(Value.Check(whatsappConnectionStatusOrderSchema, 42)).toBe(false);
    expect(Value.Check(whatsappConnectionStatusOrderSchema, '01')).toBe(false);
  });
});
