import 'reflect-metadata';
import { SectorTransferListerRepository } from '@core/repositories/sector/SectorTransferLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorTransferListerRepository', () => {
  it('returns empty list when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorTransferListerRepository(db as never);

    await expect(repository.listSectorsForTransfer('acc-1')).resolves.toEqual(
      []
    );
  });

  it('maps rows to transfer response payload', async () => {
    const { db } = createSelectDbMock([
      {
        sector_id: 'sec-1',
        name: 'Support',
        color: '#00f',
      },
      {
        sector_id: 'sec-2',
        name: 'Sales',
        color: null,
      },
    ]);
    const repository = new SectorTransferListerRepository(db as never);

    await expect(repository.listSectorsForTransfer('acc-1')).resolves.toEqual([
      {
        id: 'sec-1',
        name: 'Support',
        color: '#00f',
      },
      {
        id: 'sec-2',
        name: 'Sales',
        color: null,
      },
    ]);
  });
});
