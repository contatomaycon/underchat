import 'reflect-metadata';

jest.mock('@core/services/notifications.service', () => ({
  NotificationsService: class {},
}));

import { NotificationsViewerUseCase } from '@core/useCases/notifications/NotificationsViewer.useCase';

describe('NotificationsViewerUseCase', () => {
  it('delegates notifications view', async () => {
    const result = { notifications: [] };
    const service = {
      viewNotifications: jest.fn(async () => result),
    };
    const useCase = new NotificationsViewerUseCase(service as never);

    await expect(useCase.execute()).resolves.toEqual(result);
    expect(service.viewNotifications).toHaveBeenCalled();
  });
});
