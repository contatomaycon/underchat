import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseNotificationsListerUseCase } from '@core/useCases/release/ReleaseNotificationsLister.useCase';

describe('ReleaseNotificationsListerUseCase', () => {
  it('delegates notifications listing', async () => {
    const result = { notifications: [] };
    const service = {
      listReleaseNotifications: jest.fn(async () => result),
    };
    const useCase = new ReleaseNotificationsListerUseCase(service as never);

    await expect(useCase.execute('acc-1', 'user-1', 'pr-1')).resolves.toEqual(
      result
    );
    expect(service.listReleaseNotifications).toHaveBeenCalledWith(
      'acc-1',
      'user-1',
      'pr-1'
    );
  });
});
