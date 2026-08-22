import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { isWhatsappQrAttemptExhaustedState } from '@core/common/functions/isWhatsappQrAttemptExhaustedState';

describe('isWhatsappQrAttemptExhaustedState', () => {
  const terminal = {
    status: EBaileysConnectionStatus.disconnected,
    code: ECodeMessage.connectionClosed,
    connection_attempt_id: 'attempt-current',
    attempt: 6,
    max_attempts: 5,
  };

  it('accepts only the explicit terminal after the complete QR budget', () => {
    expect(isWhatsappQrAttemptExhaustedState(terminal)).toBe(true);
  });

  it.each([
    ['missing attempt identity', { ...terminal, connection_attempt_id: '' }],
    ['generic disconnect', { ...terminal, attempt: undefined }],
    ['last generated QR', { ...terminal, attempt: 5 }],
    [
      'non-terminal connection status',
      { ...terminal, status: EBaileysConnectionStatus.connecting },
    ],
    ['different code', { ...terminal, code: ECodeMessage.awaitConnection }],
  ])('rejects %s', (_scenario, candidate) => {
    expect(isWhatsappQrAttemptExhaustedState(candidate)).toBe(false);
  });
});
