import 'reflect-metadata';
import { MessageKeyLookupService } from '@core/services/messageKeyLookup.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

describe('MessageKeyLookupService', () => {
  it('returns null when accountId or messageId are invalid', async () => {
    const select = jest.fn();
    const service = new MessageKeyLookupService({ select } as never);

    await expect(
      service.getMessageKeyByMessageId('', 'm1')
    ).resolves.toBeNull();
    await expect(
      service.getMessageKeyByMessageId('a1', '   ')
    ).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('queries elastic and returns message_key when found', async () => {
    const select = jest.fn(async () => ({
      hits: {
        hits: [
          {
            _source: {
              message_key: {
                key: { id: 'k1', remoteJid: '5511@s.whatsapp.net' },
              },
            },
          },
        ],
      },
    }));

    const service = new MessageKeyLookupService({ select } as never);

    await expect(
      service.getMessageKeyByMessageId(' a1 ', ' m1 ')
    ).resolves.toEqual({
      key: { id: 'k1', remoteJid: '5511@s.whatsapp.net' },
    });
    expect(select).toHaveBeenCalledWith(
      EElasticIndex.message,
      expect.any(Object)
    );
  });

  it('returns null when no hits', async () => {
    const select = jest.fn(async () => ({ hits: { hits: [] } }));
    const service = new MessageKeyLookupService({ select } as never);

    await expect(
      service.getMessageKeyByMessageId('a1', 'm1')
    ).resolves.toBeNull();
  });
});
