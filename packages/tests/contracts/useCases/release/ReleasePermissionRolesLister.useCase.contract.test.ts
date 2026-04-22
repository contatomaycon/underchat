import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleasePermissionRolesListerUseCase } from '@core/useCases/release/ReleasePermissionRolesLister.useCase';

describe('ReleasePermissionRolesListerUseCase', () => {
  it('delegates permission roles listing', async () => {
    const result = { roles: [] };
    const service = {
      listReleasePermissionRoles: jest.fn(async () => result),
    };
    const useCase = new ReleasePermissionRolesListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.listReleasePermissionRoles).toHaveBeenCalledWith('acc-1');
  });
});
