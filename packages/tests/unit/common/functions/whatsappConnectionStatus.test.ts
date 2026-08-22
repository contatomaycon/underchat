import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { applyWhatsappConnectionStatus } from '@core/common/functions/applyWhatsappConnectionStatus';
import {
  isWhatsappQrCredentialConsumedState,
  isWhatsappQrCredentialPendingState,
} from '@core/common/functions/isWhatsappQrCredentialConsumedState';
import {
  areSameWhatsappConnectionStatus,
  compareWhatsappConnectionStatusOrders,
  isNewerWhatsappConnectionStatus,
  isWhatsappConnectionOnline,
  mergeWhatsappOrderedChannelHttpSnapshot,
  mergeWhatsappOrderedChannelProjection,
  normalizeWhatsappConnectionStatusSourceId,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusOrder,
  projectWhatsappChannelDisplayStatus,
  projectWhatsappConnectionPublicStatus,
  shouldApplyWhatsappConnectionStatusOrder,
} from '@core/common/functions/whatsappConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';

const changedAt = '2026-08-04T12:00:00.000Z';

function snapshot(
  overrides: Partial<IWhatsappConnectionStatus> = {}
): IWhatsappConnectionStatus {
  return {
    provider: 'baileys',
    status: EWhatsappConnectionStatus.connecting,
    connected: false,
    authenticated: false,
    sessionValid: null,
    recoverable: true,
    qrAvailable: false,
    sequence: 1,
    changedAt,
    ...overrides,
  };
}

function runtimeState(
  overrides: Partial<IBaileysConnectionState> = {}
): IBaileysConnectionState {
  return {
    worker_id: '019ca10d-73e1-7e5e-9d1e-8b8148aeb245',
    account_id: '019ca10d-8682-7da3-a04a-a76163a6969a',
    status: EBaileysConnectionStatus.connecting,
    code: ECodeMessage.awaitConnection,
    ...overrides,
  };
}

