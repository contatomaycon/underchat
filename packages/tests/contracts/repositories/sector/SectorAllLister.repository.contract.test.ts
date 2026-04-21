import 'reflect-metadata';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';
import { SectorAllListerRepository } from '@core/repositories/sector/SectorAllLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorAllListerRepository', () => {
  it('listAllSectors returns empty array when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorAllListerRepository(db as never);

    await expect(repository.listAllSectors('acc-1')).resolves.toEqual([]);
  });

  it('listAllSectors returns rows from database', async () => {
    const rows = [
      {
        sector_id: 'sec-1',
        name: 'Sales',
        color: '#fff',
        sector_status: {
          id: ESectorStatus.active,
        },
      },
    ];
    const { db } = createSelectDbMock(rows);
    const repository = new SectorAllListerRepository(db as never);

    await expect(repository.listAllSectors('acc-1')).resolves.toEqual(rows);
  });

  it('listAllSectorsForReport returns empty array when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorAllListerRepository(db as never);

    await expect(repository.listAllSectorsForReport('acc-1')).resolves.toEqual(
      []
    );
  });

  it('listAllSectorsForReport returns minimal sector payload', async () => {
    const rows = [{ sector_id: 'sec-1', name: 'Support' }];
    const { db } = createSelectDbMock(rows);
    const repository = new SectorAllListerRepository(db as never);

    await expect(repository.listAllSectorsForReport('acc-1')).resolves.toEqual(
      rows
    );
  });
});
