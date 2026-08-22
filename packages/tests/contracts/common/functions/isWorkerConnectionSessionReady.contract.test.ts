import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { isWorkerConnectionSessionReady } from '@core/common/functions/isWorkerConnectionSessionReady';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

const readyState: Partial<IBaileysConnectionState> = {
  status: EBaileysConnectionStatus.connected,
  code: ECodeMessage.connectionEstablished,
  worker_status_id: EWorkerStatus.online,
  session_ready: true,
  authenticated: true,
  can_send: true,
  can_receive_runtime: true,
  phone: '5561999999999',
};

describe('isWorkerConnectionSessionReady', () => {
  it('accepts a fully ready Baileys session whose provider transport is open', () => {
    expect(
      isWorkerConnectionSessionReady({
        ...readyState,
        provider_state: 'open',
      })
    ).toBe(true);
  });

  it('does not accept an open provider transport while the session is degraded', () => {
    expect(
      isWorkerConnectionSessionReady({
        ...readyState,
        provider_state: 'open',
        degraded_reason: 'incoming_bridge_not_bound',
        can_receive_runtime: false,
      })
    ).toBe(false);
  });

  it('accepts the canonical native online projection only with the central acknowledgement', () => {
    const canonicalOnline = {
      ...readyState,
      worker_type_id: EWorkerType.baileys,
      provider_state: 'online',
      connection_online_acknowledged: true,
      connection_status: {
        provider: 'baileys' as const,
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 4,
        changedAt: '2026-08-04T14:02:30.000Z',
      },
    };

    expect(isWorkerConnectionSessionReady(canonicalOnline)).toBe(true);
    expect(
      isWorkerConnectionSessionReady({
        ...canonicalOnline,
        connection_online_acknowledged: false,
      })
    ).toBe(false);
  });

  it('rejects a provider transport that is reconnecting despite stale ready flags', () => {
    expect(
      isWorkerConnectionSessionReady({
        ...readyState,
        provider_state: 'reconnecting',
      })
    ).toBe(false);
  });
});
