import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { ReleaseUpdaterRepository } from '@core/repositories/release/ReleaseUpdater.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createSelectStep(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { select };
}

function createUpdateStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  return { update, set };
}

describe('ReleaseUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T19:00:00.000Z'
    );
  });

  it('returns not_found when release does not exist', async () => {
    const selectStep = createSelectStep([]);
    const repository = new ReleaseUpdaterRepository({
      select: selectStep.select,
      update: jest.fn(),
    } as never);

    await expect(
      repository.updateById('release-1', 'user-1', {} as never)
    ).resolves.toBe('not_found');
  });

  it('returns forbidden when user is not owner', async () => {
    const selectStep = createSelectStep([
      {
        created_by_user_id: 'user-2',
        type: EReleaseType.news,
        reminder_at: null,
      },
    ]);
    const repository = new ReleaseUpdaterRepository({
      select: selectStep.select,
      update: jest.fn(),
    } as never);

    await expect(
      repository.updateById('release-1', 'user-1', {} as never)
    ).resolves.toBe('forbidden');
  });

  it('returns invalid_reminder when reminder type has no reminder date', async () => {
    const selectStep = createSelectStep([
      {
        created_by_user_id: 'user-1',
        type: EReleaseType.news,
        reminder_at: null,
      },
    ]);
    const repository = new ReleaseUpdaterRepository({
      select: selectStep.select,
      update: jest.fn(),
    } as never);

    await expect(
      repository.updateById('release-1', 'user-1', {
        type: EReleaseType.reminder,
      } as never)
    ).resolves.toBe('invalid_reminder');
  });

  it('returns true when update succeeds', async () => {
    const selectStep = createSelectStep([
      {
        created_by_user_id: 'user-1',
        type: EReleaseType.news,
        reminder_at: null,
      },
    ]);
    const updateStep = createUpdateStep(1);
    const repository = new ReleaseUpdaterRepository({
      select: selectStep.select,
      update: updateStep.update,
    } as never);

    await expect(
      repository.updateById('release-1', 'user-1', {
        title: 'New title',
      } as never)
    ).resolves.toBe(true);

    expect(updateStep.set).toHaveBeenCalledWith(
      expect.objectContaining({
        updated_at: '2026-04-21T19:00:00.000Z',
        title: 'New title',
      })
    );
  });

  it('returns not_found when update affects no rows', async () => {
    const selectStep = createSelectStep([
      {
        created_by_user_id: 'user-1',
        type: EReleaseType.news,
        reminder_at: null,
      },
    ]);
    const updateStep = createUpdateStep(0);
    const repository = new ReleaseUpdaterRepository({
      select: selectStep.select,
      update: updateStep.update,
    } as never);

    await expect(
      repository.updateById('release-1', 'user-1', {
        message: 'Updated',
      } as never)
    ).resolves.toBe('not_found');
  });
});
