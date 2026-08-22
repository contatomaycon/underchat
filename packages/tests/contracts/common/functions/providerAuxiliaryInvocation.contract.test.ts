import {
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationSingleFlight,
  ProviderAuxiliaryInvocationTimeoutError,
  resolveProviderAuxiliaryTimeoutMs,
} from '@core/common/functions/providerAuxiliaryInvocation';

describe('provider auxiliary invocation boundary', () => {
  const originalTimeout = process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    } else {
      process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = originalTimeout;
    }
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses a bounded configurable deadline', () => {
    delete process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    expect(resolveProviderAuxiliaryTimeoutMs()).toBe(15_000);

    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '10';
    expect(resolveProviderAuxiliaryTimeoutMs()).toBe(1_000);

    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '999999';
    expect(resolveProviderAuxiliaryTimeoutMs()).toBe(60_000);
  });

  it('times out a never-settling call while retaining its stable-key slot', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const scope = {};
    const singleFlight = new ProviderAuxiliaryInvocationSingleFlight();
    const lease = singleFlight.acquire(scope, 'mark_read');
    expect(lease).not.toBeNull();
    const providerCall = lease?.start(
      () => new Promise<never>(() => undefined)
    );

    const invocation = invokeProviderAuxiliaryWithTimeout({
      provider: 'baileys',
      operation: 'mark_read',
      timeoutMs: 1_000,
      invoke: () => providerCall as Promise<never>,
    });
    const rejection = expect(invocation).rejects.toBeInstanceOf(
      ProviderAuxiliaryInvocationTimeoutError
    );

    await jest.advanceTimersByTimeAsync(1_000);
    await rejection;

    expect(singleFlight.acquire(scope, 'mark_read')).toBeNull();
  });

  it('observes late settlement and only then releases the stable-key slot', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const scope = {};
    const singleFlight = new ProviderAuxiliaryInvocationSingleFlight();
    const lease = singleFlight.acquire(scope, 'update_profile_status');
    let resolveLate!: (value: string) => void;
    const providerCall = lease?.start(
      () =>
        new Promise<string>((resolve) => {
          resolveLate = resolve;
        })
    );
    const invocation = invokeProviderAuxiliaryWithTimeout({
      provider: 'wwebjs',
      operation: 'update_profile_status',
      timeoutMs: 1_000,
      invoke: () => providerCall as Promise<string>,
    });
    const rejection = expect(invocation).rejects.toMatchObject({
      code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
      provider: 'wwebjs',
      operation: 'update_profile_status',
    });

    await jest.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(singleFlight.acquire(scope, 'update_profile_status')).toBeNull();

    resolveLate('completed-late');
    await Promise.resolve();
    await Promise.resolve();

    expect(singleFlight.acquire(scope, 'update_profile_status')).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[WhatsappProviderAuxiliary] operation_resolved_after_timeout',
      expect.objectContaining({
        provider: 'wwebjs',
        operation: 'update_profile_status',
      })
    );
  });

  it('releases a reservation when the provider boundary fails before start', () => {
    const scope = {};
    const singleFlight = new ProviderAuxiliaryInvocationSingleFlight();
    const lease = singleFlight.acquire(scope, 'update_profile_name');

    lease?.releaseBeforeStart();

    expect(singleFlight.acquire(scope, 'update_profile_name')).not.toBeNull();
  });
});
