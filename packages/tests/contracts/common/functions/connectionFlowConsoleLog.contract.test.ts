import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

describe('logConnectionFlowConsole', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redacts snake_case passkey fields after key normalization', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    logConnectionFlowConsole('test.passkey_redaction', {
      passkey_public_key: '{"challenge":"secret-challenge"}',
      passkey_response: '{"signature":"secret-signature"}',
    });

    const output = JSON.stringify(consoleSpy.mock.calls);
    expect(output).not.toContain('secret-challenge');
    expect(output).not.toContain('secret-signature');

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[1] ?? '{}'));
    expect(payload.passkey_public_key).toEqual(
      expect.objectContaining({
        redacted: true,
        present: true,
      })
    );
    expect(payload.passkey_response).toEqual(
      expect.objectContaining({
        redacted: true,
        present: true,
      })
    );
  });

  it('hashes WhatsApp identifiers and suppresses URLs and error messages', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    logConnectionFlowConsole('test.identifier_redaction', {
      session_id: '4a5cb031-54ac-491b-80ba-e0803cb78c07',
      jid: '5511999999999@s.whatsapp.net',
      phone: '5511999999999',
      message_id: 'secret-message-id',
      proxy_url: 'http://user:password@proxy.internal:3128',
      error: new Error('postgres://user:password@db/session'),
      reason: 'postgres://reason-user:reason-pass@db/session',
    });

    const output = JSON.stringify(consoleSpy.mock.calls);
    for (const secret of [
      '5511999999999',
      'secret-message-id',
      'user:password',
      'postgres://',
      'reason-user:reason-pass',
    ]) {
      expect(output).not.toContain(secret);
    }

    const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[1] ?? '{}'));
    expect(payload.session_id).toBe('4a5cb031-54ac-491b-80ba-e0803cb78c07');
    expect(payload.jid).toMatch(/^sha256:/);
    expect(payload.phone).toMatch(/^sha256:/);
    expect(payload.message_id).toMatch(/^sha256:/);
    expect(payload.proxy_url).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
    expect(payload.error).toEqual(
      expect.objectContaining({
        error_name: 'error',
        error_code: 'unclassified_error',
      })
    );
    expect(payload.reason).toEqual(
      expect.objectContaining({ redacted: true, present: true })
    );
  });
});
