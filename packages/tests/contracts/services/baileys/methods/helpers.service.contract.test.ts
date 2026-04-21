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

import { MessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';
import { BaileysHelpersService } from '@core/services/baileys/methods/helpers.service';

describe('BaileysHelpersService', () => {
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
    };

    const deliveryConfirmation = {
      waitForOutcome: jest.fn<
        Promise<'sent' | 'failed' | 'timeout'>,
        [string, number]
      >(async () => 'sent'),
    };

    const service = new BaileysHelpersService(
      connection as never,
      deliveryConfirmation as never
    );

    return {
      service,
      socket,
      connection,
      deliveryConfirmation,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

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

  it('sends text message with jid resolution and delivery confirmation', async () => {
    const { service, socket, deliveryConfirmation } = makeService();

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

    expect(simulateTypingSpy).toHaveBeenCalledWith('5511999999999@c.us', {
      text: 'hello',
    });
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

  it('handles send failures for unresolved number, missing id and failed/timeout confirmation', async () => {
    const { service, socket, deliveryConfirmation } = makeService();

    mockBuildCandidates.mockReturnValueOnce(['5511000']);
    socket.onWhatsApp.mockResolvedValueOnce([{ exists: false, jid: null }]);

    await expect(service.send('5511000', { text: 'x' })).rejects.toThrow(
      'Number not found on WhatsApp: 5511000'
    );

    socket.sendMessage.mockResolvedValueOnce({ key: {} });
    await expect(service.send('55119999@c.us', { text: 'x' })).rejects.toThrow(
      'Failed to send message to 55119999@c.us: missing key.id'
    );

    socket.sendMessage.mockResolvedValue({ key: { id: 'message-2' } });
    deliveryConfirmation.waitForOutcome.mockResolvedValueOnce('failed');

    await expect(
      service.send('55119999@c.us', { text: 'x' })
    ).rejects.toBeInstanceOf(MessageDeliveryConfirmationFailedError);

    deliveryConfirmation.waitForOutcome.mockResolvedValueOnce('timeout');

    await expect(
      service.send('55119999@c.us', { text: 'x' })
    ).rejects.toBeInstanceOf(MessageDeliveryConfirmationFailedError);
  });

  it('bypasses delivery confirmation for edit messages and validates sendOnce branches', async () => {
    const { service, socket, deliveryConfirmation } = makeService();
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
});
