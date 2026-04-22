import 'reflect-metadata';

jest.mock('@core/services/notifications.service', () => ({
  NotificationsService: class {},
}));

import { NotificationsUpserterUseCase } from '@core/useCases/notifications/NotificationsUpserter.useCase';

describe('NotificationsUpserterUseCase', () => {
  it('delegates notifications upsert', async () => {
    const input = { worker_ids: ['wk-1'] } as never;
    const result = { success: true };
    const service = {
      upsertNotifications: jest.fn(async () => result),
    };
    const useCase = new NotificationsUpserterUseCase(service as never);

    await expect(useCase.execute(input)).resolves.toEqual(result);
    expect(service.upsertNotifications).toHaveBeenCalledWith(input);
  });
});
