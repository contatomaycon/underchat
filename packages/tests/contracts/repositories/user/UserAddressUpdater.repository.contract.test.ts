import 'reflect-metadata';
import { UserAddressUpdaterRepository } from '@core/repositories/user/UserAddressUpdater.repository';

describe('UserAddressUpdaterRepository', () => {
  it('updateInput maps allowed fields and sets deleted_at null when any field exists', () => {
    const repository = new UserAddressUpdaterRepository({} as never);

    const updateInput = (repository as any).updateInput({
      country_id: 55,
      zip_code: '01001-000',
      address1: 'address-1',
      address1_partial: 'addr-1',
      address1_c: 'address-1-c',
      address2: 'address-2',
      address2_partial: 'addr-2',
      address2_c: 'address-2-c',
      city_fiscal_code: '3550308',
      state_fiscal_code: '35',
      district: 'Centro',
    });

    expect(updateInput).toEqual(
      expect.objectContaining({
        country_id: 55,
        zip_code: '01001-000',
        address1: 'address-1',
        address1_partial: 'addr-1',
        address1_c: 'address-1-c',
        address2: 'address-2',
        address2_partial: 'addr-2',
        address2_c: 'address-2-c',
        city_fiscal_code: '3550308',
        state_fiscal_code: '35',
        district: 'Centro',
        deleted_at: null,
      })
    );
  });

  it('updateUserAddressById returns false when no valid field is provided', async () => {
    const repository = new UserAddressUpdaterRepository({} as never);

    await expect(
      repository.updateUserAddressById('user-1', { country_id: 0 } as never)
    ).resolves.toBe(false);
  });

  it('updateUserAddressById returns true when update affects rows', async () => {
    const repository = new UserAddressUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateUserAddressById('user-1', {
        zip_code: '01001-000',
      } as never)
    ).resolves.toBe(true);
  });

  it('deleteUserAddressById returns true for non-negative rowCount', async () => {
    const repository = new UserAddressUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(repository.deleteUserAddressById('user-1')).resolves.toBe(
      true
    );
  });

  it('existsUserAddressByUserId returns true when any row is found and false when empty', async () => {
    const dbRw = {
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                execute: jest.fn(async () => [{ user_address_id: 'addr-1' }]),
              })),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                execute: jest.fn(async () => []),
              })),
            })),
          })),
        })),
    };
    const repository = new UserAddressUpdaterRepository(dbRw as never);

    await expect(repository.existsUserAddressByUserId('user-1')).resolves.toBe(
      true
    );
    await expect(repository.existsUserAddressByUserId('user-1')).resolves.toBe(
      false
    );
  });
});
