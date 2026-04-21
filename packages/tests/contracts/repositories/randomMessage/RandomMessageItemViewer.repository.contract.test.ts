import 'reflect-metadata';
import { RandomMessageItemViewerRepository } from '@core/repositories/randomMessage/RandomMessageItemViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('RandomMessageItemViewerRepository', () => {
  it('returns null when random message item is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new RandomMessageItemViewerRepository(db as never);

    await expect(
      repository.viewRandomMessageItemById('rmi-1', 'rm-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('returns random message item when found', async () => {
    const row = {
      random_message_item_id: 'rmi-1',
      random_message_id: 'rm-1',
      message: 'Mensagem item',
      status: 'active',
      type: 'text',
      attachment_url: null,
      mimetype: null,
      duration: null,
      width: null,
      height: null,
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: '2026-04-21T01:00:00.000Z',
    };
    const { db } = createSelectDbMock([row]);
    const repository = new RandomMessageItemViewerRepository(db as never);

    await expect(
      repository.viewRandomMessageItemById('rmi-1', 'rm-1', 'acc-1')
    ).resolves.toEqual(row);
  });
});
