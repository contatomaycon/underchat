import 'reflect-metadata';
import { TwoFactorUpdaterRepository } from '@core/repositories/auth/TwoFactorUpdater.repository';

describe('TwoFactorUpdaterRepository', () => {
  it('updates deleted_at and updated_at fields', async () => {
    const where = jest.fn(async () => undefined);
    const set = jest.fn(() => ({
      where,
    }));
    const update = jest.fn(() => ({
      set,
    }));
    const repository = new TwoFactorUpdaterRepository({
      update,
    } as never);

    await expect(
      repository.updateDeletedAt('two-factor-1', '2026-04-21T18:00:00.000Z')
    ).resolves.toBeUndefined();

    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T18:00:00.000Z',
      updated_at: '2026-04-21T18:00:00.000Z',
    });
    expect(where).toHaveBeenCalledTimes(1);
  });
});
