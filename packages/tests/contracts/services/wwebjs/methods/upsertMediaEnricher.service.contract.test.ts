import 'reflect-metadata';

jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import type { IContent } from '@core/common/interfaces/IChatMessage';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { WwebjsUpsertMediaEnricher } from '@core/services/wwebjs/methods/upsertMediaEnricher.service';

type WwebjsAlbumEnricher = {
  enrichAlbum(
    content: Partial<IContent>,
    msg: unknown,
    upsert: IUpsertMessage
  ): void;
};

describe('WwebjsUpsertMediaEnricher', () => {
  it('maps media album metadata using the serialized parent message key', () => {
    const service = new WwebjsUpsertMediaEnricher(
      {} as never
    ) as unknown as WwebjsAlbumEnricher;
    const content: Partial<IContent> = { type: EMessageType.image };

    service.enrichAlbum(
      content,
      {
        _data: {
          associationType: 'MEDIA_ALBUM',
          parentMsgKey: {
            _serialized: 'false_158733669765176@lid_album-parent-id',
            id: 'album-parent-id',
          },
          messageIndex: '2',
        },
      },
      {
        type: EMessageType.image,
        message: {
          key: {
            id: 'image-message-id',
          },
        },
      } as IUpsertMessage
    );

    expect(content.album).toEqual({
      id: 'false_158733669765176@lid_album-parent-id',
      parent_message_id: 'false_158733669765176@lid_album-parent-id',
      item_index: 2,
      association_type: 'MEDIA_ALBUM',
      source: 'wwebjs',
    });
  });
});
