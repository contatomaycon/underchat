import 'reflect-metadata';
import { SectorUsersListerRepository } from '@core/repositories/sector/SectorUsersLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorUsersListerRepository', () => {
  it('listSectorUsers returns empty array when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorUsersListerRepository(db as never);

    await expect(repository.listSectorUsers('acc-1', 'sec-1')).resolves.toEqual(
      []
    );
  });

  it('listSectorUsers returns rows when query has results', async () => {
    const rows = [
      {
        user_id: 'user-1',
        email_partial: 'u***@mail.com',
        user_info: {
          name: 'John',
          last_name: 'Doe',
          photo: 'photo.png',
        },
      },
    ];
    const { db } = createSelectDbMock(rows);
    const repository = new SectorUsersListerRepository(db as never);

    await expect(repository.listSectorUsers('acc-1', 'sec-1')).resolves.toEqual(
      rows
    );
  });

  it('listSectorUsersBySectorIds returns empty array when sectorIds are empty', async () => {
    const select = jest.fn();
    const repository = new SectorUsersListerRepository({ select } as never);

    await expect(
      repository.listSectorUsersBySectorIds('acc-1', [])
    ).resolves.toEqual([]);

    expect(select).not.toHaveBeenCalled();
  });

  it('listSectorUsersBySectorIds returns rows when sectorIds are provided', async () => {
    const rows = [
      {
        user_id: 'user-1',
        email_partial: 'u***@mail.com',
        user_info: {
          name: 'John',
          last_name: 'Doe',
        },
      },
    ];
    const { db } = createSelectDbMock(rows);
    const repository = new SectorUsersListerRepository(db as never);

    await expect(
      repository.listSectorUsersBySectorIds('acc-1', ['sec-1'])
    ).resolves.toEqual(rows);
  });
});
