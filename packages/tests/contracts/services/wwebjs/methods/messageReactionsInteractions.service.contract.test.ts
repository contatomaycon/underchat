import 'reflect-metadata';

const mockParseSerializedMessageId = jest.fn<
  {
    fromMe?: boolean;
    remoteJid?: string;
    stanzaId?: string;
  } | null,
  [string]
>((value: string) => {
  if (value === 'parsed-id') {
    return {
      fromMe: true,
      remoteJid: '5511999999999@c.us',
      stanzaId: 'stanza-1',
    };
  }

  const parts = value.split('_');
  if (parts.length >= 3 && (parts[0] === 'true' || parts[0] === 'false')) {
    return {
      fromMe: parts[0] === 'true',
      remoteJid: parts[1],
      stanzaId: parts.slice(2).join('_'),
    };
  }

  return null;
});

const mockMessageToWaLike = jest.fn((input: unknown) => ({
  key: {
    id:
      (input as { id?: { _serialized?: string } | string })?.id &&
      typeof (input as { id?: unknown }).id === 'object'
        ? ((input as { id: { _serialized?: string } }).id._serialized ??
          'mapped')
        : 'mapped',
  },
}));

jest.mock('@core/common/functions/parseSerializedMessageId', () => ({
  parseSerializedMessageId: (value: string) =>
    mockParseSerializedMessageId(value),
}));

jest.mock('@core/services/wwebjs/methods/helpers.service', () => ({
  WwebjsHelpersService: class {},
}));

jest.mock('@core/services/wwebjs/util/messageToWaLike', () => ({
  messageToWaLike: (input: unknown) => mockMessageToWaLike(input),
}));

import { WwebjsMessageReactionsInteractionsService } from '@core/services/wwebjs/methods/messageReactionsInteractions.service';

