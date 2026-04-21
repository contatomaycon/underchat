import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { SectorUserUpdaterRepository } from '@core/repositories/sector/SectorUserUpdater.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createSelectTx(rows: Array<{ sector_id: string }>) {
  const execute = jest.fn(async () => rows);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select, execute };
}

function createUpdateTx() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return { update, set };
}

describe('SectorUserUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T20:30:00.000Z'
    );
  });

  it('listUserSectorsInTransaction returns empty array when no rows found', async () => {
    const selectTx = createSelectTx([]);
    const repository = new SectorUserUpdaterRepository({} as never);

    await expect(
      repository.listUserSectorsInTransaction(
        { select: selectTx.select } as never,
        'user-1'
      )
    ).resolves.toEqual([]);
  });

  it('listUserSectorsInTransaction returns sector ids', async () => {
    const selectTx = createSelectTx([
      { sector_id: 'sec-1' },
      { sector_id: 'sec-2' },
    ]);
    const repository = new SectorUserUpdaterRepository({} as never);

    await expect(
      repository.listUserSectorsInTransaction(
        { select: selectTx.select } as never,
        'user-1'
      )
    ).resolves.toEqual(['sec-1', 'sec-2']);
  });

  it('markSectorUsersAsDeletedInTransaction returns true and skips update when ids are empty', async () => {
    const updateTx = createUpdateTx();
    const repository = new SectorUserUpdaterRepository({} as never);

    await expect(
      repository.markSectorUsersAsDeletedInTransaction(
        { update: updateTx.update } as never,
        'user-1',
        []
      )
    ).resolves.toBe(true);

    expect(updateTx.update).not.toHaveBeenCalled();
  });

  it('markSectorUsersAsDeletedInTransaction updates deleted_at for informed ids', async () => {
    const updateTx = createUpdateTx();
    const repository = new SectorUserUpdaterRepository({} as never);

    await expect(
      repository.markSectorUsersAsDeletedInTransaction(
        { update: updateTx.update } as never,
        'user-1',
        ['sec-1']
      )
    ).resolves.toBe(true);

    expect(updateTx.set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T20:30:00.000Z',
      updated_at: '2026-04-21T20:30:00.000Z',
    });
  });

  it('restoreSectorUsersInTransaction returns true and skips update when ids are empty', async () => {
    const updateTx = createUpdateTx();
    const repository = new SectorUserUpdaterRepository({} as never);

    await expect(
      repository.restoreSectorUsersInTransaction(
        { update: updateTx.update } as never,
        'user-1',
        []
      )
    ).resolves.toBe(true);

    expect(updateTx.update).not.toHaveBeenCalled();
  });

  it('restoreSectorUsersInTransaction restores deleted_at and updates timestamp', async () => {
    const updateTx = createUpdateTx();
    const repository = new SectorUserUpdaterRepository({} as never);

    await expect(
      repository.restoreSectorUsersInTransaction(
        { update: updateTx.update } as never,
        'user-1',
        ['sec-1']
      )
    ).resolves.toBe(true);

    expect(updateTx.set).toHaveBeenCalledWith({
      deleted_at: null,
      updated_at: '2026-04-21T20:30:00.000Z',
    });
  });
});
