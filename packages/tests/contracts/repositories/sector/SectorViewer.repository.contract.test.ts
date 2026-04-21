import 'reflect-metadata';
import { SectorViewerRepository } from '@core/repositories/sector/SectorViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorViewerRepository', () => {
  it('returns null when sector does not exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorViewerRepository(db as never);

    await expect(
      repository.viewSectorById('sec-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('returns mapped sector payload when sector exists', async () => {
    const row = {
      sector_id: 'sec-1',
      name: 'Support',
      color: '#fff',
      account: {
        id: 'acc-1',
        name: 'Account',
      },
      sector_status: {
        id: 'active',
        name: 'Active',
      },
      created_at: '2026-04-21T10:00:00.000Z',
    };
    const { db } = createSelectDbMock([row]);
    const repository = new SectorViewerRepository(db as never);

    await expect(repository.viewSectorById('sec-1', 'acc-1')).resolves.toEqual(
      row
    );
  });
});
