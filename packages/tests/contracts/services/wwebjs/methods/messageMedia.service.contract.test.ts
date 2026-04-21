import 'reflect-metadata';

const mockFromUrl = jest.fn(async (url: string) => ({ __mediaUrl: url }));
const mockWithMediaUrlFromInput = jest.fn(
  async (
    input: unknown,
    resolver: (url: string) => Promise<unknown> | unknown
  ): Promise<unknown> => {
    const url = `https://cdn.example/${String(input)}`;
    return resolver(url);
  }
);
const mockResolveQuotedMessageId = jest.fn<
  Promise<string | undefined>,
  [unknown, string, unknown]
>(async () => undefined);
const mockMessageToWaLike = jest.fn((input: unknown) => ({
  key: {
    id: (input as { id?: string } | undefined)?.id ?? 'mapped-id',
  },
}));

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    MessageMedia: {
      fromUrl: mockFromUrl,
    },
  },
}));

jest.mock('@core/common/functions/getMediaUrlFromInput', () => ({
  withMediaUrlFromInput: mockWithMediaUrlFromInput,
}));

jest.mock('@core/services/wwebjs/methods/helpers.service', () => ({
  WwebjsHelpersService: class {},
}));

jest.mock('@core/services/wwebjs/util/messageToWaLike', () => ({
  messageToWaLike: mockMessageToWaLike,
}));

jest.mock('@core/services/wwebjs/util/resolveQuotedMessageId', () => ({
  resolveQuotedMessageId: mockResolveQuotedMessageId,
}));

import { WwebjsMessageMediaService } from '@core/services/wwebjs/methods/messageMedia.service';

