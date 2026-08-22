import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-b',
    baileysWorkerId: 'worker-b',
    runtimeGeneration: 41,
  },
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
    runtimeGeneration: 42,
  },
}));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  workerCentrifugoQueue: (accountId: string) => `worker-${accountId}`,
}));

jest.mock('@core/services/baileys', () => ({
  BaileysService: class {},
}));

jest.mock('@core/services/wwebjs', () => ({
  WwebjsService: class {},
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';
import { WorkerConnectionStatusWwebjsConsume } from '@core/consumer/worker/WorkerConnectionStatusWwebjs.consume';

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('Worker connection status consumers', () => {
  const payload = {
    worker_id: 'worker',
    status: EWorkerStatus.online,
    type: EBaileysConnectionType.qrcode,
  };

  it.each([ECodeMessage.awaitConnection, ECodeMessage.awaitingReadQrCode])(
    'keeps an active Baileys socket during non-QR reconciliation (%s)',
    async (code) => {
      const baileysService = {
        isConnected: jest.fn(() => false),
        hasSession: jest.fn(() => false),
        getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
        getCode: jest.fn(() => code),
        socket: {},
        connect: jest.fn(),
        republishLastState: jest.fn(),
      };
      const sut = new WorkerConnectionStatusConsume(
        baileysService as never,
        { notifyWorkerStatus: jest.fn() } as never,
        { publishSub: jest.fn() } as never
      );

      const result = await sut.requestConnection({
        ...payload,
        qr_pending: false,
        connection_attempt_id: 'attempt-reconciliation',
        runtime_generation: 3,
      });

      expect(baileysService.connect).not.toHaveBeenCalled();
      expect(baileysService.republishLastState).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          status: EBaileysConnectionStatus.connecting,
          code,
        })
      );
    }
  );

  it('preserves an active Baileys retry during non-QR reconciliation', async () => {
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.disconnected),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: undefined,
      connect: jest.fn(),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );
    const internalState = sut as unknown as {
      activeConnectionRequest: typeof payload & {
        connection_attempt_id: string;
      };
    };
    internalState.activeConnectionRequest = {
      ...payload,
      connection_attempt_id: 'active-attempt',
    };

    const result = await sut.requestConnection({
      ...payload,
      qr_pending: false,
      connection_attempt_id: 'reconciliation-attempt',
    });

    expect(baileysService.connect).not.toHaveBeenCalled();
    expect(internalState.activeConnectionRequest).toEqual(
      expect.objectContaining({ connection_attempt_id: 'active-attempt' })
    );
    expect(result).toEqual(
      expect.objectContaining({
        connection_attempt_id: 'active-attempt',
        code: ECodeMessage.awaitConnection,
      })
    );
  });

  it('restarts a stale Baileys socket only for an explicit QR request', async () => {
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: {},
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-b',
        account_id: 'account-b',
      })),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    await sut.requestConnection({
      ...payload,
      qr_pending: true,
      connection_attempt_id: 'explicit-qr-attempt',
      runtime_generation: 3,
    });

    expect(baileysService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        force_new: true,
        initial_connection: true,
        requested_by_user: true,
        connection_attempt_id: 'explicit-qr-attempt',
        runtime_generation: 3,
      })
    );
  });

  it('reuses the QR already emitted by the same Baileys attempt', async () => {
    const currentQrState = {
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
      connection_attempt_id: 'explicit-qr-attempt',
      qrcode: 'current-attempt-qr',
    };
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      getCode: jest.fn(() => ECodeMessage.awaitingReadQrCode),
      socket: {},
      connect: jest.fn(),
      republishLastState: jest.fn((attemptId?: string) =>
        attemptId === currentQrState.connection_attempt_id
          ? currentQrState
          : undefined
      ),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    const result = await sut.requestConnection({
      ...payload,
      qr_pending: true,
      connection_attempt_id: 'explicit-qr-attempt',
      runtime_generation: 3,
    });

    expect(baileysService.connect).not.toHaveBeenCalled();
    expect(baileysService.republishLastState).toHaveBeenCalledWith(
      'explicit-qr-attempt'
    );
    expect(result).toEqual(currentQrState);
  });

  it('continues an active Baileys pairing flow even for an explicit QR request', async () => {
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      getCode: jest.fn(() => ECodeMessage.pairingInProgress),
      socket: {},
      connect: jest.fn(),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    const result = await sut.requestConnection({
      ...payload,
      qr_pending: true,
      connection_attempt_id: 'explicit-qr-attempt',
    });

    expect(baileysService.connect).not.toHaveBeenCalled();
    expect(baileysService.republishLastState).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.pairingInProgress,
      })
    );
  });

  it('does not mark a Baileys reconciliation connection as user-requested', async () => {
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.disconnected),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: undefined,
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: 'worker-b',
        account_id: 'account-b',
      })),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    await sut.requestConnection({
      ...payload,
      qr_pending: false,
      connection_attempt_id: 'reconciliation-attempt',
    });

    expect(baileysService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        force_new: false,
        requested_by_user: false,
        connection_attempt_id: 'reconciliation-attempt',
      })
    );
  });

  it('starts a new Baileys QR flow for an explicit pending request', async () => {
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.disconnected),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: undefined,
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-b',
        account_id: 'account-b',
      })),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    await sut.requestConnection({
      ...payload,
      qr_pending: true,
      connection_attempt_id: 'explicit-qr-attempt',
    });

    expect(baileysService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        force_new: false,
        requested_by_user: true,
        connection_attempt_id: 'explicit-qr-attempt',
      })
    );
  });

  it('delegates an already connected Baileys status to session readiness verification', async () => {
    const connectedState = {
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      worker_id: 'worker-b',
      account_id: 'account-b',
      phone: '556199999999',
      worker_status_id: EWorkerStatus.online,
      session_ready: true,
    };
    const baileysService = {
      isConnected: jest.fn(() => true),
      verifyAndPublishConnectionStatus: jest.fn(async () => connectedState),
    };
    const centrifugoService = { publishSub: jest.fn() };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      centrifugoService as never
    );

    const result = await sut.requestConnection({
      ...payload,
      connection_attempt_id: 'attempt-1',
      debug_trace_id: 'trace-1',
    });

    expect(
      baileysService.verifyAndPublishConnectionStatus
    ).toHaveBeenCalledWith({
      connection_attempt_id: 'attempt-1',
      debug_trace_id: 'trace-1',
      runtime_generation: 41,
    });
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(result).toBe(connectedState);
  });

  it('preserves connection metadata while recreating a Baileys worker', async () => {
    const baileysService = {
      reconnect: jest.fn(),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    const result = await sut.requestConnection({
      ...payload,
      status: EWorkerStatus.recreating,
      connection_attempt_id: 'recreate-attempt',
      runtime_generation: 52,
      debug_trace_id: 'recreate-trace',
    });

    expect(baileysService.reconnect).toHaveBeenCalledWith({
      initial_connection: true,
      connection_attempt_id: 'recreate-attempt',
      runtime_generation: 52,
      debug_trace_id: 'recreate-trace',
    });
    expect(result).toEqual(
      expect.objectContaining({
        connection_attempt_id: 'recreate-attempt',
        runtime_generation: 52,
        debug_trace_id: 'recreate-trace',
      })
    );
  });

  it('preserves connection metadata through disponible disconnect and retry', async () => {
    const baileysService = {
      disconnect: jest.fn(async () => undefined),
      isConnected: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.disconnected),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: undefined,
      clearUserRequestedDisconnect: jest.fn(),
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        worker_id: 'worker-b',
        account_id: 'account-b',
      })),
    };
    const balance = { notifyWorkerStatus: jest.fn(async () => undefined) };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      balance as never,
      { publishSub: jest.fn(async () => undefined) } as never
    );

    const result = await sut.requestConnection({
      ...payload,
      status: EWorkerStatus.disponible,
      connection_attempt_id: 'disponible-attempt',
      runtime_generation: 53,
      debug_trace_id: 'disponible-trace',
    });
    await flushPromises();

    expect(baileysService.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_attempt_id: 'disponible-attempt',
        runtime_generation: 53,
        debug_trace_id: 'disponible-trace',
      })
    );
    expect(balance.notifyWorkerStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_attempt_id: 'disponible-attempt',
        runtime_generation: 53,
        debug_trace_id: 'disponible-trace',
      })
    );
    expect(baileysService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_attempt_id: 'disponible-attempt',
        runtime_generation: 53,
        debug_trace_id: 'disponible-trace',
        from_disconnect_restart: true,
      })
    );
    expect(result.runtime_generation).toBe(53);
    await sut.close();
  });

  it('lets the manager exclusively finalize an explicit Baileys session removal', async () => {
    const baileysService = {
      disconnect: jest.fn(async () => undefined),
    };
    const notifyWorkerStatus = jest.fn(async () => undefined);
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus } as never,
      { publishSub: jest.fn() } as never
    );

    await sut.requestConnection({
      ...payload,
      status: EWorkerStatus.disponible,
      remove_session: true,
      connection_attempt_id: 'remove-baileys-attempt',
      runtime_generation: 54,
    });

    expect(baileysService.disconnect).toHaveBeenCalledTimes(1);
    expect(notifyWorkerStatus).not.toHaveBeenCalled();
  });

  it('lets the manager exclusively finalize an explicit WWebJS session removal', async () => {
    const wwebjsService = {
      disconnect: jest.fn(async () => undefined),
    };
    const notifyWorkerStatus = jest.fn(async () => undefined);
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus } as never,
      { publishSub: jest.fn() } as never
    );

    await sut.requestConnection({
      ...payload,
      status: EWorkerStatus.disponible,
      remove_session: true,
      connection_attempt_id: 'remove-wwebjs-attempt',
      runtime_generation: 55,
    });

    expect(wwebjsService.disconnect).toHaveBeenCalledTimes(1);
    expect(notifyWorkerStatus).not.toHaveBeenCalled();
  });

  it('keeps active metadata when retry ownership is handed to the service', () => {
    const baileysService = {
      clearUserRequestedDisconnect: jest.fn(),
      reconnect: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );
    const internal = sut as unknown as {
      activeConnectionRequest: typeof payload & {
        connection_attempt_id: string;
        runtime_generation: number;
        debug_trace_id: string;
      };
      handoffToServiceReconnect: () => void;
    };
    internal.activeConnectionRequest = {
      ...payload,
      connection_attempt_id: 'handoff-attempt',
      runtime_generation: 54,
      debug_trace_id: 'handoff-trace',
    };

    internal.handoffToServiceReconnect();

    expect(baileysService.reconnect).toHaveBeenCalledWith({
      initial_connection: true,
      connection_attempt_id: 'handoff-attempt',
      runtime_generation: 54,
      debug_trace_id: 'handoff-trace',
    });
  });

  it('falls back to the runtime generation from the Baileys environment', () => {
    const sut = new WorkerConnectionStatusConsume(
      {
        getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      } as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );
    const internal = sut as unknown as {
      currentState: (code: ECodeMessage) => { runtime_generation?: number };
    };

    expect(
      internal.currentState(ECodeMessage.awaitConnection).runtime_generation
    ).toBe(41);
  });

  it('restarts a stale WWebJS connecting socket immediately for user requests', async () => {
    const wwebjsService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: {},
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-w',
        account_id: 'account-w',
      })),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    sut.requestConnection({
      ...payload,
      qr_pending: true,
    });
    await flushPromises();

    expect(wwebjsService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        allow_restore: false,
        force_new: true,
        initial_connection: true,
        requested_by_user: true,
      })
    );
  });

  it.each([ECodeMessage.awaitConnection, ECodeMessage.awaitingReadQrCode])(
    'keeps an active WWebJS socket instead of replacing it during recreate reconciliation (%s)',
    async (code) => {
      const wwebjsService = {
        isConnected: jest.fn(() => false),
        hasSession: jest.fn(() => true),
        getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
        getCode: jest.fn(() => code),
        socket: {},
        connect: jest.fn(),
        republishLastState: jest.fn(),
      };
      const sut = new WorkerConnectionStatusWwebjsConsume(
        wwebjsService as never,
        { notifyWorkerStatus: jest.fn() } as never,
        { publishSub: jest.fn() } as never
      );

      const result = await sut.requestConnection(payload);

      expect(wwebjsService.connect).not.toHaveBeenCalled();
      expect(wwebjsService.republishLastState).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          status: EBaileysConnectionStatus.connecting,
          code,
        })
      );
    }
  );

  it('returns promptly while a preserved WWebJS session keeps restoring in the background', async () => {
    let resolveConnect:
      | ((state: {
          status: EBaileysConnectionStatus;
          code: ECodeMessage;
          worker_id: string;
          account_id: string;
        }) => void)
      | undefined;
    const connectPending = new Promise<{
      status: EBaileysConnectionStatus;
      code: ECodeMessage;
      worker_id: string;
      account_id: string;
    }>((resolve) => {
      resolveConnect = resolve;
    });
    const wwebjsService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => true),
      getStatus: jest.fn(() => EBaileysConnectionStatus.disconnected),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: undefined,
      connect: jest.fn(() => connectPending),
      disconnect: jest.fn(async () => undefined),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    try {
      const result = await sut.requestConnection(payload);

      expect(result).toEqual(
        expect.objectContaining({
          status: EBaileysConnectionStatus.disconnected,
          code: ECodeMessage.awaitConnection,
        })
      );
      expect(wwebjsService.disconnect).not.toHaveBeenCalled();
      expect(wwebjsService.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          allow_restore: true,
          from_disconnect_restart: false,
          requested_by_user: false,
        })
      );
      expect(connectPending).toEqual(expect.any(Promise));

      resolveConnect?.({
        status: EBaileysConnectionStatus.connected,
        code: ECodeMessage.connectionEstablished,
        worker_id: 'worker-w',
        account_id: 'account-w',
      });
      await flushPromises();
    } finally {
      await sut.close();
    }
  });

  it('delegates an already connected WWebJS status to session readiness verification', async () => {
    const connectedState = {
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      worker_id: 'worker-w',
      account_id: 'account-w',
      phone: '556188888888',
      worker_status_id: EWorkerStatus.online,
      session_ready: true,
    };
    const wwebjsService = {
      isConnected: jest.fn(() => true),
      verifyAndPublishConnectionStatus: jest.fn(async () => connectedState),
    };
    const centrifugoService = { publishSub: jest.fn() };
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      centrifugoService as never
    );

    const result = await sut.requestConnection({
      ...payload,
      connection_attempt_id: 'attempt-2',
      runtime_generation: 9,
      debug_trace_id: 'trace-2',
    });

    expect(wwebjsService.verifyAndPublishConnectionStatus).toHaveBeenCalledWith(
      {
        connection_attempt_id: 'attempt-2',
        runtime_generation: 9,
        debug_trace_id: 'trace-2',
      }
    );
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(result).toBe(connectedState);
  });

  it('clears a stale WWebJS session before generating a queued QR', async () => {
    jest.useFakeTimers();
    const wwebjsService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => true),
      getStatus: jest.fn(() => EBaileysConnectionStatus.disconnected),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: undefined,
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-w',
        account_id: 'account-w',
      })),
      disconnect: jest.fn(async () => undefined),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    try {
      const pending = sut.requestConnection({
        ...payload,
        qr_pending: true,
        connection_attempt_id: 'attempt-1',
      });

      await jest.advanceTimersByTimeAsync(3000);
      await pending;

      expect(wwebjsService.disconnect).toHaveBeenCalledWith(
        expect.objectContaining({
          preserve_session: false,
          remove_session: true,
        })
      );
      expect(wwebjsService.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          allow_restore: false,
          from_disconnect_restart: true,
          requested_by_user: true,
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('publishes a retryable WWebJS QR failure without deleting the session', async () => {
    const notifyWorkerStatus = jest.fn(async () => undefined);
    const publishSub = jest.fn(async () => undefined);
    const wwebjsService = {
      cancelConnectionAttempt: jest.fn(),
    };
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus } as never,
      { publishSub } as never
    );

    const result = await sut.publishQrCodeAttemptFailed(
      {
        ...payload,
        connection_attempt_id: 'attempt-terminal',
        runtime_generation: 73,
        debug_trace_id: 'trace-terminal',
        qr_pending: false,
      },
      {
        attempt: 6,
        maxAttempts: 5,
        reason: 'wwebjs_qr_connection_temporarily_unavailable:econnrefused',
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: EBaileysConnectionStatus.disconnected,
        code: ECodeMessage.connectionClosed,
        worker_id: 'worker-w',
        account_id: 'account-w',
        worker_status_id: EWorkerStatus.disponible,
        connection_attempt_id: 'attempt-terminal',
        runtime_generation: 73,
        qr_pending: false,
        attempt: 6,
        max_attempts: 5,
        retryable: true,
        session_ready: false,
        authenticated: false,
      })
    );
    expect(notifyWorkerStatus).toHaveBeenCalledWith(result);
    expect(publishSub).toHaveBeenCalledWith('worker-account-w', result);
    expect(wwebjsService.cancelConnectionAttempt).not.toHaveBeenCalled();
  });

  it('rejects a WWebJS QR failure when its durable projection is unavailable', async () => {
    const durableError = new Error('durable projection unavailable');
    const notifyWorkerStatus = jest.fn(async () => {
      throw durableError;
    });
    const publishSub = jest.fn(async () => undefined);
    const sut = new WorkerConnectionStatusWwebjsConsume(
      { cancelConnectionAttempt: jest.fn() } as never,
      { notifyWorkerStatus } as never,
      { publishSub } as never
    );

    await expect(
      sut.publishQrCodeAttemptFailed(
        {
          ...payload,
          connection_attempt_id: 'attempt-durable-failure',
          qr_pending: false,
        },
        {
          attempt: 6,
          maxAttempts: 5,
          reason: 'wwebjs_qr_connection_temporarily_unavailable',
        }
      )
    ).rejects.toBe(durableError);

    expect(publishSub).not.toHaveBeenCalled();
  });
});
