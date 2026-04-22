import 'reflect-metadata';

jest.mock('@core/services/pushSubscription.service', () => ({
  PushSubscriptionService: class {},
}));

import { PushPublicKeyViewerUseCase } from '@core/useCases/push/PushPublicKeyViewer.useCase';

describe('PushPublicKeyViewerUseCase', () => {
  it('returns public key from service', () => {
    const pushSubscriptionService = {
      getPublicKey: jest.fn(() => 'pub-key'),
    };
    const useCase = new PushPublicKeyViewerUseCase(
      pushSubscriptionService as never
    );

    expect(useCase.execute()).toBe('pub-key');
  });

  it('returns null when service has no public key', () => {
    const pushSubscriptionService = {
      getPublicKey: jest.fn(() => null),
    };
    const useCase = new PushPublicKeyViewerUseCase(
      pushSubscriptionService as never
    );

    expect(useCase.execute()).toBeNull();
  });
});
