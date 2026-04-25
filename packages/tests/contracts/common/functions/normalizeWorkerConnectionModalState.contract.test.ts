import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { normalizeWorkerConnectionModalState } from '@core/common/functions/normalizeWorkerConnectionModalState';

describe('normalizeWorkerConnectionModalState', () => {
  it('maps connection startup to starting', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
      })
    ).toBe('starting');
  });

  it('maps QR states without exposing retry attempts', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
      })
    ).toBe('qrPreparing');

    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,qr',
        attempt: 4,
        max_attempts: 10,
      })
    ).toBe('qrReady');
  });

  it('maps QR scanned and pairing in progress states', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.pairingInProgress,
      })
    ).toBe('pairingInProgress');

    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.newLoginAttempt,
      })
    ).toBe('pairingInProgress');
  });

  it('maps successful, logout, reset and disconnected states', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
      })
    ).toBe('connected');

    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.logoutInProgress,
      })
    ).toBe('loggingOut');

    expect(
      normalizeWorkerConnectionModalState({
        worker_status_id: EWorkerStatus.recreating,
      })
    ).toBe('resetting');

    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.disconnected,
        code: ECodeMessage.connectionClosed,
      })
    ).toBe('disconnected');
  });

  it('keeps user-action states explicit', () => {
    expect(
      normalizeWorkerConnectionModalState(
        { code: ECodeMessage.awaitConnection },
        { isPhoneNumber: true, phoneSent: false }
      )
    ).toBe('phoneInput');

    expect(
      normalizeWorkerConnectionModalState({
        code: ECodeMessage.awaitingPairingCode,
        pairing_code: '12345678',
      })
    ).toBe('pairing');

    expect(
      normalizeWorkerConnectionModalState({
        code: ECodeMessage.phoneNotAvailable,
      })
    ).toBe('phoneUnavailable');
  });

  it('prefers terminal user-visible states over stale startup events', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.awaitConnection,
      })
    ).toBe('connected');

    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.logoutInProgress,
        worker_status_id: EWorkerStatus.recreating,
      })
    ).toBe('loggingOut');
  });
});
