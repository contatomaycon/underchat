import 'reflect-metadata';

jest.mock('@core/services/pushSubscription.service', () => ({
  PushSubscriptionService: class {},
}));

import { PushSubscriptionDeleterUseCase } from '@core/useCases/push/PushSubscriptionDeleter.useCase';

describe('PushSubscriptionDeleterUseCase', () => {
  it('returns invalid_payload when endpoint is empty', async () => {
    const pushSubscriptionService = {
      deleteSubscription: jest.fn(),
    };
    const useCase = new PushSubscriptionDeleterUseCase(
      pushSubscriptionService as never
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        endpoint: '   ',
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid_payload',
    });
    expect(pushSubscriptionService.deleteSubscription).not.toHaveBeenCalled();
  });

  it('deletes subscription when endpoint is valid', async () => {
    const pushSubscriptionService = {
      deleteSubscription: jest.fn(async () => undefined),
    };
    const useCase = new PushSubscriptionDeleterUseCase(
      pushSubscriptionService as never
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        endpoint: ' https://push.endpoint ',
        provider: 'webpush',
      })
    ).resolves.toEqual({
      ok: true,
    });
    expect(pushSubscriptionService.deleteSubscription).toHaveBeenCalledWith(
      'user-1',
      'https://push.endpoint',
      'webpush'
    );
  });
});
