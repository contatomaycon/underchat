import 'reflect-metadata';
import { UserTransferListerRepository } from '@core/repositories/user/UserTransferLister.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserTransferListerRepository', () => {
  it('returns empty list when query returns no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserTransferListerRepository(
      dbMock.db as never,
      { getStatus: jest.fn() } as never
    );

    await expect(repository.listUsersForTransfer('account-1')).resolves.toEqual(
      []
    );
  });

  it('maps users using fallback fields and status', async () => {
    const dbMock = createSelectDbMock([
      {
        id: 'user-1',
        name: null,
        last_name: null,
        nickname: null,
        email_partial: 'john',
        photo: null,
      },
      {
        id: 'user-2',
        name: 'Jane',
        last_name: 'Doe',
        nickname: 'jane',
        email_partial: 'jane',
        photo: 'photo-2',
      },
    ]);
    const getStatus = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(EChatUserStatus.online);
    const repository = new UserTransferListerRepository(
      dbMock.db as never,
      { getStatus } as never
    );

    await expect(repository.listUsersForTransfer('account-1')).resolves.toEqual(
      [
        {
          id: 'user-1',
          name: 'john',
          last_name: null,
          nickname: 'john',
          photo: null,
          status: null,
        },
        {
          id: 'user-2',
          name: 'Jane',
          last_name: 'Doe',
          nickname: 'jane',
          photo: 'photo-2',
          status: EChatUserStatus.online,
        },
      ]
    );
  });
});
