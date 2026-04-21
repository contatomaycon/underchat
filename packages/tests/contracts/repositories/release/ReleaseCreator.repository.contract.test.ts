import 'reflect-metadata';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { ReleaseCreatorRepository } from '@core/repositories/release/ReleaseCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createInsertStep() {
  const values = jest.fn(async () => ({ rowCount: 1 }));
  return { values };
}

describe('ReleaseCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock)
      .mockReturnValueOnce('release-1')
      .mockReturnValueOnce('release-access-1');
  });

  it('creates release and access with user account when no full access', async () => {
    const releaseInsert = createInsertStep();
    const accessInsert = createInsertStep();

    const insert = jest
      .fn()
      .mockReturnValueOnce({ values: releaseInsert.values })
      .mockReturnValueOnce({ values: accessInsert.values });

    const repository = new ReleaseCreatorRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert })
      ),
    } as never);

    await expect(
      repository.createRelease(
        {
          type: EReleaseType.news,
          title: 'Title',
          message: 'Message',
        } as never,
        'acc-1',
        'acc-user-1',
        false,
        'user-1'
      )
    ).resolves.toBe('release-1');

    expect(accessInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-user-1',
      })
    );
  });

  it('uses null account access for full-access release for all and keeps reminder_at', async () => {
    const releaseInsert = createInsertStep();
    const accessInsert = createInsertStep();

    const insert = jest
      .fn()
      .mockReturnValueOnce({ values: releaseInsert.values })
      .mockReturnValueOnce({ values: accessInsert.values });

    const repository = new ReleaseCreatorRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert })
      ),
    } as never);

    await expect(
      repository.createRelease(
        {
          type: EReleaseType.reminder,
          title: 'Reminder',
          message: 'Remember',
          reminder_at: '2026-04-21T20:00:00.000Z',
        } as never,
        null,
        null,
        true,
        'user-1'
      )
    ).resolves.toBe('release-1');

    expect(releaseInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        reminder_at: '2026-04-21T20:00:00.000Z',
      })
    );

    expect(accessInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: null,
      })
    );
  });
});