describe('provider-native WhatsApp connection status', () => {
  it('recognizes only explicit, authenticated QR-consumption evidence', () => {
    expect(
      isWhatsappQrCredentialConsumedState({
        code: ECodeMessage.pairingInProgress,
      })
    ).toBe(true);
    expect(
      isWhatsappQrCredentialConsumedState({
        code: ECodeMessage.awaitingReadQrCode,
        connection_status: snapshot({
          status: EWhatsappConnectionStatus.connecting,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        }),
      })
    ).toBe(true);
    expect(
      isWhatsappQrCredentialConsumedState({
        code: ECodeMessage.awaitConnection,
        connection_status: snapshot(),
      })
    ).toBe(false);
    expect(
      isWhatsappQrCredentialConsumedState({
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        is_new_login: true,
        connection_status: snapshot({
          status: EWhatsappConnectionStatus.qr,
          qrAvailable: true,
        }),
      })
    ).toBe(false);
  });

  it('keeps generic provider startup in the pre-read QR state', () => {
    expect(
      isWhatsappQrCredentialPendingState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        connection_status: snapshot({
          status: EWhatsappConnectionStatus.initializing,
          authenticated: false,
          sessionValid: null,
          qrAvailable: false,
        }),
      })
    ).toBe(true);
    expect(
      isWhatsappQrCredentialPendingState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        is_new_login: true,
        connection_status: snapshot({
          status: EWhatsappConnectionStatus.qr,
          qrAvailable: true,
        }),
      })
    ).toBe(true);
    expect(
      isWhatsappQrCredentialPendingState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.pairingInProgress,
      })
    ).toBe(false);
    expect(
      isWhatsappQrCredentialPendingState({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        connection_status: snapshot({
          status: EWhatsappConnectionStatus.connecting,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        }),
      })
    ).toBe(false);
  });

  it('accepts only canonical UUID source identities', () => {
    expect(
      normalizeWhatsappConnectionStatusSourceId(
        ' 11111111-1111-4111-8111-111111111111 '
      )
    ).toBe('11111111-1111-4111-8111-111111111111');
    expect(
      normalizeWhatsappConnectionStatusSourceId('runtime-1')
    ).toBeUndefined();
  });

  it('orders PostgreSQL bigint cursor strings without precision loss', () => {
    expect(normalizeWhatsappConnectionStatusOrder('9223372036854775807')).toBe(
      '9223372036854775807'
    );
    expect(normalizeWhatsappConnectionStatusOrder('01')).toBeUndefined();
    expect(
      compareWhatsappConnectionStatusOrders(
        '9007199254740993',
        '9007199254740992'
      )
    ).toBe(1);
  });

  it('CAS-merges delayed HTTP projections without regressing realtime state', () => {
    const current = {
      id: 'worker-1',
      name: 'Realtime name',
      status: { id: EWorkerStatus.online, name: 'online' },
      connection_status: 'online',
      connection_status_order: '20',
      connection_online_acknowledged: true,
    };
    const delayed = {
      id: 'worker-1',
      name: 'Fresh metadata',
      status: { id: EWorkerStatus.offline, name: 'offline' },
      connection_status: 'connecting',
      connection_status_order: '19',
      connection_online_acknowledged: false,
    };

    expect(shouldApplyWhatsappConnectionStatusOrder('20', '19')).toBe(false);
    expect(mergeWhatsappOrderedChannelProjection(current, delayed)).toEqual({
      ...current,
      name: 'Fresh metadata',
      status: delayed.status,
    });
    expect(
      mergeWhatsappOrderedChannelProjection(current, {
        ...delayed,
        connection_status_order: '21',
      })
    ).toEqual({ ...delayed, connection_status_order: '21' });
    expect(
      mergeWhatsappOrderedChannelProjection(current, {
        ...delayed,
        connection_status_order: '20',
      })
    ).toEqual({ ...current, name: 'Fresh metadata', status: delayed.status });
  });

  it('orders the persisted worker status by its own clock, never by the native cursor', () => {
    const current = {
      id: 'worker-1',
      status: null as { id: EWorkerStatus; name: string } | null,
      worker_status_observed_at: '2026-08-10T16:10:01.297Z',
      connection_status: 'qr',
      connection_status_order: '22',
    };
    const authoritativeHttp = {
      id: 'worker-1',
      status: { id: EWorkerStatus.disponible, name: 'disponible' },
      worker_status_observed_at: '2026-08-10T16:10:01.297Z',
      connection_status: 'connecting',
      connection_status_order: '20',
    };

    expect(
      mergeWhatsappOrderedChannelProjection(current, authoritativeHttp)
    ).toEqual({
      ...authoritativeHttp,
      connection_status: 'qr',
      connection_status_order: '22',
    });

    expect(
      mergeWhatsappOrderedChannelProjection(
        {
          ...current,
          status: { id: EWorkerStatus.online, name: 'online' },
          worker_status_observed_at: '2026-08-10T16:10:02.000Z',
        },
        authoritativeHttp
      ).status
    ).toEqual({ id: EWorkerStatus.online, name: 'online' });
  });

  it('keeps a realtime row omitted by an HTTP response started before it changed', () => {
    const current = [
      {
        id: 'worker-1',
        status: { id: EWorkerStatus.offline, name: 'offline' },
        connection_status_order: '11',
      },
    ];
    expect(
      mergeWhatsappOrderedChannelHttpSnapshot(
        current,
        [],
        new Map([['worker-1', '10']])
      )
    ).toEqual(current);
  });

  it('does not let an HTTP response from the previous provider undo a realtime handoff', () => {
    const realtimeWweb = {
      id: 'worker-1',
      worker_type_id: EWorkerType.wwebjs,
      status: { id: EWorkerStatus.online, name: 'online' },
      connection_status: 'online',
      connection_status_order: '20',
    };
    const delayedBaileys = {
      id: 'worker-1',
      worker_type_id: EWorkerType.baileys,
      status: { id: EWorkerStatus.offline, name: 'offline' },
      connection_status: 'offline',
      connection_status_order: '11',
    };

    expect(
      mergeWhatsappOrderedChannelHttpSnapshot(
        [realtimeWweb],
        [delayedBaileys],
        new Map([['worker-1', '10']]),
        {
          baselineWorkerTypeIds: new Map([['worker-1', EWorkerType.baileys]]),
        }
      )
    ).toEqual([realtimeWweb]);

    const handoffWithoutANewCursor = {
      ...realtimeWweb,
      connection_status_order: '10',
    };
    expect(
      mergeWhatsappOrderedChannelHttpSnapshot(
        [handoffWithoutANewCursor],
        [{ ...delayedBaileys, connection_status_order: '10' }],
        new Map([['worker-1', '10']]),
        {
          baselineWorkerTypeIds: new Map([['worker-1', EWorkerType.baileys]]),
        }
      )
    ).toEqual([handoffWithoutANewCursor]);

    expect(
      mergeWhatsappOrderedChannelHttpSnapshot(
        [{ ...delayedBaileys, connection_status_order: '10' }],
        [
          {
            ...realtimeWweb,
            connection_status: 'connecting',
            connection_status_order: null,
          },
        ],
        new Map([['worker-1', '10']]),
        {
          baselineWorkerTypeIds: new Map([['worker-1', EWorkerType.baileys]]),
        }
      )
    ).toEqual([
      {
        ...realtimeWweb,
        connection_status: 'connecting',
        connection_status_order: null,
      },
    ]);
  });

  it('requires a positive sequence and accepts its decimal protobuf form without weakening provider checks', () => {
    const normalized = normalizeWhatsappConnectionStatus(
      {
        ...snapshot(),
        sequence: '1',
        changedAt: '2026-08-04T09:00:00-03:00',
        reason: ' SOCKET.OPEN ',
        errorCode: 'unsafe value containing a secret',
      },
      'baileys'
    );

    expect(normalized).toEqual({
      ...snapshot(),
      changedAt,
      reason: 'socket.open',
    });
    expect(
      normalizeWhatsappConnectionStatus(
        { ...snapshot(), provider: 'wwebjs' },
        'baileys'
      )
    ).toBeUndefined();
    expect(
      normalizeWhatsappConnectionStatus({ ...snapshot(), sequence: 0 })
    ).toBeUndefined();
  });

  it('maps an omitted protobuf optional sessionValid field to canonical null', () => {
    const { sessionValid: _omitted, ...wireSnapshot } = snapshot();
    expect(normalizeWhatsappConnectionStatus(wireSnapshot)?.sessionValid).toBe(
      null
    );
  });

  it.each([
    snapshot({
      status: EWhatsappConnectionStatus.online,
      connected: false,
      authenticated: true,
      sessionValid: true,
    }),
    snapshot({
      status: EWhatsappConnectionStatus.qr,
      authenticated: true,
      qrAvailable: true,
    }),
    snapshot({
      status: EWhatsappConnectionStatus.loggedOut,
      connected: true,
    }),
  ])('rejects incoherent provider snapshots', (input) => {
    expect(normalizeWhatsappConnectionStatus(input)).toBeUndefined();
  });

  it('orders one native client monotonically and detects exact duplicates', () => {
    const current = snapshot({ sequence: 4 });
    const oldOnline = snapshot({
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      sequence: 3,
    });
    const next = snapshot({ sequence: 5 });

    expect(isNewerWhatsappConnectionStatus(current, oldOnline)).toBe(false);
    expect(isNewerWhatsappConnectionStatus(current, next)).toBe(true);
    expect(areSameWhatsappConnectionStatus(current, { ...current })).toBe(true);
    expect(isWhatsappConnectionOnline(oldOnline)).toBe(true);
  });

  it.each([
    [EWhatsappConnectionStatus.restoring, 'connecting'],
    [EWhatsappConnectionStatus.handoff, 'connecting'],
    [EWhatsappConnectionStatus.qr, 'qr'],
    [EWhatsappConnectionStatus.offline, 'offline'],
    [EWhatsappConnectionStatus.leaseLost, 'offline'],
    [EWhatsappConnectionStatus.loggedOut, 'reconnect_required'],
    [EWhatsappConnectionStatus.invalidSession, 'reconnect_required'],
    [EWhatsappConnectionStatus.conflict, 'reconnect_required'],
  ] as const)(
    'projects technical status %s to the stable public status %s',
    (status, expected) => {
      const value = snapshot({
        status,
        sessionValid:
          status === EWhatsappConnectionStatus.restoring ? true : null,
        qrAvailable: status === EWhatsappConnectionStatus.qr,
      });
      expect(projectWhatsappConnectionPublicStatus(value)).toBe(expected);
    }
  );

  it('does not expose technical startup as connecting before QR consumption', () => {
    for (const status of [
      EWhatsappConnectionStatus.initializing,
      EWhatsappConnectionStatus.restoring,
      EWhatsappConnectionStatus.connecting,
    ]) {
      expect(
        projectWhatsappConnectionPublicStatus(
          snapshot({
            status,
            authenticated: false,
            sessionValid: null,
            qrAvailable: false,
          })
        )
      ).toBeUndefined();
    }

    expect(
      projectWhatsappConnectionPublicStatus(
        snapshot({
          status: EWhatsappConnectionStatus.connecting,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        })
      )
    ).toBe('connecting');
  });

  it('does not promote native online before all centrally fenced readiness signals agree', () => {
    const online = snapshot({
      status: EWhatsappConnectionStatus.online,
      connected: true,
      authenticated: true,
      sessionValid: true,
      sequence: 9,
    });
    const incomplete = applyWhatsappConnectionStatus(
      runtimeState({
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        session_ready: true,
        can_send: true,
        can_receive_runtime: false,
        authenticated: true,
      }),
      online
    );
    expect(incomplete.status).toBe(EBaileysConnectionStatus.connecting);
    expect(incomplete.session_ready).toBe(false);
    expect(incomplete.can_send).toBe(false);

    const acknowledged = applyWhatsappConnectionStatus(
      runtimeState({
        worker_status_id: EWorkerStatus.online,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        connection_online_acknowledged: true,
        phone: '5561999999999',
      }),
      online
    );
    expect(acknowledged.status).toBe(EBaileysConnectionStatus.connected);
    expect(acknowledged.code).toBe(ECodeMessage.connectionEstablished);

    const missingPhone = applyWhatsappConnectionStatus(
      runtimeState({
        worker_status_id: EWorkerStatus.online,
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
      }),
      online
    );
    expect(missingPhone.status).toBe(EBaileysConnectionStatus.connecting);
  });

  it('clears stale QR fields and preserves pairing progress on an accepted native transition', () => {
    const projected = applyWhatsappConnectionStatus(
      runtimeState({
        code: ECodeMessage.pairingInProgress,
        qrcode: 'data:image/png;base64,stale',
        qr_pending: true,
      }),
      snapshot({
        status: EWhatsappConnectionStatus.connecting,
        authenticated: true,
        sessionValid: true,
        qrAvailable: false,
        sequence: 4,
      })
    );

    expect(projected.code).toBe(ECodeMessage.pairingInProgress);
    expect(projected.qrcode).toBeUndefined();
    expect(projected.qr_pending).toBe(false);
  });

  it.each([
    EWorkerStatus.new,
    EWorkerStatus.creating,
    EWorkerStatus.recreating,
    EWorkerStatus.disponible,
    EWorkerStatus.online,
    EWorkerStatus.offline,
    EWorkerStatus.mismatched,
    EWorkerStatus.error,
    EWorkerStatus.blocked,
    EWorkerStatus.stopped,
    EWorkerStatus.delete,
    EWorkerStatus.deleting,
  ])(
    'keeps persisted worker status %s as the display truth',
    (workerStatusId) => {
      for (const workerTypeId of [
        EWorkerType.baileys,
        EWorkerType.wwebjs,
        EWorkerType.whatsmeow,
      ]) {
        for (const connectionStatus of [
          'qr',
          'connecting',
          'online',
          'offline',
          'reconnect_required',
          'error',
        ] as const) {
          expect(
            projectWhatsappChannelDisplayStatus({
              workerTypeId,
              workerStatusId,
              connectionStatus,
              connectionOnlineAcknowledged: connectionStatus === 'online',
            })
          ).toEqual({ kind: 'worker', workerStatusId });
        }
      }
    }
  );

  it('preserves the nullable persisted status when native evidence exists', () => {
    expect(
      projectWhatsappChannelDisplayStatus({
        workerTypeId: EWorkerType.wwebjs,
        workerStatusId: null,
        connectionStatus: 'offline',
      })
    ).toEqual({ kind: 'worker', workerStatusId: null });
  });
});
