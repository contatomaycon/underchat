import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';

describe('logLocalConnectionStatus', () => {
  const originalEnvironment = process.env.APP_ENVIRONMENT;

  afterEach(() => {
    if (originalEnvironment === undefined) {
      delete process.env.APP_ENVIRONMENT;
    } else {
      process.env.APP_ENVIRONMENT = originalEnvironment;
    }
    jest.restoreAllMocks();
  });

  it('uses the shared sanitizer before emitting local lifecycle context', () => {
    process.env.APP_ENVIRONMENT = EAppEnvironment.local;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    logLocalConnectionStatus('test.shared_redaction', {
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

    const payload = JSON.parse(
      String(consoleSpy.mock.calls[0]?.[1] ?? '{}')
    ) as Record<string, unknown>;
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
});
