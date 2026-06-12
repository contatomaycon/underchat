import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
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

  it('accepts connected terminal from another attempt', () => {
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

    expect(result.ignored).toBe(false);
    expect(result.state.qrcode).toBeUndefined();
    expect(result.state.connection_attempt_id).toBe('attempt-old');
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
});
