import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
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

  it('keeps terminal evidence informational until protected migration recovery replaces it', () => {
    expect(
      normalizeWorkerConnectionModalState(
        {
          worker_status_id: EWorkerStatus.error,
          status: EBaileysConnectionStatus.connecting,
          code: ECodeMessage.awaitConnection,
        },
        { isSessionMigration: true }
      )
    ).toBe('migrating');

    expect(
      normalizeWorkerConnectionModalState({
        worker_status_id: EWorkerStatus.error,
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
      })
    ).toBe('disconnected');
  });

  it('lets an accepted native transition override stale QR presentation fields', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        qrcode: 'data:image/png;base64,stale',
        qr_pending: true,
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
      })
    ).toBe('starting');
  });

  it('lets accepted native terminal states override stale legacy connected evidence', () => {
    for (const nativeStatus of [
      EWhatsappConnectionStatus.offline,
      EWhatsappConnectionStatus.loggedOut,
      EWhatsappConnectionStatus.invalidSession,
      EWhatsappConnectionStatus.conflict,
      EWhatsappConnectionStatus.leaseLost,
      EWhatsappConnectionStatus.stopped,
      EWhatsappConnectionStatus.error,
    ]) {
      expect(
        normalizeWorkerConnectionModalState({
          status: EBaileysConnectionStatus.connected,
          code: ECodeMessage.connectionEstablished,
          qrcode: 'data:image/png;base64,stale',
          connection_status: {
            provider: 'wwebjs',
            status: nativeStatus,
            connected: false,
            authenticated: false,
            sessionValid: false,
            recoverable: false,
            qrAvailable: false,
            sequence: 5,
            changedAt: '2026-08-05T17:00:00.000Z',
          },
        })
      ).toBe('disconnected');
    }
  });

  it('does not flash a stale native disconnect over an active QR attempt', () => {
    const connection_status = {
      provider: 'baileys' as const,
      status: EWhatsappConnectionStatus.offline,
      connected: false,
      authenticated: false,
      sessionValid: false,
      recoverable: true,
      qrAvailable: false,
      sequence: 5,
      changedAt: '2026-08-10T14:20:00.000Z',
    };

    expect(
      normalizeWorkerConnectionModalState(
        {
          status: EBaileysConnectionStatus.connecting,
          code: ECodeMessage.awaitingReadQrCode,
          qr_pending: true,
          connection_status,
        },
        { isQrAttemptActive: true }
      )
    ).toBe('qrPreparing');

    expect(
      normalizeWorkerConnectionModalState(
        {
          status: EBaileysConnectionStatus.connecting,
          code: ECodeMessage.awaitingReadQrCode,
          qrcode: 'data:image/png;base64,current-attempt',
          connection_status,
        },
        { isQrAttemptActive: true }
      )
    ).toBe('qrReady');

    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qr_pending: true,
        connection_status,
      })
    ).toBe('disconnected');
  });

  it('does not let an active QR overlay hide a terminal lifecycle or exhausted attempts', () => {
    const connection_status = {
      provider: 'baileys' as const,
      status: EWhatsappConnectionStatus.offline,
      connected: false,
      authenticated: false,
      sessionValid: false,
      recoverable: false,
      qrAvailable: false,
      sequence: 6,
      changedAt: '2026-08-10T14:21:00.000Z',
    };

    expect(
      normalizeWorkerConnectionModalState(
        {
          worker_status_id: EWorkerStatus.error,
          code: ECodeMessage.awaitingReadQrCode,
          qr_pending: true,
          connection_status,
        },
        { isQrAttemptActive: true }
      )
    ).toBe('disconnected');

    expect(
      normalizeWorkerConnectionModalState(
        {
          code: ECodeMessage.awaitingReadQrCode,
          qr_pending: true,
          attempt: 6,
          max_attempts: 5,
          connection_status,
        },
        { isQrAttemptActive: true }
      )
    ).toBe('disconnected');
  });

  it('requires central legacy confirmation before presenting native online as connected', () => {
    const connection_status = {
      provider: 'whatsmeow' as const,
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: false,
      qrAvailable: false,
      sequence: 6,
      changedAt: '2026-08-05T17:01:00.000Z',
    };

    expect(normalizeWorkerConnectionModalState({ connection_status })).toBe(
      'starting'
    );
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        connection_status,
      })
    ).toBe('connected');
  });

  it('lets an accepted native pairing transition override stale legacy terminal fields', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.disconnected,
        code: ECodeMessage.connectionClosed,
        connection_status: {
          provider: 'baileys',
          status: EWhatsappConnectionStatus.connecting,
          connected: false,
          authenticated: true,
          sessionValid: true,
          recoverable: true,
          qrAvailable: false,
          sequence: 4,
          changedAt: '2026-08-05T17:02:00.000Z',
        },
      })
    ).toBe('starting');
  });

  it('keeps a fresh provider bootstrap in QR preparation before pairing evidence', () => {
    for (const status of [
      EWhatsappConnectionStatus.initializing,
      EWhatsappConnectionStatus.restoring,
      EWhatsappConnectionStatus.connecting,
    ]) {
      expect(
        normalizeWorkerConnectionModalState({
          connection_status: {
            provider: 'whatsmeow',
            status,
            connected: false,
            authenticated: false,
            sessionValid: null,
            recoverable: true,
            qrAvailable: false,
            sequence: 1,
            changedAt: '2026-08-05T16:42:16.000Z',
          },
        })
      ).toBe('qrPreparing');
    }
  });

  it('uses native QR readiness only when the provider is actually in QR state', () => {
    const connection_status = {
      provider: 'baileys' as const,
      status: EWhatsappConnectionStatus.qr,
      connected: false,
      authenticated: false,
      sessionValid: null,
      recoverable: true,
      qrAvailable: true,
      sequence: 3,
      changedAt: '2026-08-04T23:06:00.000Z',
    };

    expect(normalizeWorkerConnectionModalState({ connection_status })).toBe(
      'qrPreparing'
    );
    expect(
      normalizeWorkerConnectionModalState({
        connection_status,
        qrcode: 'data:image/png;base64,current',
      })
    ).toBe('qrReady');
  });

  it('maps QR states without exposing retry attempts', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        qr_pending: true,
      })
    ).toBe('qrPreparing');

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

  it('maps exhausted QR attempts to disconnected', () => {
    expect(
      normalizeWorkerConnectionModalState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        qrcode: 'data:image/png;base64,qr',
        attempt: 4,
        max_attempts: 3,
      })
    ).toBe('disconnected');
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

  it('keeps a PostgreSQL handoff in protected migration without exposing target pairing', () => {
    expect(
      normalizeWorkerConnectionModalState(
        {
          worker_status_id: EWorkerStatus.recreating,
          connection_status: {
            provider: 'baileys',
            status: EWhatsappConnectionStatus.handoff,
            connected: false,
            authenticated: true,
            sessionValid: true,
            recoverable: true,
            qrAvailable: false,
            sequence: 7,
            changedAt: '2026-08-06T12:04:04.049Z',
          },
        },
        { isSessionMigration: true }
      )
    ).toBe('migrating');

    expect(
      normalizeWorkerConnectionModalState(
        {
          worker_status_id: EWorkerStatus.recreating,
          connection_status: {
            provider: 'whatsmeow',
            status: EWhatsappConnectionStatus.qr,
            connected: false,
            authenticated: false,
            sessionValid: null,
            recoverable: true,
            qrAvailable: true,
            sequence: 8,
            changedAt: '2026-08-06T12:04:09.049Z',
          },
          qrcode: 'data:image/png;base64,target',
        },
        { isSessionMigration: true }
      )
    ).toBe('migrating');

    expect(
      normalizeWorkerConnectionModalState(
        {
          worker_status_id: EWorkerStatus.recreating,
          code: ECodeMessage.awaitingPasskey,
          passkey_public_key: '{"challenge":"unpromoted-target"}',
        },
        { isSessionMigration: true }
      )
    ).toBe('migrating');

    for (const nativeStatus of [
      EWhatsappConnectionStatus.initializing,
      EWhatsappConnectionStatus.restoring,
      EWhatsappConnectionStatus.connecting,
      EWhatsappConnectionStatus.qr,
      EWhatsappConnectionStatus.online,
    ]) {
      expect(
        normalizeWorkerConnectionModalState(
          {
            worker_status_id: EWorkerStatus.recreating,
            connection_status: {
              provider: 'wwebjs',
              status: nativeStatus,
              connected: nativeStatus === EWhatsappConnectionStatus.online,
              authenticated: nativeStatus === EWhatsappConnectionStatus.online,
              sessionValid:
                nativeStatus === EWhatsappConnectionStatus.online ? true : null,
              recoverable: true,
              qrAvailable: nativeStatus === EWhatsappConnectionStatus.qr,
              sequence: 9,
              changedAt: '2026-08-08T23:42:00.000Z',
            },
            qrcode:
              nativeStatus === EWhatsappConnectionStatus.qr
                ? 'data:image/png;base64,target'
                : undefined,
            connection_online_acknowledged:
              nativeStatus === EWhatsappConnectionStatus.online,
          },
          { isSessionMigration: true }
        )
      ).toBe('migrating');
    }

    expect(
      normalizeWorkerConnectionModalState(
        {
          worker_status_id: EWorkerStatus.disponible,
          status: EBaileysConnectionStatus.connecting,
          code: ECodeMessage.logoutInProgress,
          qrcode: 'data:image/png;base64,unpromoted-target',
          connection_status: {
            provider: 'wwebjs',
            status: EWhatsappConnectionStatus.qr,
            connected: false,
            authenticated: false,
            sessionValid: null,
            recoverable: true,
            qrAvailable: true,
            sequence: 10,
            changedAt: '2026-08-08T23:42:01.000Z',
          },
        },
        { isSessionMigration: true }
      )
    ).toBe('migrating');
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
        code: ECodeMessage.awaitingPasskey,
        passkey_public_key: '{"challenge":"abc"}',
      })
    ).toBe('passkeyRequired');

    expect(
      normalizeWorkerConnectionModalState({
        code: ECodeMessage.awaitingPasskeyConfirmation,
        passkey_confirmation_code: 'ABCD-EFGH',
      })
    ).toBe('passkeyConfirmation');

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
