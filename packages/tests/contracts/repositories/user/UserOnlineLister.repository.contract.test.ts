import 'reflect-metadata';
import { UserOnlineListerRepository } from '@core/repositories/user/UserOnlineLister.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserOnlineListerRepository', () => {
  it('returns empty array when query has no users', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserOnlineListerRepository(
      dbMock.db as never,
      {} as never,
      { getStatus: jest.fn() } as never
    );

    await expect(
      repository.listOnlineUsersByAccount('account-1')
    ).resolves.toEqual([]);
  });

  it('returns only users with online status', async () => {
    const dbMock = createSelectDbMock([
      { id: 'user-1', name: 'John', photo: 'a' },
      { id: 'user-2', name: 'Jane', photo: 'b' },
    ]);
    const getStatus = jest
      .fn()
      .mockResolvedValueOnce(EChatUserStatus.online)
      .mockResolvedValueOnce(EChatUserStatus.offline);
    const repository = new UserOnlineListerRepository(
      dbMock.db as never,
      {} as never,
      { getStatus } as never
    );

    await expect(
      repository.listOnlineUsersByAccount('account-1')
    ).resolves.toEqual([{ id: 'user-1', name: 'John', photo: 'a' }]);
  });

  it('limits online users list to 100 items', async () => {
    const users = Array.from({ length: 120 }, (_, index) => ({
      id: `user-${index + 1}`,
      name: `User ${index + 1}`,
      photo: null,
    }));
    const dbMock = createSelectDbMock(users);
    const repository = new UserOnlineListerRepository(
      dbMock.db as never,
      {} as never,
      { getStatus: jest.fn(async () => EChatUserStatus.online) } as never
    );

    const result = await repository.listOnlineUsersByAccount('account-1');
    expect(result).toHaveLength(100);
    expect(result[0].id).toBe('user-1');
  });
});
