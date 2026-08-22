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
  const originalWhatsappSessionDebug =
    process.env.WHATSAPP_SESSION_DEBUG_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;
    } else {
      process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = originalEnabled;
    }
    if (originalWhatsappSessionDebug === undefined) {
      delete process.env.WHATSAPP_SESSION_DEBUG_ENABLED;
    } else {
      process.env.WHATSAPP_SESSION_DEBUG_ENABLED = originalWhatsappSessionDebug;
    }
    jest.restoreAllMocks();
  });

  it('does not log when lifecycle debug is disabled', async () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'false';
    process.env.WHATSAPP_SESSION_DEBUG_ENABLED = 'false';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const service = new ConnectionLifecycleDebugService(
      createFailingRedis() as never
    );

    await service.log('test.disabled', { trace_id: 'trace-disabled' });

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('enables end-to-end lifecycle logs with WhatsApp session debug', async () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'false';
    process.env.WHATSAPP_SESSION_DEBUG_ENABLED = 'true';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const service = new ConnectionLifecycleDebugService(
      createFailingRedis() as never
    );

    await service.log('wwebjs.qr_stream.received', {
      trace_id: 'trace-whatsapp-session-debug',
      worker_id: '019fccbb-5447-718c-bb95-71782a995e54',
      stage: 'qr_request_claimed',
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[connection-lifecycle-debug]',
      expect.stringContaining('wwebjs.qr_stream.received')
    );
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
    expect(payload.qrcode).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
    expect(payload.pairing_code).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
  });

  it('uses the shared sanitizer for identifiers, locations and errors', async () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'true';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const service = new ConnectionLifecycleDebugService(
      createFailingRedis() as never
    );

    await service.log('test.shared_redaction', {
      trace_id: 'trace-shared-redaction',
      phone: '5511999999999',
      jid: '5511999999999@s.whatsapp.net',
      database_url: 'postgres://user:password@db.internal/underchat',
      qrcode: 'secret-qr-value',
      passkey_response: '{"signature":"secret-signature"}',
      error: new Error('postgres://error-user:error-pass@db/error'),
      reason: 'postgres://reason-user:reason-pass@db/reason',
    });

    const output = JSON.stringify(consoleSpy.mock.calls);
    for (const secret of [
      '5511999999999',
      'user:password',
      'secret-qr-value',
      'secret-signature',
      'error-user:error-pass',
      'reason-user:reason-pass',
    ]) {
      expect(output).not.toContain(secret);
    }

    const payload = decodeDebugPayload(consoleSpy.mock.calls[0]);
    expect(payload.phone).toMatch(/^sha256:/);
    expect(payload.jid).toMatch(/^sha256:/);
    expect(payload.database_url).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
    expect(payload.qrcode).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
    expect(payload.passkey_response).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
    expect(payload.error).toEqual({
      error_name: 'error',
      error_code: 'unclassified_error',
    });
    expect(payload.reason).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
  });

  it('hashes an unsafe externally supplied trace id before Redis or stdout', async () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'true';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const redis = createFailingRedis();
    const service = new ConnectionLifecycleDebugService(redis as never);

    await service.log('test.trace_redaction', {
      trace_id: 'postgres://trace-user:trace-pass@db/trace',
    });

    const output = JSON.stringify(consoleSpy.mock.calls);
    expect(output).not.toContain('trace-user:trace-pass');
    const payload = decodeDebugPayload(consoleSpy.mock.calls[0]);
    expect(payload.trace_id).toMatch(/^trace_sha256_[0-9a-f]{64}$/);
    const pipeline = redis.pipeline.mock.results[0]?.value;
    expect(pipeline.incr).toHaveBeenCalledWith(
      expect.stringMatching(/trace_sha256_[0-9a-f]{64}$/)
    );
  });
});
