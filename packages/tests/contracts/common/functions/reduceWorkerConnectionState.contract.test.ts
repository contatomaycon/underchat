import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { reduceWorkerConnectionState } from '@core/common/functions/reduceWorkerConnectionState';

describe('reduceWorkerConnectionState', () => {
  it('preserves QR against delayed startup without QR', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,qr',
      connection_attempt_id: 'attempt-1',
    };

    const result = reduceWorkerConnectionState(current, {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-1',
    });

    expect(result.ignored).toBe(true);
    expect(result.state.qrcode).toBe(current.qrcode);
  });

  it('clears an old QR for an ordered provider-native non-QR transition', () => {
    const result = reduceWorkerConnectionState(
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,old',
        qr_pending: false,
        connection_attempt_id: 'attempt-1',
      },
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.pairingInProgress,
        qr_pending: false,
        connection_attempt_id: 'attempt-1',
        connection_status: {
          provider: 'wwebjs',
          status: EWhatsappConnectionStatus.connecting,
          connected: false,
          authenticated: true,
          sessionValid: true,
          recoverable: true,
          qrAvailable: false,
          sequence: 4,
          changedAt: '2026-08-04T23:06:06.205Z',
        },
      },
      { authoritativeNativeTransition: true }
    );

    expect(result.ignored).toBe(false);
    expect(result.state.code).toBe(ECodeMessage.pairingInProgress);
    expect(result.state.qrcode).toBeUndefined();
    expect(result.state.qr_pending).toBe(false);
  });

  it('preserves the current QR across an ordered internal-client recycle', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,current',
      qr_pending: false,
      connection_attempt_id: 'attempt-1',
    };
    const result = reduceWorkerConnectionState(
      current,
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qr_pending: true,
        connection_attempt_id: 'attempt-1',
        connection_status: {
          provider: 'wwebjs',
          status: EWhatsappConnectionStatus.restoring,
          connected: false,
          authenticated: false,
          sessionValid: false,
          recoverable: true,
          qrAvailable: false,
          sequence: 5,
          changedAt: '2026-08-10T21:10:00.000Z',
        },
      },
      {
        authoritativeNativeTransition: true,
        preserveQrDuringActiveAttempt: true,
      }
    );

    expect(result.ignored).toBe(false);
    expect(result.state.qrcode).toBe(current.qrcode);
  });

  it('does not let an ordered native transition cross a pairing-attempt fence', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,current',
      connection_attempt_id: 'attempt-current',
    };
    const result = reduceWorkerConnectionState(
      current,
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.pairingInProgress,
        qr_pending: false,
        connection_attempt_id: 'attempt-old',
        connection_status: {
          provider: 'wwebjs',
          status: EWhatsappConnectionStatus.connecting,
          connected: false,
          authenticated: true,
          sessionValid: true,
          recoverable: true,
          qrAvailable: false,
          sequence: 5,
          changedAt: '2026-08-04T23:06:07.205Z',
        },
      },
      { authoritativeNativeTransition: true }
    );

    expect(result).toEqual({
      state: current,
      ignored: true,
      reason: 'attempt_mismatch_terminal_without_qr',
    });
  });

  it('ignores pending without QR after a QR for the same attempt', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,qr',
      connection_attempt_id: 'attempt-1',
    };

    const result = reduceWorkerConnectionState(current, {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qr_pending: true,
      connection_attempt_id: 'attempt-1',
    });

    expect(result.ignored).toBe(true);
    expect(result.state.qrcode).toBe(current.qrcode);
  });

  it('accepts QR from a newer attempt', () => {
    const result = reduceWorkerConnectionState(
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,old',
        connection_attempt_id: 'attempt-1',
      },
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,new',
        connection_attempt_id: 'attempt-2',
      }
    );

    expect(result.ignored).toBe(false);
    expect(result.state.qrcode).toBe('data:image/png;base64,new');
    expect(result.state.connection_attempt_id).toBe('attempt-2');
  });

  it('preserves QR against a disconnected terminal from another attempt', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,qr',
      connection_attempt_id: 'attempt-current',
    };

    const result = reduceWorkerConnectionState(current, {
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-old',
    });

    expect(result.ignored).toBe(true);
    expect(result.reason).toBe('attempt_mismatch_terminal_without_qr');
    expect(result.state.qrcode).toBe(current.qrcode);
    expect(result.state.connection_attempt_id).toBe('attempt-current');
  });

  it('ignores connected terminal from another attempt', () => {
    const result = reduceWorkerConnectionState(
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,qr',
        connection_attempt_id: 'attempt-current',
      },
      {
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-old',
      }
    );

    expect(result.ignored).toBe(true);
    expect(result.reason).toBe('attempt_mismatch_connected');
    expect(result.state.qrcode).toBe('data:image/png;base64,qr');
    expect(result.state.connection_attempt_id).toBe('attempt-current');
  });

  it('keeps an existing QR when a non-terminal event arrives without QR', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,qr',
      connection_attempt_id: 'attempt-1',
    };

    const result = reduceWorkerConnectionState(current, {
      status: EBaileysConnectionStatus.info,
      code: ECodeMessage.info,
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-1',
    });

    expect(result.ignored).toBe(false);
    expect(result.state.qrcode).toBe(current.qrcode);
    expect(result.state.connection_attempt_id).toBe('attempt-1');
  });

  it.each([ECodeMessage.newLoginAttempt, ECodeMessage.pairingInProgress])(
    'clears the QR when the same attempt enters pairing code %s',
    (code) => {
      const result = reduceWorkerConnectionState(
        {
          status: EBaileysConnectionStatus.connecting,
          code: ECodeMessage.awaitingReadQrCode,
          qrcode: 'data:image/png;base64,qr',
          connection_attempt_id: 'attempt-1',
        },
        {
          status: EBaileysConnectionStatus.connecting,
          code,
          connection_attempt_id: 'attempt-1',
        }
      );

      expect(result.ignored).toBe(false);
      expect(result.state.code).toBe(code);
      expect(result.state.qrcode).toBeUndefined();
    }
  );

  it('preserves passkey request against delayed startup without credentials', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingPasskey,
      passkey_public_key: '{"challenge":"abc"}',
      passkey_pending: true,
      connection_attempt_id: 'attempt-1',
    };

    const result = reduceWorkerConnectionState(current, {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-1',
    });

    expect(result.ignored).toBe(true);
    expect(result.state.passkey_public_key).toBe(current.passkey_public_key);
  });

  it('preserves passkey request against a delayed QR for the same attempt', () => {
    const current = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingPasskey,
      passkey_public_key: '{"challenge":"abc"}',
      passkey_pending: true,
      connection_attempt_id: 'attempt-1',
    };

    const result = reduceWorkerConnectionState(current, {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      qrcode: 'data:image/png;base64,old-qr',
      connection_attempt_id: 'attempt-1',
    });

    expect(result.ignored).toBe(false);
    expect(result.state.code).toBe(ECodeMessage.awaitingPasskey);
    expect(result.state.passkey_public_key).toBe(current.passkey_public_key);
    expect(result.state.qrcode).toBeUndefined();
  });

  it('accepts QR from a newer attempt after a passkey request', () => {
    const result = reduceWorkerConnectionState(
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingPasskey,
        passkey_public_key: '{"challenge":"abc"}',
        passkey_pending: true,
        connection_attempt_id: 'attempt-1',
      },
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,new-qr',
        connection_attempt_id: 'attempt-2',
      }
    );

    expect(result.ignored).toBe(false);
    expect(result.state.connection_attempt_id).toBe('attempt-2');
    expect(result.state.qrcode).toBe('data:image/png;base64,new-qr');
    expect(result.state.passkey_public_key).toBeUndefined();
  });

  it('switches passkey request to manual passkey confirmation', () => {
    const result = reduceWorkerConnectionState(
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingPasskey,
        passkey_public_key: '{"challenge":"abc"}',
        passkey_pending: true,
        connection_attempt_id: 'attempt-1',
      },
      {
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingPasskeyConfirmation,
        passkey_confirmation_code: 'ABCD-EFGH',
        connection_attempt_id: 'attempt-1',
      }
    );

    expect(result.ignored).toBe(false);
    expect(result.state.passkey_public_key).toBeUndefined();
    expect(result.state.passkey_pending).toBe(false);
    expect(result.state.passkey_confirmation_code).toBe('ABCD-EFGH');
  });
});
