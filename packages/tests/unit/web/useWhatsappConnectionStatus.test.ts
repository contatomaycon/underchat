import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

const {
  evaluateConnectionModalPublication,
  shouldClearConnectionModalQr,
  useWhatsappConnectionStatus,
} =
  require('../../../../apps/web/src/composables/useWhatsappConnectionStatus') as {
    evaluateConnectionModalPublication: (input: {
      currentAttemptId?: string;
      currentConnected: boolean;
      hasDurableNativeOrder: boolean;
      incoming: Partial<IBaileysConnectionState>;
      nativeResolution: 'accepted' | 'duplicate' | 'invalid' | 'none' | 'stale';
    }) => { accepted: boolean; reason?: string };
    shouldClearConnectionModalQr: (input: {
      nativeResolution: 'accepted' | 'duplicate' | 'invalid' | 'none' | 'stale';
      snapshot?: IWhatsappConnectionStatus;
      preserveCurrentQr?: boolean;
    }) => boolean;
    useWhatsappConnectionStatus: () => {
      status: { value?: IWhatsappConnectionStatus };
      sourceId: { value?: string };
      order: { value?: string };
      accept: (input: {
        expectedProvider?: 'baileys' | 'wwebjs' | 'whatsmeow';
        snapshot: unknown;
        sourceId?: string | null;
        order?: string | null;
      }) => {
        outcome: 'accepted' | 'duplicate' | 'invalid' | 'stale';
        snapshot?: IWhatsappConnectionStatus;
      };
    };
  };

const sourceA = '11111111-1111-4111-8111-111111111111';
const sourceB = '22222222-2222-4222-8222-222222222222';
const sourceC = '33333333-3333-4333-8333-333333333333';

