import 'reflect-metadata';

const mockDownloadMediaBuffer = jest.fn(async (_url: string) => ({
  buffer: Buffer.from('profile'),
  contentType: 'image/jpeg',
  contentLength: 7,
  filename: 'profile.jpg',
}));

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    MessageMedia: class {},
  },
}));

jest.mock('@core/common/functions/downloadMediaBuffer', () => ({
  downloadMediaBuffer: (url: string) => mockDownloadMediaBuffer(url),
}));

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsWorkerId: 'worker-w',
    wwebjsAccountId: 'account-w',
  },
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: (jid?: string | null) => jid ?? undefined,
}));

jest.mock('@core/services/wwebjs/methods/connection.service', () => ({
  WwebjsConnectionService: class {},
}));

jest.mock('@core/services/wwebjs/methods/deliveryConfirmation.service', () => ({
  WwebjsDeliveryConfirmationService: class {},
}));

jest.mock('@core/services/typingSimulationRuntime.service', () => ({
  TypingSimulationRuntimeService: class {},
}));

import { WwebjsHelpersService } from '@core/services/wwebjs/methods/helpers.service';

describe('WwebjsHelpersService message ids', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('confirms a sent message using the new $1 id shape', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const serializedId = 'true_158733669765176@lid_3EB0D96A98D7EC10E7C610';
    const sentMessage = {
      id: {
        fromMe: true,
        remote: '158733669765176@lid',
        remoteJid: '158733669765176@lid',
        id: '3EB0D96A98D7EC10E7C610',
        $1: serializedId,
        name: 'MessageKey',
      },
    };
    const client = {
      sendMessage: jest.fn(async () => sentMessage),
    };
    const deliveryConfirmation = {
      markSent: jest.fn(() => true),
      waitForOutcome: jest.fn(async () => 'sent'),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      deliveryConfirmation as never,
      {
        getConfig: jest.fn(async () => ({ enabled: false, speed: 50 })),
      } as never
    );

    await expect(
      service.sendMessage('158733669765176@lid', 'teste')
    ).resolves.toBe(sentMessage);

    expect(client.sendMessage).toHaveBeenCalledWith(
      '158733669765176@lid',
      'teste',
      expect.objectContaining({ waitUntilMsgSent: false })
    );
    expect(deliveryConfirmation.markSent).toHaveBeenCalledWith(serializedId);
    expect(deliveryConfirmation.waitForOutcome).toHaveBeenCalledWith(
      serializedId,
      20_000
    );
  });

  it('fails closed when the provider boundary fails', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = {
      sendMessage: jest.fn(),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {} as never,
      {
        getConfig: jest.fn(async () => ({ enabled: false, speed: 50 })),
      } as never
    );
    const beforeProviderInvoke = jest.fn(async () => {
      throw new Error('idempotency unavailable');
    });

    await expect(
      service.sendMessage(
        '5511999999999@c.us',
        'teste',
        undefined,
        beforeProviderInvoke
      )
    ).rejects.toThrow('idempotency unavailable');

    expect(beforeProviderInvoke).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('rechecks a resolved boundary synchronously and reverses a microtask revocation before the SDK starts', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const boundaryError = new Error('dispatch_revoked_after_boundary');
    const client = {
      sendMessage: jest.fn(),
    };
    const connection = {
      connected: true,
      getSocket: jest.fn(() => client),
    };
    const service = new WwebjsHelpersService(
      connection as never,
      {} as never,
      {
        getConfig: jest.fn(async () => ({ enabled: false, speed: 50 })),
      } as never
    );
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
      service.sendMessage('5511999999999@c.us', 'teste', undefined, boundary)
    ).rejects.toBe(boundaryError);

    expect(boundary).toHaveBeenCalledTimes(1);
    expect(onStartRejected).toHaveBeenCalledWith(boundaryError);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('does not retry another JID after the provider boundary was crossed', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = {
      sendMessage: jest.fn(async () => {
        throw new Error('No LID for user');
      }),
      getContactLidAndPhone: jest.fn(async () => ({
        lid: '123@lid',
        pn: '5511999999999@c.us',
      })),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {} as never,
      {
        getConfig: jest.fn(async () => ({ enabled: false, speed: 50 })),
      } as never
    );
    const beforeProviderInvoke = jest.fn(async () => undefined);

    await expect(
      service.sendMessage('123@c.us', 'teste', undefined, beforeProviderInvoke)
    ).rejects.toThrow('No LID for user');

    expect(beforeProviderInvoke).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(client.getContactLidAndPhone).not.toHaveBeenCalled();
  });

  it('bounds a stuck provider acceptance call and consumes its late rejection', async () => {
    const previousTimeout = process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS;
    process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let rejectProvider: ((error: Error) => void) | undefined;
    const providerCall = new Promise<never>((_resolve, reject) => {
      rejectProvider = reject;
    });
    const client = {
      sendMessage: jest.fn(() => providerCall),
    };
    const deliveryConfirmation = {
      markSent: jest.fn(),
      waitForOutcome: jest.fn(),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      deliveryConfirmation as never,
      {
        getConfig: jest.fn(async () => ({ enabled: false, speed: 50 })),
      } as never
    );

    try {
      const send = service.sendMessage('5511999999999@c.us', 'teste');
      const rejection = expect(send).rejects.toMatchObject({
        name: 'WwebjsSendMessageTimeoutError',
        code: 'WWEBJS_SEND_MESSAGE_TIMEOUT',
        message: 'Wwebjs sendMessage timed out after 5000ms',
      });

      await jest.advanceTimersByTimeAsync(5_000);
      await rejection;

      expect(client.sendMessage).toHaveBeenCalledWith(
        '5511999999999@c.us',
        'teste',
        expect.objectContaining({ waitUntilMsgSent: false })
      );
      expect(deliveryConfirmation.markSent).not.toHaveBeenCalled();
      expect(deliveryConfirmation.waitForOutcome).not.toHaveBeenCalled();

      rejectProvider?.(new Error('late Puppeteer rejection'));
      await jest.advanceTimersByTimeAsync(0);
      expect(console.warn).toHaveBeenCalledWith(
        '[WwebjsSend] send_rejected_after_application_timeout',
        expect.objectContaining({
          jid_hash: expect.stringMatching(/^sha256:/),
          timeout_ms: 5_000,
        })
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS;
      } else {
        process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('fences a timed-out client before the boundary, ignores late settlement, and accepts a recreated client', async () => {
    const previousTimeout = process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS;
    process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS = '5000';
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      let resolveLate!: (value: { id: { _serialized: string } }) => void;
      const oldClient = {
        sendMessage: jest.fn(
          () =>
            new Promise((resolve) => {
              resolveLate = resolve;
            })
        ),
      };
      const freshMessage = {
        id: { _serialized: 'true_5511999999999@c.us_fresh' },
      };
      const freshClient = {
        sendMessage: jest.fn(async () => freshMessage),
      };
      const connection = {
        getSocket: jest.fn(() => oldClient),
        reportOutboundSendSuccess: jest.fn(),
        reportOutboundSendFailure: jest.fn(() => false),
        ensureOutboundSendRecovery: jest.fn(),
      };
      const deliveryConfirmation = {
        markSent: jest.fn(),
        waitForOutcome: jest.fn(async () => 'sent'),
      };
      const service = new WwebjsHelpersService(
        connection as never,
        deliveryConfirmation as never,
        {
          getConfig: jest.fn(async () => ({ enabled: false, speed: 50 })),
        } as never
      );
      const boundary = jest.fn(async () => undefined);
      const first = service.sendMessage(
        '5511999999999@c.us',
        {} as never,
        undefined,
        boundary
      );
      const firstRejection = expect(first).rejects.toMatchObject({
        code: 'WWEBJS_SEND_MESSAGE_TIMEOUT',
      });

      await jest.advanceTimersByTimeAsync(5000);
      await firstRejection;

      await expect(
        service.sendMessage(
          '5511999999999@c.us',
          {} as never,
          undefined,
          boundary
        )
      ).rejects.toMatchObject({
        code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
        retryable: true,
      });
      expect(oldClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(boundary).toHaveBeenCalledTimes(1);
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledWith(
        oldClient
      );

      resolveLate({
        id: { _serialized: 'true_5511999999999@c.us_late' },
      });
      await Promise.resolve();
      await Promise.resolve();
      await expect(
        service.sendMessage(
          '5511999999999@c.us',
          {} as never,
          undefined,
          boundary
        )
      ).rejects.toMatchObject({
        code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT',
      });
      expect(oldClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledTimes(2);

      connection.getSocket.mockReturnValue(freshClient);
      await expect(
        service.sendMessage(
          '5511999999999@c.us',
          {} as never,
          undefined,
          boundary
        )
      ).resolves.toBe(freshMessage);
      expect(freshClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(boundary).toHaveBeenCalledTimes(2);
      expect(connection.reportOutboundSendFailure).toHaveBeenCalledWith(
        oldClient,
        expect.objectContaining({ code: 'WWEBJS_SEND_MESSAGE_TIMEOUT' }),
        { timedOut: true }
      );
      expect(connection.reportOutboundSendSuccess).toHaveBeenCalledWith(
        freshClient
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS;
      } else {
        process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('caps long typing, clears presence, and leaves no simulation running after send', async () => {
    const previousTimeout = process.env.TYPING_SIMULATION_MAX_DELAY_MS;
    process.env.TYPING_SIMULATION_MAX_DELAY_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sentMessage = {
      id: { _serialized: 'true_5511999999999@c.us_typing-timeout' },
    };
    const chat = {
      sendStateTyping: jest.fn(async () => undefined),
      clearState: jest.fn(async () => undefined),
    };
    const client = {
      getChatById: jest.fn(async () => chat),
      sendMessage: jest.fn(async () => sentMessage),
    };
    const deliveryConfirmation = {
      markSent: jest.fn(),
      waitForOutcome: jest.fn(async () => 'sent'),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      deliveryConfirmation as never,
      {
        getConfig: jest.fn(async () => ({ enabled: true, speed: 50 })),
      } as never
    );

    try {
      const send = service.sendMessage(
        '5511999999999@c.us',
        'texto muito longo '.repeat(2_000)
      );
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(send).resolves.toBe(sentMessage);
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
      expect(chat.sendStateTyping).toHaveBeenCalled();
      expect(chat.clearState).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        '[WwebjsTypingSimulation] deadline exceeded',
        expect.objectContaining({ timeout_ms: 1_000 })
      );

      const presenceCallsAfterSend =
        chat.sendStateTyping.mock.calls.length +
        chat.clearState.mock.calls.length;
      await jest.advanceTimersByTimeAsync(60_000);
      expect(
        chat.sendStateTyping.mock.calls.length +
          chat.clearState.mock.calls.length
      ).toBe(presenceCallsAfterSend);
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
    const sentMessage = {
      id: { _serialized: 'true_5511999999999@c.us_stuck-config' },
    };
    const client = {
      sendMessage: jest.fn(async () => sentMessage),
    };
    const typingSimulationRuntime = {
      getConfig: jest.fn(() => new Promise(() => undefined)),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {
        markSent: jest.fn(),
        waitForOutcome: jest.fn(async () => 'sent'),
      } as never,
      typingSimulationRuntime as never
    );

    try {
      const send = service.sendMessage('5511999999999@c.us', 'teste');
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(send).resolves.toBe(sentMessage);
      await expect(
        service.sendMessage('5511999999999@c.us', 'second')
      ).resolves.toBe(sentMessage);
      await expect(
        service.sendMessage('5511999999999@c.us', 'third')
      ).resolves.toBe(sentMessage);
      expect(client.sendMessage).toHaveBeenCalledTimes(3);
      expect(typingSimulationRuntime.getConfig).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        '[WwebjsTypingSimulation] deadline exceeded',
        expect.objectContaining({ timeout_ms: 1_000 })
      );
      expect(console.warn).toHaveBeenCalledWith(
        '[WwebjsTypingSimulation] skipped while previous operation is still pending'
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

  it('honors the hard typing cap when presence cleanup never settles', async () => {
    const previousTimeout = process.env.TYPING_SIMULATION_MAX_DELAY_MS;
    process.env.TYPING_SIMULATION_MAX_DELAY_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sentMessage = {
      id: { _serialized: 'true_5511999999999@c.us_stuck-cleanup' },
    };
    const chat = {
      sendStateTyping: jest.fn(async () => undefined),
      clearState: jest.fn(() => new Promise(() => undefined)),
    };
    const client = {
      getChatById: jest.fn(async () => chat),
      sendMessage: jest.fn(async () => sentMessage),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {
        markSent: jest.fn(),
        waitForOutcome: jest.fn(async () => 'sent'),
      } as never,
      {
        getConfig: jest.fn(async () => ({ enabled: true, speed: 50 })),
      } as never
    );

    try {
      const send = service.sendMessage(
        '5511999999999@c.us',
        'texto muito longo '.repeat(2_000)
      );
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(send).resolves.toBe(sentMessage);
      expect(chat.sendStateTyping).toHaveBeenCalled();
      expect(chat.clearState).toHaveBeenCalledTimes(1);
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
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
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const chat = {
      sendStateTyping: jest.fn(async () => undefined),
      clearState: jest.fn(async () => undefined),
    };
    const client = {
      getChatById: jest.fn(async () => chat),
      sendMessage: jest.fn(),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {} as never,
      {
        getConfig: jest.fn(async () => ({ enabled: true, speed: 50 })),
      } as never
    );
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
      const send = service.sendMessage(
        '5511999999999@c.us',
        'texto muito longo '.repeat(2_000),
        undefined,
        boundary
      );
      const rejection = expect(send).rejects.toBe(revoked);
      await jest.advanceTimersByTimeAsync(500);
      expect(chat.sendStateTyping).toHaveBeenCalled();

      active = false;
      await jest.advanceTimersByTimeAsync(50);

      await rejection;
      expect(chat.clearState).toHaveBeenCalledTimes(1);
      expect(boundary).not.toHaveBeenCalled();
      expect(client.sendMessage).not.toHaveBeenCalled();
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.TYPING_SIMULATION_MAX_DELAY_MS;
      } else {
        process.env.TYPING_SIMULATION_MAX_DELAY_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('downloads a profile photo before crossing the provider boundary', async () => {
    const client = {
      setProfilePicture: jest.fn(),
    };
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {} as never,
      {} as never
    );
    const beforeProviderInvoke = jest.fn(async () => undefined);
    mockDownloadMediaBuffer.mockRejectedValueOnce(
      new Error('profile media download failed')
    );

    await expect(
      service.updateProfilePicture(
        'https://cdn.example/profile.jpg',
        beforeProviderInvoke
      )
    ).rejects.toThrow('profile media download failed');

    expect(beforeProviderInvoke).not.toHaveBeenCalled();
    expect(client.setProfilePicture).not.toHaveBeenCalled();
  });

  it('fences a timed-out profile mutation and does not replay after its late completion', async () => {
    const previousTimeout = process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      let resolveLate!: () => void;
      const client = {
        setStatus: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveLate = resolve;
            })
        ),
      };
      const connection = {
        getSocket: jest.fn(() => client),
        reportOutboundSendFailure: jest.fn(() => false),
        ensureOutboundSendRecovery: jest.fn(),
      };
      const service = new WwebjsHelpersService(
        connection as never,
        {} as never,
        {} as never
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
      expect(client.setStatus).toHaveBeenCalledTimes(1);
      expect(connection.reportOutboundSendFailure).toHaveBeenCalledWith(
        client,
        expect.objectContaining({
          code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        }),
        { timedOut: true }
      );

      await expect(
        service.updateProfileStatus('must-not-replay', boundary)
      ).rejects.toMatchObject({ code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' });
      expect(client.setStatus).toHaveBeenCalledTimes(1);
      expect(boundary).toHaveBeenCalledTimes(1);

      resolveLate();
      await Promise.resolve();
      await Promise.resolve();

      await expect(
        service.updateProfileStatus('still-fenced', boundary)
      ).rejects.toMatchObject({ code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' });
      expect(client.setStatus).toHaveBeenCalledTimes(1);
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledWith(
        client
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

  it('fences a stuck lookup, observes its late rejection, and permits a recreated client', async () => {
    const previousTimeout = process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      let rejectLate!: (error: Error) => void;
      const oldClient = {};
      const freshClient = {};
      const connection = {
        getSocket: jest.fn(() => oldClient),
        reportOutboundSendFailure: jest.fn(() => false),
        ensureOutboundSendRecovery: jest.fn(),
      };
      const service = new WwebjsHelpersService(
        connection as never,
        {} as never,
        {} as never
      );
      const invokeOld = jest.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectLate = reject;
          })
      );
      const lookup = service.invokeProviderLookup(
        oldClient as never,
        'quoted_message_lookup',
        invokeOld
      );
      const rejection = expect(lookup).rejects.toMatchObject({
        code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        operation: 'quoted_message_lookup',
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await rejection;

      expect(invokeOld).toHaveBeenCalledTimes(1);
      expect(connection.reportOutboundSendFailure).toHaveBeenCalledWith(
        oldClient,
        expect.objectContaining({
          code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        }),
        { timedOut: true }
      );
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledWith(
        oldClient
      );

      await expect(
        service.invokeProviderLookup(
          oldClient as never,
          'quoted_message_lookup',
          invokeOld
        )
      ).rejects.toMatchObject({ code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' });
      expect(invokeOld).toHaveBeenCalledTimes(1);

      rejectLate(new Error('late lookup rejection'));
      await jest.advanceTimersByTimeAsync(0);
      expect(warnSpy).toHaveBeenCalledWith(
        '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
        expect.objectContaining({
          provider: 'wwebjs',
          operation: 'quoted_message_lookup',
          timeout_ms: 1_000,
        })
      );

      await expect(
        service.invokeProviderLookup(
          freshClient as never,
          'quoted_message_lookup',
          async () => 'fresh-result'
        )
      ).resolves.toBe('fresh-result');
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
      } else {
        process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('keeps healthy auxiliary lookups concurrent on the same client', async () => {
    const client = {};
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {} as never,
      {} as never
    );
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const firstProviderCall = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const secondProviderCall = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSecond = resolve;
        })
    );

    const first = service.invokeProviderLookup(
      client as never,
      'reaction_message_lookup',
      firstProviderCall
    );
    const second = service.invokeProviderLookup(
      client as never,
      'reaction_message_lookup',
      secondProviderCall
    );

    expect(firstProviderCall).toHaveBeenCalledTimes(1);
    expect(secondProviderCall).toHaveBeenCalledTimes(1);

    resolveSecond('second');
    resolveFirst('first');
    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ]);
  });

  it('fails a provider mutation closed when its durable boundary fails', async () => {
    const client = {};
    const service = new WwebjsHelpersService(
      { getSocket: jest.fn(() => client) } as never,
      {} as never,
      {} as never
    );
    const boundary = jest.fn(async () => {
      throw new Error('durable ledger unavailable');
    });
    const providerMutation = jest.fn(async () => 'must-not-run');

    await expect(
      service.invokeProviderMutation(
        client as never,
        'delete_message',
        boundary,
        providerMutation
      )
    ).rejects.toThrow('durable ledger unavailable');

    expect(boundary).toHaveBeenCalledTimes(1);
    expect(providerMutation).not.toHaveBeenCalled();
  });
});
