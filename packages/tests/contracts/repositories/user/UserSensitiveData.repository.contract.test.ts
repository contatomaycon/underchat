import 'reflect-metadata';
import { UserSensitiveDataRepository } from '@core/repositories/user/UserSensitiveData.repository';

describe('UserSensitiveDataRepository', () => {
  it('returns null when user is not found', async () => {
    const dbRo = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => []),
          })),
        })),
      })),
    };
    const repository = new UserSensitiveDataRepository(dbRo as never);

    await expect(
      repository.getUserSensitiveDataById('user-1')
    ).resolves.toBeNull();
  });

  it('returns sensitive payload with null fallbacks', async () => {
    const select = jest
      .fn()
      .mockImplementationOnce(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ email: 'encrypted-email' }]),
          })),
        })),
      }))
      .mockImplementationOnce(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ phone: 'encrypted-phone' }]),
          })),
        })),
      }))
      .mockImplementationOnce(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => []),
          })),
        })),
      }))
      .mockImplementationOnce(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [
              { address1: 'addr-1', address2: null },
            ]),
          })),
        })),
      }));

    const repository = new UserSensitiveDataRepository({
      select,
    } as never);

    await expect(
      repository.getUserSensitiveDataById('user-1')
    ).resolves.toEqual({
      phone: 'encrypted-phone',
      email: 'encrypted-email',
      document: null,
      address1: 'addr-1',
      address2: null,
    });
  });
});
