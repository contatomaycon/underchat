import 'reflect-metadata';

const mockGenerateMessageIDV2 = jest.fn(
  (jid: string) => `generated-message-id-${jid}`
);
const mockGenerateWAMessageContent = jest.fn();
const mockGenerateWAMessageFromContent = jest.fn();
const mockAudioMessageFromObject = jest.fn((value: unknown) => value);
const mockMessageFromObject = jest.fn((value: unknown) => value);

jest.mock('@whiskeysockets/baileys', () => ({
  generateMessageIDV2: (jid: string) => mockGenerateMessageIDV2(jid),
  generateWAMessageContent: (...args: unknown[]) =>
    mockGenerateWAMessageContent(...args),
  generateWAMessageFromContent: (...args: unknown[]) =>
    mockGenerateWAMessageFromContent(...args),
  proto: {
    Message: {
      AudioMessage: {
        fromObject: (value: unknown) => mockAudioMessageFromObject(value),
      },
      fromObject: (value: unknown) => mockMessageFromObject(value),
    },
  },
}));

const mockOnlyDigits = jest.fn((value: string) => value.replace(/\D/g, ''));
const mockBuildCandidates = jest.fn((value: string, _options?: unknown) => [
  value,
]);
const mockNormalizeJid = jest.fn((jid?: string) =>
  jid ? jid.replace('@s.whatsapp.net', '@c.us') : undefined
);

jest.mock('@core/common/functions/onlyDigits', () => ({
  onlyDigits: (value: string) => mockOnlyDigits(value),
}));

jest.mock('@core/common/functions/buildCandidatesBR', () => ({
  buildCandidates: (value: string, options: unknown) =>
    mockBuildCandidates(value, options),
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: (jid?: string) => mockNormalizeJid(jid),
}));

jest.mock('@core/services/baileys/methods/connection.service', () => ({
  BaileysConnectionService: class {},
}));

jest.mock(
  '@core/services/baileys/methods/deliveryConfirmation.service',
  () => ({
    BaileysDeliveryConfirmationService: class {},
  })
);

jest.mock('@core/services/typingSimulationRuntime.service', () => ({
  TypingSimulationRuntimeService: class {},
}));

import { BaileysHelpersService } from '@core/services/baileys/methods/helpers.service';
import { resolveBaileysSendMessageTimeoutMs } from '@core/services/baileys/util/providerSendTimeout';

