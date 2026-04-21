import 'reflect-metadata';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('UserCardsListerRepository', () => {
  it('getUserCardById returns null when no card is found', async () => {
    const repository = new UserCardsListerRepository(
      {
        query: {
          userCard: {
            findFirst: jest.fn(async () => null),
          },
        },
      } as never,
      {} as never
    );

    await expect(
      repository.getUserCardById('card-1', 'user-1')
    ).resolves.toBeNull();
  });

  it('getUserCardByToken returns card data', async () => {
    const repository = new UserCardsListerRepository(
      {
        query: {
          userCard: {
            findFirst: jest.fn(async () => ({
              user_card_id: 'card-1',
              token: 'tok-1',
            })),
          },
        },
      } as never,
      {} as never
    );

    await expect(
      repository.getUserCardByToken('user-1', 'tok-1')
    ).resolves.toEqual({
      user_card_id: 'card-1',
      token: 'tok-1',
    });
  });

  it('getUserCardsCount returns result length', async () => {
    const rw = createSelectDbMock([{ id: 1 }, { id: 2 }]).db;
    const repository = new UserCardsListerRepository(rw as never, {} as never);

    await expect(repository.getUserCardsCount('user-1')).resolves.toBe(2);
  });

  it('listUserCards returns empty list when no cards found', async () => {
    const ro = createSelectDbMock([]).db;
    const repository = new UserCardsListerRepository({} as never, ro as never);

    await expect(repository.listUserCards('user-1')).resolves.toEqual([]);
  });

  it('listUserCards maps card rows', async () => {
    const ro = createSelectDbMock([
      {
        user_card_id: 'card-1',
        holder_name: 'John Doe',
        last_number: '1111',
        brand: 'visa',
        default: true,
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]).db;
    const repository = new UserCardsListerRepository({} as never, ro as never);

    await expect(repository.listUserCards('user-1')).resolves.toEqual([
      {
        user_card_id: 'card-1',
        holder_name: 'John Doe',
        last_number: '1111',
        brand: 'visa',
        default: true,
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
  });
});