describe('WwebjsMessageReactionsInteractionsService', () => {
  const makeService = () => {
    const client = {
      pupPage: {
        evaluate: jest.fn<Promise<void>, [unknown, string, string]>(
          async () => undefined
        ),
      },
      getMessageById: jest.fn<Promise<unknown>, [string]>(async () => null),
      getChatById: jest.fn<Promise<unknown>, [string]>(async () => ({
        fetchMessages: jest.fn<Promise<unknown[]>, [Record<string, unknown>]>(
          async () => []
        ),
      })),
    };

    const helpers = {
      getClient: jest.fn(() => client),
    };

    const service = new WwebjsMessageReactionsInteractionsService(
      helpers as never
    );

    return {
      service,
      helpers,
      client,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('react returns undefined when source message cannot be resolved', async () => {
    const { service } = makeService();
    const sut = service as unknown as {
      resolveMessageByKey: (key: unknown) => Promise<unknown | null>;
    };

    jest.spyOn(sut, 'resolveMessageByKey').mockResolvedValueOnce(null);

    await expect(
      service.react({ id: 'parsed-id', remoteJid: '5511@c.us' } as never, '🔥')
    ).resolves.toBeUndefined();
  });

  it('react returns undefined when resolved message has no serializable id', async () => {
    const { service } = makeService();
    const sut = service as unknown as {
      resolveMessageByKey: (key: unknown) => Promise<unknown | null>;
    };

    jest.spyOn(sut, 'resolveMessageByKey').mockResolvedValueOnce({ id: '' });

    await expect(
      service.react({ id: 'parsed-id', remoteJid: '5511@c.us' } as never, '🔥')
    ).resolves.toBeUndefined();
  });

  it('react throws when puppeteer page is unavailable', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveMessageByKey: (key: unknown) => Promise<unknown | null>;
    };
    client.pupPage = undefined as never;

    jest.spyOn(sut, 'resolveMessageByKey').mockResolvedValueOnce({
      id: { _serialized: 'true_5511@c.us_stanza-1' },
    });

    await expect(
      service.react({ id: 'parsed-id', remoteJid: '5511@c.us' } as never, '🔥')
    ).rejects.toThrow('Wwebjs puppeteer page not available');
  });

  it('react runs browser evaluation and maps returned message', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveMessageByKey: (key: unknown) => Promise<unknown | null>;
    };

    const message = {
      id: { _serialized: 'true_5511@c.us_stanza-1' },
    };

    jest.spyOn(sut, 'resolveMessageByKey').mockResolvedValueOnce(message);

    await expect(
      service.react({ id: 'parsed-id', remoteJid: '5511@c.us' } as never, '👍')
    ).resolves.toEqual({ key: { id: 'true_5511@c.us_stanza-1' } });

    expect(client.pupPage.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      'true_5511@c.us_stanza-1',
      '👍'
    );
    expect(mockMessageToWaLike).toHaveBeenCalledWith(message);
  });

  it('covers browser callback branches used by react evaluate block', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveMessageByKey: (key: unknown) => Promise<unknown | null>;
    };

    jest.spyOn(sut, 'resolveMessageByKey').mockResolvedValueOnce({
      id: { _serialized: 'true_5511@c.us_stanza-1' },
    });

    await service.react(
      { id: 'parsed-id', remoteJid: '5511@c.us' } as never,
      '🔥'
    );

    const evaluateCallback = (client.pupPage.evaluate as jest.Mock).mock
      .calls[0][0] as (messageId: string, reaction: string) => Promise<void>;

    const previousRequire = (globalThis as { require?: unknown }).require;

    try {
      const requireMock = jest.fn((module: string) => {
        if (module === 'WAWebCollections') {
          return {
            Msg: {
              get: (id: string) => (id === 'id-direct' ? { id } : undefined),
              getMessagesById: async (ids: string[]) =>
                ids[0] === 'id-fallback'
                  ? { messages: [{ id: ids[0] }] }
                  : undefined,
            },
          };
        }

        return {
          sendReactionToMsg: jest.fn(async () => undefined),
        };
      });

      (globalThis as { require?: unknown }).require = requireMock as never;

      await expect(evaluateCallback('', '🔥')).resolves.toBeUndefined();
      await expect(
        evaluateCallback('id-missing', '🔥')
      ).resolves.toBeUndefined();
      await expect(
        evaluateCallback('id-direct', '🔥')
      ).resolves.toBeUndefined();
      await expect(
        evaluateCallback('id-fallback', '🔥')
      ).resolves.toBeUndefined();
    } finally {
      (globalThis as { require?: unknown }).require = previousRequire;
    }
  });

  it('covers candidate builders and id extraction helpers', () => {
    const { service } = makeService();
    const sut = service as unknown as {
      buildJidAliases: (jid: string) => string[];
      buildFromMeCandidates: (
        key: Record<string, unknown>,
        parsed: any
      ) => boolean[];
      buildRemoteCandidates: (
        key: Record<string, unknown>,
        parsed: any
      ) => string[];
      buildSerializedIdCandidates: (key: Record<string, unknown>) => string[];
      extractSerializedIdFromMessage: (msg: unknown) => string | undefined;
      extractStanzaIdFromMessage: (msg: unknown) => string | undefined;
      extractFromMeFromMessage: (msg: unknown) => boolean | undefined;
    };

    expect(sut.buildJidAliases('')).toEqual([]);
    expect(sut.buildJidAliases('5511@s.whatsapp.net')).toEqual([
      '5511@s.whatsapp.net',
      '5511@c.us',
    ]);
    expect(sut.buildJidAliases('5511@c.us')).toEqual([
      '5511@c.us',
      '5511@s.whatsapp.net',
    ]);

    expect(sut.buildFromMeCandidates({ fromMe: true }, null)).toEqual([
      true,
      false,
    ]);
    expect(sut.buildFromMeCandidates({ from_me: false }, null)).toEqual([
      false,
      true,
    ]);
    expect(
      sut.buildFromMeCandidates(
        {},
        { fromMe: true, remoteJid: 'r', stanzaId: 's' }
      )
    ).toEqual([true, false]);
    expect(sut.buildFromMeCandidates({}, null)).toEqual([false, true]);

    expect(
      sut.buildRemoteCandidates(
        {
          remoteJid: '5511@c.us',
          remote_jid: '5511@s.whatsapp.net',
        },
        { remoteJid: '5522@c.us' }
      )
    ).toEqual(
      expect.arrayContaining([
        '5511@c.us',
        '5511@s.whatsapp.net',
        '5522@c.us',
        '5522@s.whatsapp.net',
      ])
    );

    expect(sut.buildSerializedIdCandidates({ id: '   ' })).toEqual([]);

    const parsedCandidates = sut.buildSerializedIdCandidates({
      id: 'parsed-id',
      remoteJid: '55118888@c.us',
      fromMe: true,
    });
    expect(parsedCandidates).toEqual(
      expect.arrayContaining([
        'parsed-id',
        'true_55118888@c.us_stanza-1',
        'false_55118888@c.us_stanza-1',
      ])
    );

    const rawCandidates = sut.buildSerializedIdCandidates({
      id: 'raw-id',
      remote_jid: '55117777@s.whatsapp.net',
      from_me: false,
    });
    expect(rawCandidates).toEqual(
      expect.arrayContaining([
        'raw-id',
        'false_55117777@s.whatsapp.net_raw-id',
        'true_55117777@c.us_raw-id',
      ])
    );

    expect(sut.extractSerializedIdFromMessage(null)).toBeUndefined();
    expect(
      sut.extractSerializedIdFromMessage({ id: { _serialized: ' x ' } })
    ).toBe('x');
    expect(sut.extractSerializedIdFromMessage({ id: ' y ' })).toBe('y');
    expect(
      sut.extractSerializedIdFromMessage({ id: { _serialized: '  ' } })
    ).toBeUndefined();

    expect(
      sut.extractStanzaIdFromMessage({
        id: { _serialized: 'true_5511@c.us_stanza-55' },
      })
    ).toBe('stanza-55');
    expect(
      sut.extractStanzaIdFromMessage({ id: { id: ' stanza-fallback ' } })
    ).toBe('stanza-fallback');

    expect(
      sut.extractFromMeFromMessage({
        id: { _serialized: 'true_5511@c.us_stanza-z' },
      })
    ).toBe(true);
    expect(sut.extractFromMeFromMessage({ fromMe: false })).toBe(false);
    expect(sut.extractFromMeFromMessage({ id: { fromMe: true } })).toBe(true);
    expect(sut.extractFromMeFromMessage({ id: 'raw' })).toBeUndefined();
  });

  it('resolveMessageByChatScan finds message by serialized candidate and stanza fallback', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveMessageByChatScan: (
        key: Record<string, unknown>,
        serializedCandidates: string[]
      ) => Promise<unknown>;
    };

    const matchingBySerialized = { id: { _serialized: 'parsed-id' } };
    const matchingByStanza = {
      id: { _serialized: 'false_5511999999999@c.us_stanza-1' },
    };

    client.getChatById
      .mockResolvedValueOnce({
        fetchMessages: jest.fn(async () => [matchingBySerialized]),
      })
      .mockResolvedValueOnce({
        fetchMessages: jest.fn(async () => [matchingByStanza]),
      });

    await expect(
      sut.resolveMessageByChatScan(
        {
          id: 'parsed-id',
          remoteJid: '5511999999999@c.us',
          fromMe: true,
        },
        ['parsed-id']
      )
    ).resolves.toBe(matchingBySerialized);

    client.getChatById.mockReset();
    client.getChatById
      .mockRejectedValueOnce(new Error('chat not found'))
      .mockResolvedValueOnce({ fetchMessages: jest.fn(async () => []) })
      .mockResolvedValueOnce({});

    await expect(
      sut.resolveMessageByChatScan(
        {
          id: 'parsed-id',
          remoteJid: '5511999999999@c.us',
        },
        ['missing-id']
      )
    ).resolves.toBeNull();
  });

  it('resolveMessageByChatScan handles missing raw id and empty parsed stanza id', async () => {
    const { service } = makeService();
    const sut = service as unknown as {
      resolveMessageByChatScan: (
        key: Record<string, unknown>,
        serializedCandidates: string[]
      ) => Promise<unknown>;
    };

    await expect(
      sut.resolveMessageByChatScan({ id: '   ' }, ['x'])
    ).resolves.toBeNull();

    mockParseSerializedMessageId.mockReturnValueOnce({
      fromMe: true,
      remoteJid: '5511999999999@c.us',
      stanzaId: '',
    });
    await expect(
      sut.resolveMessageByChatScan(
        { id: 'non-empty-id', remoteJid: '5511999999999@c.us' },
        ['x']
      )
    ).resolves.toBeNull();
  });

  it('resolveMessageByChatScan evaluates stanza/fromMe branches before returning null', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveMessageByChatScan: (
        key: Record<string, unknown>,
        serializedCandidates: string[]
      ) => Promise<unknown>;
    };

    client.getChatById.mockResolvedValue({
      fetchMessages: jest.fn(async () => [
        { id: { _serialized: 'false_5511999999999@c.us_stanza-other' } },
        {
          id: { _serialized: 'false_5511999999999@c.us_stanza-1' },
          fromMe: false,
        },
      ]),
    });

    await expect(
      sut.resolveMessageByChatScan(
        {
          id: 'parsed-id',
          remoteJid: '5511999999999@c.us',
          fromMe: true,
        },
        ['unknown-serialized']
      )
    ).resolves.toEqual({
      id: { _serialized: 'false_5511999999999@c.us_stanza-1' },
      fromMe: false,
    });

    client.getChatById.mockResolvedValue({
      fetchMessages: jest.fn(async () => [
        { id: { _serialized: 'false_5511999999999@c.us_stanza-other' } },
      ]),
    });

    await expect(
      sut.resolveMessageByChatScan(
        {
          id: 'parsed-id',
          remoteJid: '5511999999999@c.us',
        },
        ['unknown-serialized']
      )
    ).resolves.toBeNull();
  });

  it('resolveMessageByKey tries candidates and falls back to chat scan', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveMessageByKey: (key: Record<string, unknown>) => Promise<unknown>;
      resolveMessageByChatScan: (
        key: Record<string, unknown>,
        candidates: string[]
      ) => Promise<unknown>;
    };

    const fallbackMessage = { id: { _serialized: 'fallback' } };

    client.getMessageById
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(null);

    const scanSpy = jest
      .spyOn(sut, 'resolveMessageByChatScan')
      .mockResolvedValueOnce(fallbackMessage);

    await expect(
      sut.resolveMessageByKey({
        id: 'parsed-id',
        remoteJid: '5511999999999@c.us',
      })
    ).resolves.toBe(fallbackMessage);

    expect(scanSpy).toHaveBeenCalledWith(
      {
        id: 'parsed-id',
        remoteJid: '5511999999999@c.us',
      },
      expect.any(Array)
    );

    await expect(sut.resolveMessageByKey({ id: '   ' })).resolves.toBeNull();
  });

  it('resolveMessageByKey returns immediately when getMessageById finds a candidate', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveMessageByKey: (key: Record<string, unknown>) => Promise<unknown>;
      resolveMessageByChatScan: (
        key: Record<string, unknown>,
        candidates: string[]
      ) => Promise<unknown>;
    };

    const direct = { id: { _serialized: 'true_5511999999999@c.us_stanza-1' } };
    client.getMessageById.mockResolvedValueOnce(direct);

    const scanSpy = jest.spyOn(sut, 'resolveMessageByChatScan');

    await expect(
      sut.resolveMessageByKey({
        id: 'parsed-id',
        remoteJid: '5511999999999@c.us',
      })
    ).resolves.toBe(direct);
    expect(scanSpy).not.toHaveBeenCalled();
  });
});