describe('BaileysHelpersService', () => {
  const originalWorkerId = process.env.WORKER_ID;
  const originalAccountId = process.env.ACCOUNT_ID;
  const originalSendMessageTimeoutMs =
    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS;

  const makeService = () => {
    const socket = {
      user: {
        id: '5511999999999@s.whatsapp.net',
      },
      waUploadToServer: jest.fn<Promise<undefined>, []>(async () => undefined),
      onWhatsApp: jest.fn<
        Promise<Array<{ exists: boolean; jid: string | null }>>,
        [string]
      >(async () => []),
      sendMessage: jest.fn<
        Promise<{ key?: { id?: string } } | undefined>,
        [string, unknown, unknown?]
      >(async () => ({ key: { id: 'message-1' } })),
      sendPresenceUpdate: jest.fn(async () => undefined),
      relayMessage: jest.fn(async () => undefined),
      updateProfileName: jest.fn(async () => undefined),
      updateProfileStatus: jest.fn(async () => undefined),
      removeProfilePicture: jest.fn(async () => undefined),
      updateProfilePicture: jest.fn(async () => undefined),
    };

    const connection = {
      getSocket: jest.fn(() => socket),
      connected: true,
      reportOutboundSendSuccess: jest.fn(),
      reportOutboundSendFailure: jest.fn(() => false),
      ensureOutboundSendRecovery: jest.fn(),
    };

    const deliveryConfirmation = {
      waitForOutcome: jest.fn<
        Promise<'sent' | 'failed' | 'timeout'>,
        [string, number]
      >(async () => 'sent'),
    };

    const typingSimulationRuntime = {
      getConfig: jest.fn(async () => ({ enabled: true, speed: 50 })),
    };

    const service = new BaileysHelpersService(
      connection as never,
      deliveryConfirmation as never,
      typingSimulationRuntime as never
    );

    return {
      service,
      socket,
      connection,
      deliveryConfirmation,
      typingSimulationRuntime,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WORKER_ID = 'worker-1';
    process.env.ACCOUNT_ID = 'account-1';
    if (originalSendMessageTimeoutMs === undefined) {
      delete process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS;
    } else {
      process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS =
        originalSendMessageTimeoutMs;
    }

    mockOnlyDigits.mockImplementation((value: string) =>
      value.replace(/\D/g, '')
    );
    mockBuildCandidates.mockImplementation((value: string) => [value]);
    mockNormalizeJid.mockImplementation((jid?: string) =>
      jid ? jid.replace('@s.whatsapp.net', '@c.us') : undefined
    );

    mockGenerateWAMessageContent.mockResolvedValue({
      audioMessage: { id: 'audio-message' },
      messageContextInfo: { ctx: true },
    });

    mockGenerateWAMessageFromContent.mockReturnValue({
      key: { id: 'vo-msg-1' },
      message: { viewOnceMessage: { message: { audioMessage: { id: 'a1' } } } },
    });
  });

  afterAll(() => {
    if (originalWorkerId === undefined) {
      delete process.env.WORKER_ID;
    } else {
      process.env.WORKER_ID = originalWorkerId;
    }

    if (originalAccountId === undefined) {
      delete process.env.ACCOUNT_ID;
    } else {
      process.env.ACCOUNT_ID = originalAccountId;
    }

    if (originalSendMessageTimeoutMs === undefined) {
      delete process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS;
    } else {
      process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS =
        originalSendMessageTimeoutMs;
    }
  });

  it('validates socket access and readiness guards', async () => {
    const { service, connection, socket } = makeService();
    const sut = service as any;

    connection.getSocket.mockReturnValueOnce(undefined as never);
    expect(() => sut.socket()).toThrow('Socket not connected');

    connection.connected = false;
    expect(() => sut.assertSocketReadyForSend(socket)).toThrow(
      'Baileys connection unavailable: socket is not connected yet'
    );

    connection.connected = true;
    socket.user.id = undefined as never;
    expect(() => sut.assertSocketReadyForSend(socket)).toThrow(
      'Baileys connection unavailable: auth state is not ready yet'
    );
  });

  it('uses the bounded production-safe provider deadline without requiring an env override', () => {
    delete process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS;
    expect(resolveBaileysSendMessageTimeoutMs()).toBe(45_000);

    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS = 'invalid';
    expect(resolveBaileysSendMessageTimeoutMs()).toBe(45_000);

    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS = '100';
    expect(resolveBaileysSendMessageTimeoutMs()).toBe(5_000);

    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS = '999999';
    expect(resolveBaileysSendMessageTimeoutMs()).toBe(120_000);
  });

  it('sends text message with jid resolution and delivery confirmation', async () => {
    const { service, socket, deliveryConfirmation, typingSimulationRuntime } =
      makeService();

    const simulateTypingSpy = jest
      .spyOn(service as any, 'simulateHumanTyping')
      .mockResolvedValue(undefined);

    mockBuildCandidates.mockReturnValueOnce(['5511999999999']);
    socket.onWhatsApp.mockResolvedValueOnce([
      { exists: true, jid: '5511999999999@s.whatsapp.net' },
    ]);

    await expect(
      service.send('5511999999999', { text: 'hello' })
    ).resolves.toEqual({ key: { id: 'message-1' } });

    expect(simulateTypingSpy).toHaveBeenCalledWith(
      '5511999999999@c.us',
      {
        text: 'hello',
      },
      50,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        checkpoint: expect.any(Function),
        sleep: expect.any(Function),
      })
    );
    expect(typingSimulationRuntime.getConfig).toHaveBeenCalledWith(
      'worker-1',
      'account-1'
    );
    expect(socket.sendMessage).toHaveBeenCalledWith(
      '5511999999999@c.us',
      { text: 'hello' },
      undefined
    );
    expect(deliveryConfirmation.waitForOutcome).toHaveBeenCalledWith(
      'message-1',
      20_000
    );
  });

  it('crosses the idempotency boundary only after preflight and immediately before send', async () => {
    const { service, socket } = makeService();
    const order: string[] = [];
    jest
      .spyOn(service as any, 'simulateHumanTyping')
      .mockImplementation(async () => {
        order.push('typing');
      });
    socket.sendMessage.mockImplementationOnce(async () => {
      order.push('provider');
      return { key: { id: 'message-boundary' } };
    });
    const beforeProviderInvoke = jest.fn(async () => {
      order.push('provider_invoked');
    });

    await service.send(
      '55119999@c.us',
      { text: 'hello' },
      undefined,
      beforeProviderInvoke
    );

    expect(order).toEqual(['typing', 'provider_invoked', 'provider']);
    expect(beforeProviderInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the provider when the boundary fails', async () => {
    const { service, socket } = makeService();
    const boundaryError = new Error('redis_transition_uncertain');

    await expect(
      service.send('55119999@c.us', { text: 'hello' }, undefined, async () => {
        throw boundaryError;
      })
    ).rejects.toBe(boundaryError);

    expect(socket.sendMessage).not.toHaveBeenCalled();
  });

  it('rechecks a resolved boundary synchronously and reverses a microtask revocation before the SDK starts', async () => {
    const { service, socket } = makeService();
    const boundaryError = new Error('dispatch_revoked_after_boundary');
    let active = true;
    const onStartRejected = jest.fn(async () => undefined);
    const boundary = Object.assign(
      jest.fn(() => {
        const alreadyResolved = Promise.resolve();
        queueMicrotask(() => {
          active = false;
        });
        return alreadyResolved;
      }),
      {
        assertActive: () => {
          if (!active) {
            throw boundaryError;
          }
        },
        onStartRejected,
      }
    );

    await expect(
      service.send('55119999@c.us', { text: 'hello' }, undefined, boundary)
    ).rejects.toBe(boundaryError);

    expect(boundary).toHaveBeenCalledTimes(1);
    expect(onStartRejected).toHaveBeenCalledWith(boundaryError);
    expect(socket.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects excess provider concurrency before crossing the durable boundary or starting another SDK call', async () => {
    const { service, socket, connection } = makeService();
    const resolvers: Array<(result: { key: { id: string } }) => void> = [];
    socket.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const admittedBoundaries = Array.from({ length: 4 }, () =>
      jest.fn(async () => undefined)
    );
    const admitted = admittedBoundaries.map((boundary) =>
      service.send(
        '55119999@c.us',
        { image: Buffer.from('image') },
        undefined,
        boundary
      )
    );

    while (socket.sendMessage.mock.calls.length < 4) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const rejectedBoundary = jest.fn(async () => undefined);
    await expect(
      service.send(
        '55119999@c.us',
        { image: Buffer.from('excess') },
        undefined,
        rejectedBoundary
      )
    ).rejects.toMatchObject({
      code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
    });

    expect(rejectedBoundary).not.toHaveBeenCalled();
    expect(socket.sendMessage).toHaveBeenCalledTimes(4);
    expect(connection.ensureOutboundSendRecovery).not.toHaveBeenCalled();

    resolvers.forEach((resolve, index) =>
      resolve({ key: { id: `bounded-${index}` } })
    );
    await expect(Promise.all(admitted)).resolves.toHaveLength(4);
  });

  it('caps long typing, clears presence, and leaves no simulation running after send', async () => {
    const previousTimeout = process.env.TYPING_SIMULATION_MAX_DELAY_MS;
    process.env.TYPING_SIMULATION_MAX_DELAY_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { service, socket } = makeService();
      const send = service.send('55119999@c.us', {
        text: 'texto muito longo '.repeat(2_000),
      });
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(send).resolves.toEqual({ key: { id: 'message-1' } });
      expect(socket.sendMessage).toHaveBeenCalledTimes(1);
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith(
        'composing',
        '55119999@c.us'
      );
      expect(socket.sendPresenceUpdate).toHaveBeenLastCalledWith(
        'paused',
        '55119999@c.us'
      );
      expect(console.warn).toHaveBeenCalledWith(
        '[BaileysTypingSimulation] deadline exceeded',
        expect.objectContaining({ timeout_ms: 1_000 })
      );

      const presenceCallsAfterSend =
        socket.sendPresenceUpdate.mock.calls.length;
      await jest.advanceTimersByTimeAsync(60_000);
      expect(socket.sendPresenceUpdate).toHaveBeenCalledTimes(
        presenceCallsAfterSend
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.TYPING_SIMULATION_MAX_DELAY_MS;
      } else {
        process.env.TYPING_SIMULATION_MAX_DELAY_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('honors the hard typing cap when runtime configuration never settles', async () => {
    const previousTimeout = process.env.TYPING_SIMULATION_MAX_DELAY_MS;
    process.env.TYPING_SIMULATION_MAX_DELAY_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { service, socket, typingSimulationRuntime } = makeService();
      typingSimulationRuntime.getConfig.mockReturnValueOnce(
        new Promise(() => undefined)
      );

      const send = service.send('55119999@c.us', { text: 'hello' });
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(send).resolves.toEqual({ key: { id: 'message-1' } });
      await expect(
        service.send('55119999@c.us', { text: 'second' })
      ).resolves.toEqual({ key: { id: 'message-1' } });
      await expect(
        service.send('55119999@c.us', { text: 'third' })
      ).resolves.toEqual({ key: { id: 'message-1' } });
      expect(socket.sendPresenceUpdate).not.toHaveBeenCalled();
      expect(socket.sendMessage).toHaveBeenCalledTimes(3);
      expect(typingSimulationRuntime.getConfig).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        '[BaileysTypingSimulation] deadline exceeded',
        expect.objectContaining({ timeout_ms: 1_000 })
      );
      expect(console.warn).toHaveBeenCalledWith(
        '[BaileysTypingSimulation] skipped while previous operation is still pending'
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.TYPING_SIMULATION_MAX_DELAY_MS;
      } else {
        process.env.TYPING_SIMULATION_MAX_DELAY_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('honors the hard typing cap when the presence SDK call never settles', async () => {
    const previousTimeout = process.env.TYPING_SIMULATION_MAX_DELAY_MS;
    process.env.TYPING_SIMULATION_MAX_DELAY_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { service, socket } = makeService();
      socket.sendPresenceUpdate.mockImplementationOnce(
        () => new Promise(() => undefined)
      );

      const send = service.send('55119999@c.us', {
        text: 'texto muito longo '.repeat(2_000),
      });
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(send).resolves.toEqual({ key: { id: 'message-1' } });
      expect(socket.sendPresenceUpdate).toHaveBeenCalledTimes(1);
      expect(socket.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.TYPING_SIMULATION_MAX_DELAY_MS;
      } else {
        process.env.TYPING_SIMULATION_MAX_DELAY_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('cancels typing cleanly and never invokes the provider after parent revocation', async () => {
    const previousTimeout = process.env.TYPING_SIMULATION_MAX_DELAY_MS;
    process.env.TYPING_SIMULATION_MAX_DELAY_MS = '60000';
    jest.useFakeTimers();
    const { service, socket } = makeService();
    const revoked = new Error('parent dispatch revoked');
    let active = true;
    const boundary = Object.assign(
      jest.fn(async () => undefined),
      {
        assertActive: jest.fn(() => {
          if (!active) {
            throw revoked;
          }
        }),
      }
    );

    try {
      const send = service.send(
        '55119999@c.us',
        { text: 'texto muito longo '.repeat(2_000) },
        undefined,
        boundary
      );
      const rejection = expect(send).rejects.toBe(revoked);
      await jest.advanceTimersByTimeAsync(500);
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith(
        'composing',
        '55119999@c.us'
      );

      active = false;
      await jest.advanceTimersByTimeAsync(50);

      await rejection;
      expect(socket.sendPresenceUpdate).toHaveBeenLastCalledWith(
        'paused',
        '55119999@c.us'
      );
      expect(boundary).not.toHaveBeenCalled();
      expect(socket.sendMessage).not.toHaveBeenCalled();
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.TYPING_SIMULATION_MAX_DELAY_MS;
      } else {
        process.env.TYPING_SIMULATION_MAX_DELAY_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('fails a stuck provider send at the application deadline and observes a late rejection', async () => {
    jest.useFakeTimers();
    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS = '5000';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    let rejectProvider: (reason: Error) => void = () => undefined;

    try {
      const { service, socket, deliveryConfirmation } = makeService();
      socket.sendMessage.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectProvider = reject;
          })
      );

      const sendPromise = service.send('55119999@c.us', {
        edit: { id: 'x' },
      } as never);
      const rejection = expect(sendPromise).rejects.toMatchObject({
        name: 'BaileysSendMessageTimeoutError',
        code: 'BAILEYS_SEND_MESSAGE_TIMEOUT',
        message: 'Baileys provider send timed out after 5000ms',
      });

      await jest.advanceTimersByTimeAsync(5000);
      await rejection;

      expect(deliveryConfirmation.waitForOutcome).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[BaileysSend] provider_send_timeout',
        expect.objectContaining({
          operation: 'send_message',
          timeout_ms: 5000,
        })
      );

      rejectProvider(new Error('late provider failure'));
      await Promise.resolve();

      expect(warnSpy).toHaveBeenCalledWith(
        '[BaileysSend] provider_send_rejected_after_application_timeout',
        expect.objectContaining({
          operation: 'send_message',
          timeout_ms: 5000,
          error: {
            name: 'Error',
            message: 'late provider failure',
          },
        })
      );
    } finally {
      jest.useRealTimers();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      delete process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS;
    }
  });

  it('keeps healthy provider calls concurrent', async () => {
    const { service, socket } = makeService();
    const resolvers: Array<(value: { key: { id: string } }) => void> = [];
    socket.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const boundary = jest.fn(async () => undefined);

    const first = service.send(
      '55119999@c.us',
      { edit: { id: 'first' } } as never,
      undefined,
      boundary
    );
    const second = service.send(
      '55119999@c.us',
      { edit: { id: 'second' } } as never,
      undefined,
      boundary
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(socket.sendMessage).toHaveBeenCalledTimes(2);
    expect(boundary).toHaveBeenCalledTimes(2);

    resolvers[0]?.({ key: { id: 'provider-first' } });
    resolvers[1]?.({ key: { id: 'provider-second' } });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { key: { id: 'provider-first' } },
      { key: { id: 'provider-second' } },
    ]);
  });

  it('fences a timed-out socket before the boundary, ignores late settlement, and accepts a recreated socket', async () => {
    jest.useFakeTimers();
    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS = '5000';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    try {
      const { service, socket, connection } = makeService();
      let resolveLate!: (value: { key: { id: string } }) => void;
      socket.sendMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          })
      );
      const boundary = jest.fn(async () => undefined);
      const first = service.send(
        '55119999@c.us',
        { edit: { id: 'timeout' } } as never,
        undefined,
        boundary
      );
      const firstRejection = expect(first).rejects.toMatchObject({
        code: 'BAILEYS_SEND_MESSAGE_TIMEOUT',
      });

      await jest.advanceTimersByTimeAsync(5000);
      await firstRejection;

      await expect(
        service.send(
          '55119999@c.us',
          { edit: { id: 'fenced' } } as never,
          undefined,
          boundary
        )
      ).rejects.toMatchObject({
        code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
        retryable: true,
      });
      expect(socket.sendMessage).toHaveBeenCalledTimes(1);
      expect(boundary).toHaveBeenCalledTimes(1);
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledWith(
        socket
      );

      resolveLate({ key: { id: 'provider-late' } });
      await Promise.resolve();
      await Promise.resolve();
      await expect(
        service.send(
          '55119999@c.us',
          { edit: { id: 'still-fenced' } } as never,
          undefined,
          boundary
        )
      ).rejects.toMatchObject({
        code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
      });
      expect(socket.sendMessage).toHaveBeenCalledTimes(1);
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledTimes(2);

      const freshSocket = {
        ...socket,
        sendMessage: jest.fn<
          Promise<{ key: { id: string } }>,
          [string, unknown, unknown?]
        >(async () => ({
          key: { id: 'provider-fresh' },
        })),
      };
      connection.getSocket.mockReturnValue(freshSocket);
      await expect(
        service.send(
          '55119999@c.us',
          { edit: { id: 'fresh' } } as never,
          undefined,
          boundary
        )
      ).resolves.toEqual({ key: { id: 'provider-fresh' } });
      expect(freshSocket.sendMessage).toHaveBeenCalledTimes(1);
      expect(boundary).toHaveBeenCalledTimes(2);
      expect(connection.reportOutboundSendFailure).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({ code: 'BAILEYS_SEND_MESSAGE_TIMEOUT' }),
        { timedOut: true }
      );
      expect(connection.reportOutboundSendSuccess).toHaveBeenCalledWith(
        freshSocket
      );
    } finally {
      jest.useRealTimers();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      delete process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS;
    }
  });

  it('clears the provider deadline timer after a successful send', async () => {
    jest.useFakeTimers();
    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS = '5000';

    try {
      const { service } = makeService();

      await expect(
        service.send('55119999@c.us', { edit: { id: 'x' } } as never)
      ).resolves.toEqual({ key: { id: 'message-1' } });

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      delete process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS;
    }
  });

  it('keeps view-once audio generation before the provider boundary', async () => {
    const { service, socket } = makeService();
    const order: string[] = [];
    mockGenerateWAMessageContent.mockImplementationOnce(async () => {
      order.push('media_upload');
      return {
        audioMessage: { id: 'audio-message' },
        messageContextInfo: { ctx: true },
      };
    });
    mockGenerateWAMessageFromContent.mockImplementationOnce(() => {
      order.push('message_build');
      return {
        key: { id: 'vo-msg-boundary' },
        message: { content: true },
      };
    });
    socket.relayMessage.mockImplementationOnce(async () => {
      order.push('provider');
    });

    await service.send(
      'jid@c.us',
      { audio: { url: 'x' }, viewOnce: true } as never,
      undefined,
      async () => {
        order.push('provider_invoked');
      }
    );

    expect(order).toEqual([
      'media_upload',
      'message_build',
      'provider_invoked',
      'provider',
    ]);
  });

  it('does not simulate typing when channel setting is disabled', async () => {
    const { service, typingSimulationRuntime } = makeService();
    const simulateTypingSpy = jest
      .spyOn(service as any, 'simulateHumanTyping')
      .mockResolvedValue(undefined);

    typingSimulationRuntime.getConfig.mockResolvedValueOnce({
      enabled: false,
      speed: 95,
    });

    await expect(
      service.send('55119999@c.us', { text: 'hello' })
    ).resolves.toEqual({
      key: { id: 'message-1' },
    });

    expect(simulateTypingSpy).not.toHaveBeenCalled();
  });

  it('fails pre-acceptance errors but preserves an accepted provider result when confirmation fails or times out', async () => {
    const { service, socket, connection, deliveryConfirmation } = makeService();
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      mockBuildCandidates.mockReturnValueOnce(['5511000']);
      socket.onWhatsApp.mockResolvedValueOnce([{ exists: false, jid: null }]);

      await expect(service.send('5511000', { text: 'x' })).rejects.toThrow(
        'Number not found on WhatsApp: 5511000'
      );

      socket.sendMessage.mockResolvedValueOnce({ key: {} });
      await expect(
        service.send('55119999@c.us', { text: 'x' })
      ).rejects.toThrow('Failed to send message: missing key.id');
      expect(connection.reportOutboundSendFailure).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({
          code: 'BAILEYS_PROVIDER_PROTOCOL_FAILURE',
        })
      );

      socket.sendMessage.mockResolvedValue({ key: { id: 'message-2' } });
      deliveryConfirmation.waitForOutcome.mockResolvedValueOnce('failed');

      await expect(
        service.send('55119999@c.us', { text: 'x' })
      ).resolves.toEqual({ key: { id: 'message-2' } });

      deliveryConfirmation.waitForOutcome.mockResolvedValueOnce('timeout');

      await expect(
        service.send('55119999@c.us', { text: 'x' })
      ).resolves.toEqual({ key: { id: 'message-2' } });
      await Promise.resolve();

      expect(socket.sendMessage).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledWith(
        '[BaileysSend] delivery_confirmation_unconfirmed_after_provider_accept',
        {
          message_id_hash: expect.stringMatching(/^sha256:/),
          outcome: 'failed',
        }
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[BaileysSend] delivery_confirmation_unconfirmed_after_provider_accept',
        {
          message_id_hash: expect.stringMatching(/^sha256:/),
          outcome: 'timeout',
        }
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns the provider message id without waiting for a stuck delivery observer', async () => {
    const { service, socket, deliveryConfirmation } = makeService();
    deliveryConfirmation.waitForOutcome.mockReturnValueOnce(
      new Promise(() => undefined)
    );

    await expect(
      service.send('55119999@c.us', { text: 'accepted once' })
    ).resolves.toEqual({ key: { id: 'message-1' } });

    expect(socket.sendMessage).toHaveBeenCalledTimes(1);
    expect(deliveryConfirmation.waitForOutcome).toHaveBeenCalledWith(
      'message-1',
      20_000
    );
  });

  it('bypasses delivery confirmation for edit messages and validates sendOnce branches', async () => {
    const { service, socket, connection, deliveryConfirmation } = makeService();
    const sut = service as any;

    const sendAudioViewOnceMessageSpy = jest
      .spyOn(sut, 'sendAudioViewOnceMessage')
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce({ key: { id: 'audio-ok' } });

    await expect(
      sut.sendOnce(
        socket,
        'jid@c.us',
        { audio: { url: 'x' }, viewOnce: true },
        undefined
      )
    ).rejects.toThrow(
      'Failed to send message to jid@c.us: result is undefined'
    );

    await expect(
      sut.sendOnce(
        socket,
        'jid@c.us',
        { audio: { url: 'x' }, viewOnce: true },
        undefined
      )
    ).resolves.toEqual({ key: { id: 'audio-ok' } });

    socket.sendMessage.mockResolvedValueOnce(undefined);
    await expect(
      sut.sendOnce(socket, 'jid@c.us', { text: 'hello' }, undefined)
    ).rejects.toThrow(
      'Failed to send message to jid@c.us: result is undefined'
    );

    socket.sendMessage.mockResolvedValueOnce({ key: { id: 'edit-msg' } });

    await expect(
      service.send('jid@c.us', { edit: { id: 'x' } } as never)
    ).resolves.toEqual({ key: { id: 'edit-msg' } });

    expect(deliveryConfirmation.waitForOutcome).not.toHaveBeenCalled();
    expect(sendAudioViewOnceMessageSpy).toHaveBeenCalledTimes(2);
    expect(connection.reportOutboundSendFailure).toHaveBeenNthCalledWith(
      1,
      socket,
      expect.objectContaining({
        code: 'BAILEYS_PROVIDER_PROTOCOL_FAILURE',
      })
    );
    expect(connection.reportOutboundSendFailure).toHaveBeenNthCalledWith(
      2,
      socket,
      expect.objectContaining({
        code: 'BAILEYS_PROVIDER_PROTOCOL_FAILURE',
      })
    );
  });

  it('builds and relays view-once audio payload and handles payload errors', async () => {
    const { service, socket } = makeService();
    const sut = service as any;

    socket.user.id = undefined as never;
    await expect(
      sut.sendAudioViewOnceMessage(socket, 'jid@c.us', {
        audio: { url: 'x' },
        viewOnce: true,
      })
    ).rejects.toThrow(
      'Baileys connection unavailable: auth state is not ready'
    );

    socket.user.id = '5511999999999@s.whatsapp.net';

    mockGenerateWAMessageFromContent.mockReturnValueOnce({
      key: { id: 'vo-msg-2' },
      message: undefined,
    });

    await expect(
      sut.sendAudioViewOnceMessage(
        socket,
        'jid@c.us',
        {
          audio: { url: 'a' },
          viewOnce: true,
          ptt: true,
          waveform: new Uint8Array([1, 2]),
          mimetype: ' audio/ogg ',
          seconds: '12',
        },
        { messageId: 'explicit-id' }
      )
    ).rejects.toThrow(
      'Failed to send view-once audio: message payload missing'
    );

    mockGenerateWAMessageFromContent.mockReturnValueOnce({
      key: { id: 'vo-msg-3' },
      message: { content: true },
    });

    await expect(
      sut.sendAudioViewOnceMessage(
        socket,
        'jid@c.us',
        {
          audio: { url: 'a' },
          viewOnce: true,
          ptt: true,
          waveform: new Uint8Array([1, 2]),
          mimetype: ' audio/ogg ',
          seconds: '12',
          contextInfo: { participant: 'p1' },
        },
        {
          mediaUploadTimeoutMs: 5000,
          useCachedGroupMetadata: true,
          statusJidList: ['a@c.us'],
        }
      )
    ).resolves.toEqual({ key: { id: 'vo-msg-3' }, message: { content: true } });

    expect(mockGenerateWAMessageContent).toHaveBeenLastCalledWith(
      {
        audio: { url: 'a' },
        ptt: true,
        seconds: 12,
        waveform: new Uint8Array([1, 2]),
        mimetype: 'audio/ogg',
        contextInfo: { participant: 'p1' },
      },
      {
        upload: socket.waUploadToServer,
        mediaUploadTimeoutMs: 5000,
      }
    );

    expect(socket.relayMessage).toHaveBeenCalledWith(
      'jid@c.us',
      { content: true },
      {
        messageId: 'vo-msg-3',
        useCachedGroupMetadata: true,
        statusJidList: ['a@c.us'],
      }
    );
  });

  it('covers typing simulation, utility parsers and text extraction helpers', async () => {
    const { service, socket } = makeService();
    const sut = service as any;

    socket.user.id = undefined as never;
    await expect(
      sut.simulateHumanTyping('jid@c.us', { text: 'hello' })
    ).resolves.toBeUndefined();

    socket.user.id = '5511999999999@s.whatsapp.net';
    jest.spyOn(sut, 'estimateTypingMs').mockReturnValue(0);
    jest.spyOn(sut, 'sleep').mockResolvedValue(undefined);

    await expect(
      sut.simulateHumanTyping('jid@c.us', { text: 'hello' })
    ).resolves.toBeUndefined();

    expect(socket.sendPresenceUpdate).toHaveBeenNthCalledWith(
      1,
      'composing',
      'jid@c.us'
    );
    expect(socket.sendPresenceUpdate).toHaveBeenLastCalledWith(
      'paused',
      'jid@c.us'
    );

    expect(sut.toPositiveNumber(10)).toBe(10);
    expect(sut.toPositiveNumber('15')).toBe(15);
    expect(sut.toPositiveNumber('abc')).toBeUndefined();

    expect(sut.toWaveform(new Uint8Array([1]))).toEqual(new Uint8Array([1]));
    expect(sut.toWaveform(new Uint8Array([]))).toBeUndefined();
    expect(sut.toWaveform('x')).toBeUndefined();

    expect(sut.toNonEmptyString('  abc ')).toBe('abc');
    expect(sut.toNonEmptyString('   ')).toBeUndefined();
    expect(sut.toNonEmptyString(12)).toBeUndefined();

    expect(sut.isAudioViewOnceMessage({ audio: {}, viewOnce: true })).toBe(
      true
    );
    expect(sut.isAudioViewOnceMessage({ audio: {}, viewOnce: false })).toBe(
      false
    );

    expect(sut.shouldSimulateTyping({ react: { text: 'x' } })).toBe(false);
    expect(sut.shouldSimulateTyping({ edit: { id: '1' } })).toBe(false);
    expect(sut.shouldSimulateTyping({ text: '  hi  ' })).toBe(true);
    expect(sut.shouldSimulateTyping({ text: '   ' })).toBe(false);

    expect(sut.extractText({ text: 'plain' })).toBe('plain');
    expect(sut.extractText({ caption: 'cap' })).toBe('cap');
    expect(sut.extractText({ extendedTextMessage: { text: 'ext' } })).toBe(
      'ext'
    );
    expect(sut.extractText({ react: { text: '🙂' } })).toBe('🙂');
    expect(sut.extractText({})).toBe('');

    expect(sut.countGraphemes('a🙂')).toBe(2);
    (sut.estimateTypingMs as jest.Mock).mockRestore();
    jest.spyOn(sut, 'rand').mockReturnValue(500);
    expect(sut.estimateTypingMs('')).toBe(500);
  });

  it('resolves own jid, profile methods, jid candidates and status list augmentation', async () => {
    const { service, socket, connection } = makeService();
    const sut = service as any;

    await expect(service.updateProfileName('Name')).resolves.toBeUndefined();
    await expect(
      service.updateProfileStatus('Status')
    ).resolves.toBeUndefined();
    await expect(
      service.removeProfilePicture('jid@c.us')
    ).resolves.toBeUndefined();
    await expect(
      service.updateProfilePicture('https://image')
    ).resolves.toBeUndefined();

    expect(socket.updateProfilePicture).toHaveBeenCalledWith(
      '5511999999999@c.us',
      {
        url: 'https://image',
      }
    );

    socket.user.id = undefined as never;
    expect(() => service.getOwnJid()).toThrow('Own JID not available');

    socket.user.id = '5511999999999@s.whatsapp.net';
    mockNormalizeJid.mockReturnValueOnce(undefined);
    expect(() => service.getOwnJid()).toThrow('Failed to normalize own JID');

    mockNormalizeJid.mockReturnValue('5511999999999@c.us');
    expect(service.getOwnJid()).toBe('5511999999999@c.us');

    mockNormalizeJid.mockImplementation((jid?: string) =>
      jid ? jid.replace('@s.whatsapp.net', '@c.us') : undefined
    );

    mockBuildCandidates.mockReturnValueOnce(['55119999', '55118888']);
    socket.onWhatsApp
      .mockResolvedValueOnce([{ exists: false, jid: null }])
      .mockResolvedValueOnce([
        { exists: true, jid: '55118888@s.whatsapp.net' },
      ]);

    await expect(sut.resolveJidFlexible(socket, '55119999')).resolves.toEqual({
      exists: true,
      jid: '55118888@c.us',
    });

    mockBuildCandidates.mockReturnValueOnce(['55117777']);
    socket.onWhatsApp.mockResolvedValueOnce([{ exists: false, jid: null }]);
    await expect(sut.resolveJidFlexible(socket, '55117777')).resolves.toEqual({
      exists: false,
      jid: undefined,
    });

    expect(service.addOwnJidToStatusList(['111@c.us'])).toEqual([
      '111@c.us',
      '5511999999999@c.us',
    ]);

    expect(
      service.addOwnJidToStatusList([
        '111@c.us',
        '5511999999999@s.whatsapp.net',
      ])
    ).toEqual(['111@c.us', '5511999999999@s.whatsapp.net']);

    connection.getSocket.mockImplementationOnce(() => {
      throw new Error('socket fail');
    });
    expect(service.addOwnJidToStatusList(['x@c.us'])).toEqual(['x@c.us']);
  });

  it('runs profile preflight before the boundary and blocks mutation on boundary failure', async () => {
    const { service, socket, connection } = makeService();
    const order: string[] = [];
    socket.updateProfilePicture.mockImplementationOnce(async () => {
      order.push('provider');
    });

    await service.updateProfilePicture('https://image', async () => {
      order.push('provider_invoked');
    });
    expect(order).toEqual(['provider_invoked', 'provider']);

    const boundary = jest.fn(async () => undefined);
    connection.getSocket.mockReturnValueOnce(undefined as never);
    await expect(service.updateProfileName('Name', boundary)).rejects.toThrow(
      'Socket not connected'
    );
    expect(boundary).not.toHaveBeenCalled();

    const boundaryError = new Error('redis_transition_uncertain');
    await expect(
      service.updateProfileStatus('Status', async () => {
        throw boundaryError;
      })
    ).rejects.toBe(boundaryError);
    expect(socket.updateProfileStatus).not.toHaveBeenCalled();
  });

  it('fences a timed-out profile mutation and never invokes it again after late completion', async () => {
    const previousTimeout = process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { service, socket, connection } = makeService();
      let resolveLate!: (value: undefined) => void;
      socket.updateProfileStatus.mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            resolveLate = resolve;
          })
      );
      const boundary = jest.fn(async () => undefined);
      const first = service.updateProfileStatus('stalled', boundary);
      const rejection = expect(first).rejects.toMatchObject({
        code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        operation: 'update_profile_status',
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await rejection;

      expect(boundary).toHaveBeenCalledTimes(1);
      expect(socket.updateProfileStatus).toHaveBeenCalledTimes(1);
      expect(connection.reportOutboundSendFailure).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({
          code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        }),
        { timedOut: true }
      );

      await expect(
        service.updateProfileStatus('must-not-replay', boundary)
      ).rejects.toMatchObject({ code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' });
      expect(socket.updateProfileStatus).toHaveBeenCalledTimes(1);
      expect(boundary).toHaveBeenCalledTimes(1);

      resolveLate(undefined);
      await Promise.resolve();
      await Promise.resolve();

      await expect(
        service.updateProfileStatus('still-fenced', boundary)
      ).rejects.toMatchObject({ code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' });
      expect(socket.updateProfileStatus).toHaveBeenCalledTimes(1);
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledWith(
        socket
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
      } else {
        process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });
});
