import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { UserCardDefaultUpdaterRepository } from '@core/repositories/accountSettings/UserCardDefaultUpdater.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('UserCardDefaultUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updateUserCardDefault resets old defaults and sets the selected card as default', async () => {
    const firstSet = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => undefined),
      })),
    }));
    const secondSet = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => undefined),
      })),
    }));
    const tx = {
      update: jest
        .fn()
        .mockReturnValueOnce({
          set: firstSet,
        })
        .mockReturnValueOnce({
          set: secondSet,
        }),
    };
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new UserCardDefaultUpdaterRepository(dbRw as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:40:00.000Z');

    await expect(
      repository.updateUserCardDefault('card-1', 'user-1')
    ).resolves.toBe(true);

    expect(firstSet).toHaveBeenCalledWith({
      default: false,
      updated_at: '2026-04-21T18:40:00.000Z',
    });
    expect(secondSet).toHaveBeenCalledWith({
      default: true,
      updated_at: '2026-04-21T18:40:00.000Z',
    });
  });

  it('setFirstCardAsDefault returns false when there is no card', async () => {
    const selectMock = createSelectDbMock([]);
    const repository = new UserCardDefaultUpdaterRepository({
      ...selectMock.db,
      update: jest.fn(),
    } as never);

    await expect(repository.setFirstCardAsDefault('user-1')).resolves.toBe(
      false
    );
  });

  it('setFirstCardAsDefault returns true and updates the first card', async () => {
    const selectMock = createSelectDbMock([{ user_card_id: 'card-1' }]);
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => undefined),
      })),
    }));
    const repository = new UserCardDefaultUpdaterRepository({
      ...selectMock.db,
      update: jest.fn(() => ({
        set,
      })),
    } as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:50:00.000Z');

    await expect(repository.setFirstCardAsDefault('user-1')).resolves.toBe(
      true
    );
    expect(set).toHaveBeenCalledWith({
      default: true,
      updated_at: '2026-04-21T18:50:00.000Z',
    });
  });
});
