import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/AccountSettingsAddressViewer.repository',
  () => ({
    AccountSettingsAddressViewerRepository: class {},
  })
);

import { AccountSettingsAddressViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAddressViewer.useCase';

describe('AccountSettingsAddressViewerUseCase', () => {
  it('throws when user is not found', async () => {
    const repository = {
      viewAddressByUserId: jest.fn(async () => null),
    };
    const useCase = new AccountSettingsAddressViewerUseCase(
      repository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'user-1')).rejects.toThrow(
      'user_not_found'
    );
  });

  it('returns address for user', async () => {
    const address = { city_fiscal_code: '3550308' };
    const repository = {
      viewAddressByUserId: jest.fn(async () => address),
    };
    const useCase = new AccountSettingsAddressViewerUseCase(
      repository as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'user-1')
    ).resolves.toEqual(address);
    expect(repository.viewAddressByUserId).toHaveBeenCalledWith('user-1');
  });
});
