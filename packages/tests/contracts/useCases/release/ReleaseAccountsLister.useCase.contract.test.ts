import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseAccountsListerUseCase } from '@core/useCases/release/ReleaseAccountsLister.useCase';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

describe('ReleaseAccountsListerUseCase', () => {
  it('throws when requester has no full access permission', async () => {
    const service = {
      listReleaseAccounts: jest.fn(),
    };
    const useCase = new ReleaseAccountsListerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, [] as never)).rejects.toThrow(
      'release_accounts_permission_error'
    );
    expect(service.listReleaseAccounts).not.toHaveBeenCalled();
  });

  it('returns accounts when requester has full access', async () => {
    const result = { accounts: [] };
    const service = {
      listReleaseAccounts: jest.fn(async () => result),
    };
    const useCase = new ReleaseAccountsListerUseCase(service as never);

    await expect(
      useCase.execute(
        jest.fn() as never,
        [{ action_name: EGeneralPermissions.full_access }] as never
      )
    ).resolves.toEqual(result);
  });
});
