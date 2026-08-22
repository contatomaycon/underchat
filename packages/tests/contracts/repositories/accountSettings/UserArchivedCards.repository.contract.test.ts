import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { UserArchivedCardsRepository } from '@core/repositories/accountSettings/UserArchivedCards.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

type QueryChain = {
  from: jest.Mock;
  where: jest.Mock;
  for: jest.Mock;
  set: jest.Mock;
  returning: jest.Mock;
  execute: jest.Mock;
};

const createQueryChain = (result: unknown): QueryChain => {
  const chain = {} as QueryChain;
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.for = jest.fn(() => chain);
  chain.set = jest.fn(() => chain);
  chain.returning = jest.fn(() => chain);
  chain.execute = jest.fn(async () => result);
  return chain;
};

describe('UserArchivedCardsRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists archived cards without exposing their gateway token', async () => {
    const dbMock = createSelectDbMock([
      {
        user_card_id: 'card-1',
        holder_name: 'John Doe',
        last_number: '1111',
        brand: 'visa',
        created_at: '2026-04-21T10:00:00.000Z',
        token: 'must-not-be-exposed',
      },
    ]);
    const repository = new UserArchivedCardsRepository(dbMock.db as never);

    await expect(repository.listArchivedUserCards('user-1')).resolves.toEqual([
      {
        user_card_id: 'card-1',
        holder_name: 'John Doe',
        last_number: '1111',
        brand: 'visa',
        default: false,
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
  });

  it('restores an archived card as non-default when an active card exists', async () => {
    const selectChain = createQueryChain([{ deleted_at: null }]);
    const updateChain = createQueryChain([
      {
        user_card_id: 'card-1',
        holder_name: 'John Doe',
        last_number: '1111',
        brand: 'visa',
        default: false,
        created_at: '2026-04-21T10:00:00.000Z',
        token: 'must-not-be-exposed',
      },
    ]);
    const tx = {
      select: jest.fn(() => selectChain),
      update: jest.fn(() => updateChain),
    };
    const db = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx)
      ),
    };
    const repository = new UserArchivedCardsRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:20:00.000Z');

    await expect(
      repository.reactivateUserCard('card-1', 'user-1')
    ).resolves.toEqual({
      user_card_id: 'card-1',
      holder_name: 'John Doe',
      last_number: '1111',
      brand: 'visa',
      default: false,
      created_at: '2026-04-21T10:00:00.000Z',
    });

    expect(selectChain.for).toHaveBeenCalledWith('update');
    expect(updateChain.set).toHaveBeenCalledWith({
      deleted_at: null,
      default: false,
      updated_at: '2026-04-21T18:20:00.000Z',
    });
  });

  it('restores the card as default when it is the first active card', async () => {
    const selectChain = createQueryChain([{ deleted_at: '2026-04-20' }]);
    const updateChain = createQueryChain([
      {
        user_card_id: 'card-1',
        holder_name: 'John Doe',
        last_number: '1111',
        brand: 'visa',
        default: true,
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
    const tx = {
      select: jest.fn(() => selectChain),
      update: jest.fn(() => updateChain),
    };
    const db = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx)
      ),
    };
    const repository = new UserArchivedCardsRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:30:00.000Z');

    await expect(
      repository.reactivateUserCard('card-1', 'user-1')
    ).resolves.toMatchObject({ default: true });
    expect(updateChain.set).toHaveBeenCalledWith({
      deleted_at: null,
      default: true,
      updated_at: '2026-04-21T18:30:00.000Z',
    });
  });

  it('returns null when the user does not own an archived version of the card', async () => {
    const selectChain = createQueryChain([]);
    const updateChain = createQueryChain([]);
    const tx = {
      select: jest.fn(() => selectChain),
      update: jest.fn(() => updateChain),
    };
    const db = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx)
      ),
    };
    const repository = new UserArchivedCardsRepository(db as never);

    await expect(
      repository.reactivateUserCard('foreign-card', 'user-1')
    ).resolves.toBeNull();
  });
});
