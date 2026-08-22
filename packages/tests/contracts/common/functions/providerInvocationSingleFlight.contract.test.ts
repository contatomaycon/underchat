import { ProviderInvocationSingleFlight } from '@core/common/functions/providerInvocationSingleFlight';

describe('ProviderInvocationSingleFlight shared runtime fence', () => {
  it('shares a stalled provider identity across service instances', () => {
    const firstServiceFence = new ProviderInvocationSingleFlight();
    const secondServiceFence = new ProviderInvocationSingleFlight();
    const oldClient = {};
    const recreatedClient = {};

    const lease = firstServiceFence.acquire(oldClient);
    expect(lease).not.toBeNull();
    lease?.markStalled();

    expect(secondServiceFence.acquire(oldClient)).toBeNull();
    expect(secondServiceFence.acquire(recreatedClient)).not.toBeNull();
  });

  it('bounds healthy calls per provider identity and admits work after settlement', async () => {
    const firstServiceFence = new ProviderInvocationSingleFlight();
    const secondServiceFence = new ProviderInvocationSingleFlight();
    const client = {};
    let resolveFirst!: () => void;
    const firstCall = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const leases = [
      firstServiceFence.acquire(client),
      secondServiceFence.acquire(client),
      firstServiceFence.acquire(client),
      secondServiceFence.acquire(client),
    ];
    expect(leases.every(Boolean)).toBe(true);
    expect(firstServiceFence.acquire(client)).toBeNull();

    const running = leases[0]?.start(() => firstCall);
    resolveFirst();
    await running;

    expect(secondServiceFence.acquire(client)).not.toBeNull();
    for (const lease of leases.slice(1)) {
      lease?.releaseBeforeStart();
    }
  });

  it('returns a reserved slot when authorization rejects before provider start', () => {
    const fence = new ProviderInvocationSingleFlight();
    const client = {};
    const leases = Array.from({ length: 4 }, () => fence.acquire(client));

    expect(leases.every(Boolean)).toBe(true);
    expect(fence.acquire(client)).toBeNull();

    leases[0]?.releaseBeforeStart();

    expect(fence.acquire(client)).not.toBeNull();
    for (const lease of leases.slice(1)) {
      lease?.releaseBeforeStart();
    }
  });
});
