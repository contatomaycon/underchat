import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { UserCardCreatorRepository } from '@core/repositories/plan/UserCardCreator.repository';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('UserCardCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (randomUUID as unknown as jest.Mock).mockReturnValue('card-1');
  });

  it('creates card and returns generated id with default false when isDefault omitted', async () => {
    const values = jest.fn(async () => ({ rowCount: 1 }));
    const insert = jest.fn(() => ({ values }));
    const repository = new UserCardCreatorRepository({ insert } as never);

    await expect(
      repository.createUserCard({
        userId: 'user-1',
        token: 'tok_123',
        holderName: 'John Doe',
        lastNumber: '1111',
        brand: 'visa',
      })
    ).resolves.toBe('card-1');

    expect(values).toHaveBeenCalledWith({
      user_card_id: 'card-1',
      user_id: 'user-1',
      token: 'tok_123',
      holder_name: 'John Doe',
      last_number: '1111',
      brand: 'visa',
      default: false,
    });
  });

  it('uses provided isDefault value', async () => {
    const values = jest.fn(async () => ({ rowCount: 1 }));
    const insert = jest.fn(() => ({ values }));
    const repository = new UserCardCreatorRepository({ insert } as never);

    await repository.createUserCard({
      userId: 'user-1',
      token: 'tok_123',
      holderName: 'John Doe',
      lastNumber: '1111',
      brand: 'visa',
      isDefault: true,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        default: true,
      })
    );
  });

  it('coerces explicit false to default false', async () => {
    const values = jest.fn(async () => ({ rowCount: 1 }));
    const insert = jest.fn(() => ({ values }));
    const repository = new UserCardCreatorRepository({ insert } as never);

    await repository.createUserCard({
      userId: 'user-1',
      token: 'tok_123',
      holderName: 'John Doe',
      lastNumber: '1111',
      brand: 'visa',
      isDefault: false,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        default: false,
      })
    );
  });
});
