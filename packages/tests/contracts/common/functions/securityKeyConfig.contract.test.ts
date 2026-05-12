import {
  appendSecurityKeyToText,
  createSecurityKeyLine,
  generateSecurityKeyCode,
  shouldApplySecurityKey,
} from '@core/common/functions/securityKeyConfig';

describe('securityKeyConfig helpers', () => {
  it('generates a 10 character uppercase alphanumeric code', () => {
    expect(generateSecurityKeyCode()).toMatch(/^[A-Z0-9]{10}$/);
  });

  it('appends the security key after one blank line', () => {
    const result = appendSecurityKeyToText('Mensagem original');

    expect(result).toMatch(
      /^Mensagem original\n\n> ```Chave de segurança: [A-Z0-9]{10}```$/
    );
  });

  it('can create the security key as the only caption text', () => {
    expect(createSecurityKeyLine()).toMatch(
      /^> ```Chave de segurança: [A-Z0-9]{10}```$/
    );
    expect(appendSecurityKeyToText('', { allowSecurityKeyOnly: true })).toMatch(
      /^> ```Chave de segurança: [A-Z0-9]{10}```$/
    );
  });

  it('does not alter empty messages or duplicate an existing key suffix', () => {
    expect(appendSecurityKeyToText('   ')).toBe('   ');

    const message = 'Mensagem\n\n> ```Chave de segurança: ABC123XYZ0```';

    expect(appendSecurityKeyToText(message)).toBe(message);
    expect(
      appendSecurityKeyToText('> ```Chave de segurança: ABC123XYZ0```')
    ).toBe('> ```Chave de segurança: ABC123XYZ0```');
    expect(
      appendSecurityKeyToText('```Chave de segurança: ABC123XYZ0```')
    ).toBe('```Chave de segurança: ABC123XYZ0```');
    expect(appendSecurityKeyToText('_Chave de segurança: ABC123XYZ0_')).toBe(
      '_Chave de segurança: ABC123XYZ0_'
    );
    expect(appendSecurityKeyToText('Chave de segurança: ABC123XYZ0')).toBe(
      'Chave de segurança: ABC123XYZ0'
    );
  });

  it('applies when the main flag and at least one requested scope are enabled', () => {
    const config = {
      enabled: true,
      chatbot: false,
      schedule: true,
      quick_message: false,
    };

    expect(shouldApplySecurityKey(config, ['schedule'])).toBe(true);
    expect(shouldApplySecurityKey(config, ['chatbot'])).toBe(false);
    expect(
      shouldApplySecurityKey({ ...config, enabled: false }, ['schedule'])
    ).toBe(false);
  });
});
