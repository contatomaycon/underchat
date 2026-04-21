import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { PushSubscriptionService } from '@core/services/pushSubscription.service';

describe('PushSubscriptionService', () => {
  it('registers, deletes and exposes public key', async () => {
    const createOrUpdate = jest.fn(async () => ({
      push_subscription_id: 'ps1',
    }));
    const deleteByUserAndEndpoint = jest.fn(async () => true);
    const getPublicKey = jest.fn(() => 'public-key');

    const service = new PushSubscriptionService(
      { createOrUpdate } as never,
      { deleteByUserAndEndpoint } as never,
      { getPublicKey } as never
    );

    await expect(
      service.registerSubscription({ endpoint: 'e' } as never)
    ).resolves.toEqual({ push_subscription_id: 'ps1' });
    await expect(
      service.deleteSubscription('u1', 'e1', 'webpush' as never)
    ).resolves.toBe(true);
    expect(service.getPublicKey()).toBe('public-key');
  });
});
