import 'reflect-metadata';
import { AccountSettingsAddressViewerRepository } from '@core/repositories/accountSettings/AccountSettingsAddressViewer.repository';

describe('AccountSettingsAddressViewerRepository', () => {
  it('returns null when address is not found', async () => {
    const repository = new AccountSettingsAddressViewerRepository({
      query: {
        userAddress: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(repository.viewAddressByUserId('user-1')).resolves.toBeNull();
  });

  it('formats state with abbreviation when available', async () => {
    const repository = new AccountSettingsAddressViewerRepository({
      query: {
        userAddress: {
          findFirst: jest.fn(async () => ({
            uuc: { country_id: 'country-1' },
            uzc: { id_zipcode_city: 10, city: 'Sao Paulo' },
            uzs: {
              id_zipcode_state: 20,
              state: 'Sao Paulo',
              abbreviation: 'SP',
            },
            zip_code: '01000-000',
            address1_partial: 'Address 1',
            address2_partial: 'Address 2',
            district: 'Center',
          })),
        },
      },
    } as never);

    await expect(repository.viewAddressByUserId('user-1')).resolves.toEqual({
      country_id: 'country-1',
      zip_code: '01000-000',
      address1_partial: 'Address 1',
      address2_partial: 'Address 2',
      city: 'Sao Paulo',
      state: 'Sao Paulo (SP)',
      state_id: 20,
      city_id: 10,
      district: 'Center',
    });
  });

  it('formats state without abbreviation', async () => {
    const repository = new AccountSettingsAddressViewerRepository({
      query: {
        userAddress: {
          findFirst: jest.fn(async () => ({
            uuc: null,
            uzc: null,
            uzs: {
              id_zipcode_state: 30,
              state: 'Rio de Janeiro',
              abbreviation: null,
            },
            zip_code: '20000-000',
            address1_partial: null,
            address2_partial: null,
            district: null,
          })),
        },
      },
    } as never);

    await expect(repository.viewAddressByUserId('user-1')).resolves.toEqual({
      country_id: null,
      zip_code: '20000-000',
      address1_partial: null,
      address2_partial: null,
      city: null,
      state: 'Rio de Janeiro',
      state_id: 30,
      city_id: null,
      district: null,
    });
  });
});
