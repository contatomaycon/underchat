import 'reflect-metadata';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';

function createFailingRedis() {
  return {
    pipeline: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => {
        throw new Error('redis unavailable');
      }),
    })),
  };
}

function decodeDebugPayload(call: unknown[]): Record<string, unknown> {
  const raw = String(call[1] ?? '');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('ConnectionLifecycleDebugService', () => {
  const originalEnabled = process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;
    } else {
      process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = originalEnabled;
    }
    jest.restoreAllMocks();
  });

  it('does not log when lifecycle debug is disabled', async () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'false';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const service = new ConnectionLifecycleDebugService(
      createFailingRedis() as never
    );

    await service.log('test.disabled', { trace_id: 'trace-disabled' });

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('uses local sequence fallback and per-trace ordering', async () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'true';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const service = new ConnectionLifecycleDebugService(
      createFailingRedis() as never
    );
    const traceId = 'trace-fallback-order';

    await service.log('test.first', { trace_id: traceId, layer: 'test' });
    await service.log('test.second', { trace_id: traceId, layer: 'test' });

    const first = decodeDebugPayload(consoleSpy.mock.calls[0]);
    const second = decodeDebugPayload(consoleSpy.mock.calls[1]);

    expect(Number(second.seq)).toBeGreaterThan(Number(first.seq));
    expect(second.trace_seq).toBe(Number(first.trace_seq) + 1);
    expect(second.trace_id).toBe(traceId);
    expect(second.event).toBe('test.second');
  });

  it('redacts raw QR and pairing code values', async () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'true';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const service = new ConnectionLifecycleDebugService(
      createFailingRedis() as never
    );

    await service.log('test.redaction', {
      trace_id: 'trace-redaction',
      qrcode: 'raw-qr-value',
      pairing_code: '123-456',
    });

    const output = JSON.stringify(consoleSpy.mock.calls);
    expect(output).not.toContain('raw-qr-value');
    expect(output).not.toContain('123-456');

    const payload = decodeDebugPayload(consoleSpy.mock.calls[0]);
    expect(payload.has_qr).toBe(true);
    expect(payload.qr_length).toBe('raw-qr-value'.length);
    expect(payload.qr_sha256_12).toEqual(expect.any(String));
    expect(payload.has_pairing_code).toBe(true);
    expect(payload.pairing_code_length).toBe('123-456'.length);
    expect(payload.pairing_code_sha256_12).toEqual(expect.any(String));
  });
});
