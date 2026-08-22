import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerStatusUpdaterRepository } from '@core/repositories/server/ServerStatusUpdater.repository';
import {
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ServerStatusUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T16:15:00.000Z'
    );
  });

  it('returns true when status is updated', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ServerStatusUpdaterRepository(db as never);

    await expect(
      repository.updateServerStatusById('srv-1', EServerStatus.online)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      server_status_id: EServerStatus.online,
      last_sync: '2026-04-21T16:15:00.000Z',
    });
  });

  it('returns false when status update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new ServerStatusUpdaterRepository(db as never);

    await expect(
      repository.updateServerStatusById('srv-1', EServerStatus.offline)
    ).resolves.toBe(false);
  });

  it('supports compare-and-set transitions for installation terminal states', async () => {
    const { db, where } = createUpdateDbMock({ rowCount: 1 });
    const repository = new ServerStatusUpdaterRepository(db as never);

    await expect(
      repository.updateServerStatusById(
        'srv-1',
        EServerStatus.online,
        [EServerStatus.installing],
        '2026-04-21T16:16:00.000Z'
      )
    ).resolves.toBe(true);

    expect(where).toHaveBeenCalledTimes(1);
  });

  it('reads the authoritative server status from the write database', async () => {
    const { db } = createSelectDbMock([
      { server_status_id: EServerStatus.installing },
    ]);
    const repository = new ServerStatusUpdaterRepository(db as never);

    await expect(repository.viewServerStatusById('srv-1')).resolves.toBe(
      EServerStatus.installing
    );
  });

  it('returns null when the authoritative server row does not exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerStatusUpdaterRepository(db as never);

    await expect(
      repository.viewServerStatusById('missing')
    ).resolves.toBeNull();
  });
});
