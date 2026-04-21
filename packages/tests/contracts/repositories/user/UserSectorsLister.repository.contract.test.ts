import 'reflect-metadata';
import { UserSectorsListerRepository } from '@core/repositories/user/UserSectorsLister.repository';

function createSelectChain(result: unknown) {
  const execute = jest.fn(async () => result);
  const chain: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    groupBy: jest.fn(),
    execute: execute as unknown as jest.Mock,
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);

  return {
    select: jest.fn(() => ({
      from: jest.fn(() => chain),
    })),
  };
}

describe('UserSectorsListerRepository', () => {
  it('returns empty array when result is undefined', async () => {
    const dbMock = createSelectChain(undefined);
    const repository = new UserSectorsListerRepository(dbMock as never);

    await expect(
      repository.listUserSectors('account-1', 'user-1')
    ).resolves.toEqual([]);
  });

  it('returns mapped sector ids when query has rows', async () => {
    const dbMock = createSelectChain([
      { sector_id: 'sector-1' },
      { sector_id: 'sector-2' },
    ]);
    const repository = new UserSectorsListerRepository(dbMock as never);

    await expect(
      repository.listUserSectors('account-1', 'user-1')
    ).resolves.toEqual(['sector-1', 'sector-2']);
  });
});
