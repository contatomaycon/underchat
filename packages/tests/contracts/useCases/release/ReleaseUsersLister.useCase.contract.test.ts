import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseUsersListerUseCase } from '@core/useCases/release/ReleaseUsersLister.useCase';

describe('ReleaseUsersListerUseCase', () => {
  it('delegates users listing', async () => {
    const result = { users: [] };
    const service = {
      listReleaseUsers: jest.fn(async () => result),
    };
    const useCase = new ReleaseUsersListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.listReleaseUsers).toHaveBeenCalledWith('acc-1');
  });
});