function status(
  overrides: Partial<IWhatsappConnectionStatus> = {}
): IWhatsappConnectionStatus {
  return {
    provider: 'wwebjs',
    status: EWhatsappConnectionStatus.connecting,
    connected: false,
    authenticated: false,
    sessionValid: null,
    recoverable: true,
    qrAvailable: false,
    sequence: 1,
    changedAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

function confirmedOnlineState(
  overrides: Partial<IBaileysConnectionState> = {}
): Partial<IBaileysConnectionState> {
  return {
    status: EBaileysConnectionStatus.connected,
    code: ECodeMessage.connectionEstablished,
    worker_status_id: EWorkerStatus.online,
    worker_type_id: EWorkerType.baileys,
    session_ready: true,
    can_send: true,
    can_receive_runtime: true,
    authenticated: true,
    provider_state: 'online',
    degraded_reason: undefined,
    phone: '5561900000000',
    connection_attempt_id: 'attempt-b',
    connection_online_acknowledged: true,
    connection_status: status({
      provider: 'baileys',
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: false,
      sequence: 4,
    }),
    ...overrides,
  };
}

describe('useWhatsappConnectionStatus', () => {
  it('accepts the first positive sequence and rejects an old online event from the same native client', () => {
    const connection = useWhatsappConnectionStatus();
    expect(
      connection.accept({
        expectedProvider: 'wwebjs',
        sourceId: sourceA,
        snapshot: status(),
      }).outcome
    ).toBe('accepted');

    const offline = status({
      status: EWhatsappConnectionStatus.offline,
      sessionValid: true,
      sequence: 3,
      changedAt: '2026-08-04T12:00:03.000Z',
    });
    expect(
      connection.accept({ sourceId: sourceA, snapshot: offline }).outcome
    ).toBe('accepted');

    const oldOnline = status({
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      sequence: 2,
      changedAt: '2026-08-04T12:00:02.000Z',
    });
    expect(
      connection.accept({ sourceId: sourceA, snapshot: oldOnline }).outcome
    ).toBe('stale');
    expect(connection.status.value).toEqual(offline);
  });

  it('rejects an equal-sequence conflict but accepts an older degradation from a fresh source', () => {
    const connection = useWhatsappConnectionStatus();
    const current = status({
      status: EWhatsappConnectionStatus.offline,
      sequence: 5,
      changedAt: '2026-08-04T12:00:05.000Z',
    });
    connection.accept({ sourceId: sourceA, snapshot: current });

    expect(
      connection.accept({
        sourceId: sourceA,
        snapshot: status({
          status: EWhatsappConnectionStatus.reconnecting,
          sequence: 5,
          changedAt: current.changedAt,
        }),
      }).outcome
    ).toBe('stale');
    const replacement = status({
      status: EWhatsappConnectionStatus.offline,
      changedAt: '2026-08-04T12:00:04.000Z',
    });
    expect(
      connection.accept({ sourceId: sourceB, snapshot: replacement }).outcome
    ).toBe('accepted');
    expect(connection.status.value).toEqual(replacement);

    expect(
      connection.accept({
        sourceId: sourceA,
        snapshot: status({ sequence: 6 }),
      }).outcome
    ).toBe('stale');
  });

  it('never lets an older fresh source promote ONLINE', () => {
    const connection = useWhatsappConnectionStatus();
    connection.accept({
      sourceId: sourceA,
      snapshot: status({
        status: EWhatsappConnectionStatus.offline,
        sequence: 8,
        changedAt: '2026-08-04T12:00:08.000Z',
      }),
    });

    const oldOnline = status({
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      sequence: 1,
      changedAt: '2026-08-04T12:00:07.000Z',
    });
    expect(
      connection.accept({ sourceId: sourceB, snapshot: oldOnline }).outcome
    ).toBe('stale');
  });

  it('keeps the ONLINE time floor after an accepted degradation with a regressed clock', () => {
    const connection = useWhatsappConnectionStatus();
    connection.accept({
      sourceId: sourceA,
      snapshot: status({
        status: EWhatsappConnectionStatus.offline,
        sequence: 8,
        changedAt: '2026-08-04T12:00:08.000Z',
      }),
    });
    expect(
      connection.accept({
        sourceId: sourceB,
        snapshot: status({
          status: EWhatsappConnectionStatus.offline,
          changedAt: '2026-08-04T12:00:04.000Z',
        }),
      }).outcome
    ).toBe('accepted');

    const staleOnline = status({
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      changedAt: '2026-08-04T12:00:07.000Z',
    });
    expect(
      connection.accept({ sourceId: sourceC, snapshot: staleOnline }).outcome
    ).toBe('stale');
  });

  it('accepts a later replacement source when its sequence restarts at one', () => {
    const connection = useWhatsappConnectionStatus();
    connection.accept({
      sourceId: sourceA,
      snapshot: status({
        sequence: 8,
        changedAt: '2026-08-04T12:00:08.000Z',
      }),
    });

    const replacement = status({
      sequence: 1,
      changedAt: '2026-08-04T12:00:09.000Z',
    });
    expect(
      connection.accept({ sourceId: sourceB, snapshot: replacement }).outcome
    ).toBe('accepted');
    expect(connection.sourceId.value).toBe(sourceB);
    expect(connection.status.value).toEqual(replacement);
  });

  it('uses durable outbox order to reject a delayed A after A to B handoff', () => {
    const connection = useWhatsappConnectionStatus();
    expect(
      connection.accept({
        sourceId: sourceA,
        order: '9007199254740992',
        snapshot: status({ sequence: 8 }),
      }).outcome
    ).toBe('accepted');
    expect(
      connection.accept({
        sourceId: sourceB,
        order: '9007199254740993',
        snapshot: status({ sequence: 1 }),
      }).outcome
    ).toBe('accepted');
    expect(
      connection.accept({
        sourceId: sourceA,
        order: '9007199254740992',
        snapshot: status({ sequence: 9 }),
      }).outcome
    ).toBe('stale');
    expect(connection.sourceId.value).toBe(sourceB);
    expect(connection.order.value).toBe('9007199254740993');
  });

  it('orders a derived lease loss before a same-sequence strong ONLINE re-acknowledgement', () => {
    const connection = useWhatsappConnectionStatus();
    const online = status({
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      sequence: 7,
      changedAt: '2026-08-04T12:00:07.000Z',
    });
    expect(
      connection.accept({
        sourceId: sourceA,
        order: '101',
        snapshot: online,
      }).outcome
    ).toBe('accepted');

    const leaseLost = status({
      status: EWhatsappConnectionStatus.leaseLost,
      authenticated: true,
      sessionValid: true,
      sequence: 7,
      changedAt: '2026-08-04T12:00:08.000Z',
      reason: 'session_lease_expired',
      errorCode: 'lease_lost',
    });
    expect(
      connection.accept({
        sourceId: sourceA,
        order: '102',
        snapshot: leaseLost,
      }).outcome
    ).toBe('accepted');
    expect(connection.status.value).toEqual(leaseLost);

    expect(
      connection.accept({
        sourceId: sourceA,
        order: '103',
        snapshot: online,
      }).outcome
    ).toBe('accepted');
    expect(connection.status.value).toEqual(online);
  });

  it('rejects conflicting native payloads that reuse one durable outbox order', () => {
    const connection = useWhatsappConnectionStatus();
    const online = status({
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      recoverable: false,
    });
    expect(
      connection.accept({
        sourceId: sourceA,
        order: '301',
        snapshot: online,
      }).outcome
    ).toBe('accepted');

    expect(
      connection.accept({
        sourceId: sourceA,
        order: '301',
        snapshot: status({
          status: EWhatsappConnectionStatus.qr,
          qrAvailable: true,
        }),
      }).outcome
    ).toBe('invalid');
    expect(connection.status.value).toEqual(online);
  });

  it('lets a newer durable ONLINE projection supersede a QR attempt id', () => {
    expect(
      evaluateConnectionModalPublication({
        currentAttemptId: 'attempt-a',
        currentConnected: false,
        hasDurableNativeOrder: true,
        incoming: confirmedOnlineState(),
        nativeResolution: 'accepted',
      })
    ).toEqual({ accepted: true });

    expect(
      evaluateConnectionModalPublication({
        currentAttemptId: 'attempt-a',
        currentConnected: false,
        hasDurableNativeOrder: true,
        incoming: confirmedOnlineState(),
        nativeResolution: 'duplicate',
      })
    ).toEqual({
      accepted: false,
      reason: 'stale_connection_attempt',
    });
  });

  it('never reopens an old QR after connected without a newer durable native transition', () => {
    const qrReplay: Partial<IBaileysConnectionState> = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_status_id: EWorkerStatus.disponible,
      qrcode: 'data:image/png;base64,stale',
      connection_attempt_id: 'attempt-a',
    };
    expect(
      evaluateConnectionModalPublication({
        currentAttemptId: 'attempt-a',
        currentConnected: true,
        hasDurableNativeOrder: true,
        incoming: qrReplay,
        nativeResolution: 'duplicate',
      })
    ).toEqual({ accepted: false, reason: 'stale_after_connected' });
    expect(
      evaluateConnectionModalPublication({
        currentAttemptId: 'attempt-a',
        currentConnected: true,
        hasDurableNativeOrder: true,
        incoming: qrReplay,
        nativeResolution: 'accepted',
      })
    ).toEqual({ accepted: true });
  });

  it('clears QR as soon as a newer native state stops offering it', () => {
    expect(
      shouldClearConnectionModalQr({
        nativeResolution: 'accepted',
        snapshot: status({
          status: EWhatsappConnectionStatus.connecting,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        }),
      })
    ).toBe(true);
    expect(
      shouldClearConnectionModalQr({
        nativeResolution: 'duplicate',
        snapshot: status({
          status: EWhatsappConnectionStatus.connecting,
          qrAvailable: false,
        }),
      })
    ).toBe(false);
    expect(
      shouldClearConnectionModalQr({
        nativeResolution: 'accepted',
        snapshot: status({
          status: EWhatsappConnectionStatus.qr,
          qrAvailable: true,
        }),
      })
    ).toBe(false);
  });

  it('keeps the current QR while the same active attempt recycles its client', () => {
    expect(
      shouldClearConnectionModalQr({
        nativeResolution: 'accepted',
        preserveCurrentQr: true,
        snapshot: status({
          status: EWhatsappConnectionStatus.restoring,
          authenticated: false,
          sessionValid: false,
          qrAvailable: false,
        }),
      })
    ).toBe(false);
  });

  it('keeps a connected claim fail-closed when readiness evidence is incomplete', () => {
    expect(
      evaluateConnectionModalPublication({
        currentAttemptId: 'attempt-b',
        currentConnected: false,
        hasDurableNativeOrder: true,
        incoming: confirmedOnlineState({ can_receive_runtime: false }),
        nativeResolution: 'accepted',
      })
    ).toEqual({
      accepted: false,
      reason: 'connected_without_confirmed_session_ready',
    });
  });
});
