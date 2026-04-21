import 'reflect-metadata';
import { UserAddressCreatorRepository } from '@core/repositories/user/UserAddressCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('UserAddressCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('address-id-1');
  });

  it('createUserAddress returns true when insert affects one row', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const tx = { insert } as never;

    const repository = new UserAddressCreatorRepository({} as never);

    await expect(
      repository.createUserAddress(
        tx,
        {
          country_id: 55,
          zip_code: null,
          address1: null,
          address1_partial: null,
          address1_c: null,
          address2: null,
          address2_partial: null,
          address2_c: null,
          city_fiscal_code: null,
          state_fiscal_code: null,
          district: null,
        },
        'user-1'
      )
    ).resolves.toBe(true);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_address_id: 'address-id-1',
        user_id: 'user-1',
        country_id: 55,
        zip_code: null,
        address1: null,
      })
    );
  });

  it('createUserAddress returns false when insert affects zero rows', async () => {
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never;
    const repository = new UserAddressCreatorRepository({} as never);

    await expect(
      repository.createUserAddress(tx, { country_id: 55 } as never, 'user-1')
    ).resolves.toBe(false);
  });

  it('createUserAddressWithoutTransaction returns true on one row', async () => {
    const dbRw = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 1 })),
        })),
      })),
    };
    const repository = new UserAddressCreatorRepository(dbRw as never);

    await expect(
      repository.createUserAddressWithoutTransaction(
        {
          country_id: 55,
          zip_code: '01001-000',
        } as never,
        'user-1'
      )
    ).resolves.toBe(true);
  });

  it('createUserAddressWithoutTransaction returns false on zero rows', async () => {
    const dbRw = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    };
    const repository = new UserAddressCreatorRepository(dbRw as never);

    await expect(
      repository.createUserAddressWithoutTransaction(
        { country_id: 55 } as never,
        'user-1'
      )
    ).resolves.toBe(false);
  });
});
