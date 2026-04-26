import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  downloadContentFromMessage: jest.fn(),
  downloadMediaMessage: jest.fn(),
  proto: {
    MessageAssociation: {
      AssociationType: {
        MEDIA_ALBUM: 1,
      },
    },
  },
}));

jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import type { IContent } from '@core/common/interfaces/IChatMessage';
import { BaileysUpsertMediaEnricher } from '@core/services/baileys/methods/upsertMediaEnricher.service';

type BaileysAlbumEnricher = {
  enrichAlbum(content: Partial<IContent>, waMessage: unknown): void;
};

describe('BaileysUpsertMediaEnricher', () => {
  it('maps media album metadata from the parent message association', () => {
    const service = new BaileysUpsertMediaEnricher(
      {} as never
    ) as unknown as BaileysAlbumEnricher;
    const content: Partial<IContent> = { type: EMessageType.image };

    service.enrichAlbum(content, {
      key: { id: 'image-message-id' },
      message: {
        imageMessage: {},
        messageContextInfo: {
          messageAssociation: {
            associationType: 1,
            parentMessageKey: {
              ID: 'album-parent-id',
            },
            messageIndex: '1',
          },
        },
      },
    });

    expect(content.album).toEqual({
      id: 'album-parent-id',
      parent_message_id: 'album-parent-id',
      item_index: 1,
      association_type: 'MEDIA_ALBUM',
      source: 'baileys',
    });
  });
});
