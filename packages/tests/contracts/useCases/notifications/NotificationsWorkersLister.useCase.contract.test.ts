import 'reflect-metadata';

jest.mock('@core/services/notifications.service', () => ({
  NotificationsService: class {},
}));

import { NotificationsWorkersListerUseCase } from '@core/useCases/notifications/NotificationsWorkersLister.useCase';

describe('NotificationsWorkersListerUseCase', () => {
  it('delegates workers listing by account', async () => {
    const result = { workers: [] };
    const service = {
      listWorkersByAccount: jest.fn(async () => result),
    };
    const useCase = new NotificationsWorkersListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.listWorkersByAccount).toHaveBeenCalledWith('acc-1');
  });
});
