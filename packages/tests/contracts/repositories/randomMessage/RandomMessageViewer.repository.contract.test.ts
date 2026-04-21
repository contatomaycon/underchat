import 'reflect-metadata';
import { RandomMessageViewerRepository } from '@core/repositories/randomMessage/RandomMessageViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('RandomMessageViewerRepository', () => {
  it('returns null when random message is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new RandomMessageViewerRepository(db as never);

    await expect(
      repository.viewRandomMessageById('rm-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('returns random message when found', async () => {
    const row = {
      random_message_id: 'rm-1',
      name: 'Mensagem',
      status: 'active',
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: '2026-04-21T01:00:00.000Z',
    };
    const { db } = createSelectDbMock([row]);
    const repository = new RandomMessageViewerRepository(db as never);

    await expect(
      repository.viewRandomMessageById('rm-1', 'acc-1')
    ).resolves.toEqual(row);
  });
});
