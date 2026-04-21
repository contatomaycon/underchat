const extractPhoneAndDdiMock = jest.fn();
const normalizeJidMock = jest.fn();
const normalizePhoneToJidMock = jest.fn();

jest.mock('@core/common/functions/extractPhoneAndDdi', () => ({
  extractPhoneAndDdi: (...args: unknown[]) => extractPhoneAndDdiMock(...args),
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: (...args: unknown[]) => normalizeJidMock(...args),
}));

jest.mock('@core/common/functions/normalizePhoneToJid', () => ({
  normalizePhoneToJid: (...args: unknown[]) => normalizePhoneToJidMock(...args),
}));

import { resolveWebhookInteractionJids } from '@core/common/functions/resolveWebhookInteractionJids';

describe('resolveWebhookInteractionJids', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    normalizeJidMock.mockImplementation(
      (value: string | null | undefined) => value
    );
    extractPhoneAndDdiMock.mockReturnValue(null);
    normalizePhoneToJidMock.mockReturnValue(undefined);
  });

  it('returns null when neither validated jid nor phone can be resolved', () => {
    expect(resolveWebhookInteractionJids({})).toBeNull();
  });

  it('uses validated jid when available and not lid', () => {
    expect(
      resolveWebhookInteractionJids({
        validatedJid: '5511@s.whatsapp.net',
      })
    ).toEqual({
      remoteJid: '5511@s.whatsapp.net',
    });
  });

  it('uses validatedPhoneWithDdi as primary source for remoteJid', () => {
    extractPhoneAndDdiMock.mockReturnValue({
      phone: '11999999999',
      phone_ddi: '55',
    });
    normalizePhoneToJidMock.mockReturnValue('5511999999999@s.whatsapp.net');

    expect(
      resolveWebhookInteractionJids({
        validatedJid: '5511888888888@s.whatsapp.net',
        validatedPhoneWithDdi: '+55 11 99999-9999',
      })
    ).toEqual({
      remoteJid: '5511999999999@s.whatsapp.net',
      remoteJidAlt: '5511888888888@s.whatsapp.net',
    });
  });

  it('falls back to fallbackPhone when validatedPhoneWithDdi is unusable', () => {
    extractPhoneAndDdiMock.mockReturnValue(null);
    normalizePhoneToJidMock.mockReturnValue('441234567890@s.whatsapp.net');

    expect(
      resolveWebhookInteractionJids({
        fallbackPhone: '1234567890',
        fallbackPhoneDdi: '44',
      })
    ).toEqual({
      remoteJid: '441234567890@s.whatsapp.net',
    });

    expect(normalizePhoneToJidMock).toHaveBeenCalledWith('1234567890', '44');
  });

  it('falls back to validated jid when validatedPhoneWithDdi exists but cannot be extracted', () => {
    extractPhoneAndDdiMock.mockReturnValue(null);
    normalizeJidMock.mockReturnValue('5511888888888@s.whatsapp.net');

    expect(
      resolveWebhookInteractionJids({
        validatedJid: '5511888888888@s.whatsapp.net',
        validatedPhoneWithDdi: 'invalid-phone',
      })
    ).toEqual({
      remoteJid: '5511888888888@s.whatsapp.net',
    });
  });

  it('ignores validated lid jid as alternate value', () => {
    normalizeJidMock.mockReturnValue('5511@lid');
    extractPhoneAndDdiMock.mockReturnValue({
      phone: '11999999999',
      phone_ddi: '55',
    });
    normalizePhoneToJidMock.mockReturnValue('5511999999999@s.whatsapp.net');

    expect(
      resolveWebhookInteractionJids({
        validatedJid: '5511@lid',
        validatedPhoneWithDdi: '+55 11 99999-9999',
      })
    ).toEqual({
      remoteJid: '5511999999999@s.whatsapp.net',
    });
  });

  it('does not set remoteJidAlt when it equals remoteJid', () => {
    normalizeJidMock.mockReturnValue('5511999999999@s.whatsapp.net');
    extractPhoneAndDdiMock.mockReturnValue({
      phone: '11999999999',
      phone_ddi: '55',
    });
    normalizePhoneToJidMock.mockReturnValue('5511999999999@s.whatsapp.net');

    expect(
      resolveWebhookInteractionJids({
        validatedJid: '5511999999999@s.whatsapp.net',
        validatedPhoneWithDdi: '+55 11 99999-9999',
      })
    ).toEqual({
      remoteJid: '5511999999999@s.whatsapp.net',
    });
  });
});
