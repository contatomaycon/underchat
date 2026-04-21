import { remoteParticipantJid } from '@core/common/functions/remoteParticipantJid';

describe('remoteParticipantJid', () => {
  it('returns participant when available', () => {
    expect(
      remoteParticipantJid({ participant: '5511@s.whatsapp.net' } as never)
    ).toBe('5511@s.whatsapp.net');
  });

  it('returns undefined when participant is missing', () => {
    expect(remoteParticipantJid(undefined)).toBeUndefined();
    expect(remoteParticipantJid({} as never)).toBeUndefined();
  });
});
