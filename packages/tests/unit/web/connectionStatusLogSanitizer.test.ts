const { sanitizeConnectionStatusLogContext } =
  require('../../../../apps/web/src/@webcore/utils/connectionStatusLogSanitizer') as {
    sanitizeConnectionStatusLogContext: (
      value: Record<string, unknown>
    ) => Record<string, unknown>;
  };

describe('browser connection-status log sanitizer', () => {
  it('never exposes WhatsApp identifiers, QR data, credentials, URLs or error messages', () => {
    const sensitiveValues = [
      '5511999999999',
      '5511999999999@s.whatsapp.net',
      'postgres://user:password@database/session',
      'qr-secret-payload',
      'cookie-secret',
      'error contains a database URL',
    ];
    const sanitized = sanitizeConnectionStatusLogContext({
      phone: sensitiveValues[0],
      contact_jid: sensitiveValues[1],
      database_url: sensitiveValues[2],
      qrcode: sensitiveValues[3],
      cookie: sensitiveValues[4],
      error: new Error(sensitiveValues[5]),
      reason: 'lease_lost',
      worker_id: '11111111-1111-4111-8111-111111111111',
    });
    const serialized = JSON.stringify(sanitized);

    for (const secret of sensitiveValues) {
      expect(serialized).not.toContain(secret);
    }
    expect(sanitized.reason).toBe('lease_lost');
    expect(sanitized.worker_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(sanitized.phone).toMatch(/^localhash:/u);
    expect(sanitized.contact_jid).toMatch(/^localhash:/u);
    expect(sanitized.error).toEqual({ name: 'Error' });
  });

  it('redacts unknown free-form strings while preserving bounded operational labels', () => {
    const sanitized = sanitizeConnectionStatusLogContext({
      status: 'online',
      error_code: 'lease_lost',
      arbitrary: 'free form value that may contain a secret',
    });

    expect(sanitized.status).toBe('online');
    expect(sanitized.error_code).toBe('lease_lost');
    expect(sanitized.arbitrary).toMatchObject({
      redacted: true,
      present: true,
    });
  });
});
