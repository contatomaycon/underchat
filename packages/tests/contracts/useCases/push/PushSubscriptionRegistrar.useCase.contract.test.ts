import 'reflect-metadata';

jest.mock('@core/services/pushSubscription.service', () => ({
  PushSubscriptionService: class {},
}));

import { PushSubscriptionRegistrarUseCase } from '@core/useCases/push/PushSubscriptionRegistrar.useCase';

describe('PushSubscriptionRegistrarUseCase', () => {
  it('returns invalid_payload when endpoint is empty', async () => {
    const pushSubscriptionService = {
      registerSubscription: jest.fn(),
      getPublicKey: jest.fn(),
    };
    const useCase = new PushSubscriptionRegistrarUseCase(
      pushSubscriptionService as never
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        endpoint: '',
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid_payload',
    });
    expect(pushSubscriptionService.registerSubscription).not.toHaveBeenCalled();
  });

  it('returns invalid_payload when webpush keys are missing', async () => {
    const pushSubscriptionService = {
      registerSubscription: jest.fn(),
      getPublicKey: jest.fn(),
    };
    const useCase = new PushSubscriptionRegistrarUseCase(
      pushSubscriptionService as never
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        endpoint: 'https://push.endpoint',
        provider: 'webpush',
        keys: { p256dh: '', auth: 'auth' },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid_payload',
    });
    expect(pushSubscriptionService.registerSubscription).not.toHaveBeenCalled();
  });

  it('returns vapid_not_configured when webpush has no public key', async () => {
    const pushSubscriptionService = {
      registerSubscription: jest.fn(async () => ({
        push_subscription_id: 'sub-1',
      })),
      getPublicKey: jest.fn(() => null),
    };
    const useCase = new PushSubscriptionRegistrarUseCase(
      pushSubscriptionService as never
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        endpoint: ' https://push.endpoint ',
        provider: 'webpush',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'vapid_not_configured',
    });
    expect(pushSubscriptionService.registerSubscription).not.toHaveBeenCalled();
  });

  it('registers webpush subscription and returns public key', async () => {
    const pushSubscriptionService = {
      registerSubscription: jest.fn(async () => ({
        push_subscription_id: 'sub-1',
      })),
      getPublicKey: jest.fn(() => 'pub-key'),
    };
    const useCase = new PushSubscriptionRegistrarUseCase(
      pushSubscriptionService as never
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        endpoint: 'https://push.endpoint',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      })
    ).resolves.toEqual({
      ok: true,
      data: {
        push_subscription_id: 'sub-1',
        public_key: 'pub-key',
      },
    });
  });

  it('registers non-webpush provider and returns null public key', async () => {
    const pushSubscriptionService = {
      registerSubscription: jest.fn(async () => ({
        push_subscription_id: 'sub-2',
      })),
      getPublicKey: jest.fn(() => null),
    };
    const useCase = new PushSubscriptionRegistrarUseCase(
      pushSubscriptionService as never
    );

    await expect(
      useCase.execute({
        userId: 'user-1',
        endpoint: 'https://push.endpoint',
        provider: 'onesignal',
      } as never)
    ).resolves.toEqual({
      ok: true,
      data: {
        push_subscription_id: 'sub-2',
        public_key: null,
      },
    });
    expect(pushSubscriptionService.registerSubscription).toHaveBeenCalledWith({
      user_id: 'user-1',
      provider: 'onesignal',
      platform: undefined,
      endpoint: 'https://push.endpoint',
      p256dh: null,
      auth: null,
      user_agent: undefined,
    });
  });
});