describe('WwebjsMessageMediaService', () => {
  const makeService = () => {
    const client = { id: 'client-1' };

    const helpers = {
      getClient: jest.fn(() => client),
      sendMessage: jest.fn<
        Promise<{ id: string } | undefined>,
        [string, unknown, Record<string, unknown>]
      >(async () => ({ id: 'wa-message-1' })),
    };

    const service = new WwebjsMessageMediaService(helpers as never);

    return {
      service,
      helpers,
      client,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveQuotedMessageId.mockResolvedValue(undefined);
  });

  it('sends image with quoted id when resolver returns one', async () => {
    const { service, helpers, client } = makeService();
    mockResolveQuotedMessageId.mockResolvedValueOnce('quoted-1');

    await expect(
      service.sendImage(
        '55110000@c.us',
        'image.png' as never,
        { caption: 'img', extra: { source: 'crm' } },
        { key: { id: 'quoted-source' } as never }
      )
    ).resolves.toEqual({ key: { id: 'wa-message-1' } });

    expect(mockWithMediaUrlFromInput).toHaveBeenCalledWith(
      'image.png',
      expect.any(Function)
    );
    expect(mockFromUrl).toHaveBeenCalledWith('https://cdn.example/image.png');
    expect(mockResolveQuotedMessageId).toHaveBeenCalledWith(
      client,
      '55110000@c.us',
      { id: 'quoted-source' }
    );
    expect(helpers.sendMessage).toHaveBeenCalledWith(
      '55110000@c.us',
      { __mediaUrl: 'https://cdn.example/image.png' },
      {
        caption: 'img',
        extra: { source: 'crm' },
        quotedMessageId: 'quoted-1',
        ignoreQuoteErrors: false,
      }
    );
  });

  it('sends video including quoted options when resolver returns id', async () => {
    const { service, helpers } = makeService();
    mockResolveQuotedMessageId.mockResolvedValueOnce('quoted-video');

    await expect(
      service.sendVideo(
        '55112222@c.us',
        'video.mp4' as never,
        { caption: 'video', seconds: 12, extra: { campaign: 'x' } },
        { key: { id: 'ignored' } as never }
      )
    ).resolves.toEqual({ key: { id: 'wa-message-1' } });

    expect(helpers.sendMessage).toHaveBeenCalledWith(
      '55112222@c.us',
      { __mediaUrl: 'https://cdn.example/video.mp4' },
      {
        caption: 'video',
        extra: { campaign: 'x' },
        quotedMessageId: 'quoted-video',
        ignoreQuoteErrors: false,
      }
    );
  });

  it('sends audio with voice defaults and viewOnce/quoted options', async () => {
    const { service, helpers } = makeService();
    mockResolveQuotedMessageId.mockResolvedValueOnce('quoted-audio');

    await expect(
      service.sendAudio(
        '55113333@c.us',
        'audio.ogg' as never,
        { ptt: false, viewOnce: true, extra: { trace: 'a1' } },
        { key: { id: 'quoted-a1' } as never }
      )
    ).resolves.toEqual({ key: { id: 'wa-message-1' } });

    expect(helpers.sendMessage).toHaveBeenCalledWith(
      '55113333@c.us',
      { __mediaUrl: 'https://cdn.example/audio.ogg' },
      {
        sendAudioAsVoice: false,
        isViewOnce: true,
        extra: { trace: 'a1' },
        quotedMessageId: 'quoted-audio',
        ignoreQuoteErrors: false,
      }
    );

    await service.sendAudio('55113333@c.us', 'audio-default.ogg' as never);

    expect(helpers.sendMessage).toHaveBeenLastCalledWith(
      '55113333@c.us',
      { __mediaUrl: 'https://cdn.example/audio-default.ogg' },
      {
        sendAudioAsVoice: true,
        isViewOnce: undefined,
        extra: undefined,
      }
    );
  });

  it('sends sticker with quoted options and maps undefined helper return', async () => {
    const { service, helpers } = makeService();
    mockResolveQuotedMessageId.mockResolvedValueOnce('quoted-sticker');
    helpers.sendMessage.mockResolvedValueOnce(undefined);

    await expect(
      service.sendSticker(
        '55114444@c.us',
        'sticker.webp' as never,
        { key: { id: 'quoted-source-sticker' } as never },
        { owner: 'cs' }
      )
    ).resolves.toEqual({ key: { id: 'mapped-id' } });

    expect(helpers.sendMessage).toHaveBeenCalledWith(
      '55114444@c.us',
      { __mediaUrl: 'https://cdn.example/sticker.webp' },
      {
        sendMediaAsSticker: true,
        extra: { owner: 'cs' },
        quotedMessageId: 'quoted-sticker',
        ignoreQuoteErrors: false,
      }
    );
    expect(mockMessageToWaLike).toHaveBeenCalledWith(undefined);
  });

  it('sends document as attachment with optional caption and quote', async () => {
    const { service, helpers } = makeService();
    mockResolveQuotedMessageId.mockResolvedValueOnce('quoted-doc');

    await expect(
      service.sendDocument(
        '55115555@c.us',
        'invoice.pdf' as never,
        {
          mimetype: 'application/pdf',
          fileName: 'invoice.pdf',
          caption: 'fatura',
          extra: { billing: true },
        },
        { key: { id: 'quoted-doc-source' } as never }
      )
    ).resolves.toEqual({ key: { id: 'wa-message-1' } });

    expect(helpers.sendMessage).toHaveBeenCalledWith(
      '55115555@c.us',
      { __mediaUrl: 'https://cdn.example/invoice.pdf' },
      {
        sendMediaAsDocument: true,
        caption: 'fatura',
        extra: { billing: true },
        quotedMessageId: 'quoted-doc',
        ignoreQuoteErrors: false,
      }
    );
  });

  it('maps nullish helper responses for image, video, audio and document methods', async () => {
    const { service, helpers } = makeService();
    helpers.sendMessage.mockResolvedValue(undefined);

    await expect(
      service.sendImage('55116666@c.us', 'img-nullish.png' as never)
    ).resolves.toEqual({ key: { id: 'mapped-id' } });

    await expect(
      service.sendVideo('55116666@c.us', 'video-nullish.mp4' as never)
    ).resolves.toEqual({ key: { id: 'mapped-id' } });

    await expect(
      service.sendAudio('55116666@c.us', 'audio-nullish.ogg' as never)
    ).resolves.toEqual({ key: { id: 'mapped-id' } });

    await expect(
      service.sendDocument('55116666@c.us', 'doc-nullish.pdf' as never, {
        mimetype: 'application/pdf',
      })
    ).resolves.toEqual({ key: { id: 'mapped-id' } });

    expect(mockMessageToWaLike).toHaveBeenCalledTimes(4);
  });
});
