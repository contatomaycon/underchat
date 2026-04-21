import 'reflect-metadata';

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    Location: class {
      latitude: number;
      longitude: number;
      options: unknown;
      constructor(latitude: number, longitude: number, options: unknown) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.options = options;
      }
    },
  },
}));

jest.mock('@core/services/wwebjs/methods/helpers.service', () => ({
  WwebjsHelpersService: class {},
}));

jest.mock('@core/services/wwebjs/util/messageToWaLike', () => ({
  messageToWaLike: jest.fn((msg) => ({ wrapped: msg })),
}));

jest.mock('@core/services/wwebjs/util/resolveQuotedMessageId', () => ({
  resolveQuotedMessageId: jest.fn(async () => 'quoted-id'),
}));

import { WwebjsMessageLocationContactService } from '@core/services/wwebjs/methods/messageLocationContact.service';

describe('WwebjsMessageLocationContactService', () => {
  it('sends location and contact card with quoted options', async () => {
    const sendMessage = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce({ id: 'm1' })
      .mockResolvedValueOnce({ id: 'm2' });

    const service = new WwebjsMessageLocationContactService({
      sendMessage,
      getClient: jest.fn(() => ({ id: 'client' })),
    } as never);

    await expect(
      service.sendLocation(
        'jid',
        {
          degreesLatitude: 1,
          degreesLongitude: 2,
          name: 'N',
          address: 'A',
        } as never,
        { key: { id: 'k1' } } as never,
        { x: 1 }
      )
    ).resolves.toEqual({ wrapped: { id: 'm1' } });

    await expect(
      service.sendContactCard('jid', 'VCARD1', { key: { id: 'k2' } } as never, {
        y: 2,
      })
    ).resolves.toEqual({ wrapped: { id: 'm2' } });

    expect(sendMessage).toHaveBeenNthCalledWith(1, 'jid', expect.any(Object), {
      extra: { x: 1 },
      quotedMessageId: 'quoted-id',
      ignoreQuoteErrors: false,
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 'jid', 'VCARD1', {
      parseVCards: true,
      extra: { y: 2 },
      quotedMessageId: 'quoted-id',
      ignoreQuoteErrors: false,
    });
  });
});
