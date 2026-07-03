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
});
