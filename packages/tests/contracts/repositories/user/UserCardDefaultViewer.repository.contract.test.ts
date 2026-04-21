import 'reflect-metadata';
import { UserCardDefaultViewerRepository } from '@core/repositories/user/UserCardDefaultViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserCardDefaultViewerRepository', () => {
  it('returns null when no default card exists', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserCardDefaultViewerRepository(dbMock.db as never);

    await expect(
      repository.findDefaultUserCardByUserId('user-1')
    ).resolves.toBe(null);
  });

  it('returns the default card payload when it exists', async () => {
    const card = {
      user_card_id: 'card-1',
      token: 'token-1',
      holder_name: 'John Doe',
      last_number: '4242',
      brand: 'visa',
    };
    const dbMock = createSelectDbMock([card]);
    const repository = new UserCardDefaultViewerRepository(dbMock.db as never);

    await expect(
      repository.findDefaultUserCardByUserId('user-1')
    ).resolves.toEqual(card);
  });
});
