interface ServiceApiConsumerStartupLifecycleInstance {
  isClosing(): boolean;
  start(startup: () => Promise<void>): void;
  shutdown(closeConsumers: () => Promise<void>): Promise<void>;
}

interface ServiceApiConsumerStartupLifecycleConstructor {
  new (options: {
    onStartupError: (error: unknown) => void;
  }): ServiceApiConsumerStartupLifecycleInstance;
}

const loadServiceApiConsumerStartupLifecycle =
  (): ServiceApiConsumerStartupLifecycleConstructor =>
    (
      require('../../../../apps/service_api/src/consumer/startupLifecycle') as {
        ServiceApiConsumerStartupLifecycle: ServiceApiConsumerStartupLifecycleConstructor;
      }
    ).ServiceApiConsumerStartupLifecycle;

describe('ServiceApiConsumerStartupLifecycle', () => {
  it('cancels and awaits startup before closing registered consumers', async () => {
    const ServiceApiConsumerStartupLifecycle =
      loadServiceApiConsumerStartupLifecycle();
    const events: string[] = [];
    let releaseBarrierWait: (() => void) | undefined;
    let startupEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      startupEntered = resolve;
    });
    const barrierWait = new Promise<void>((resolve) => {
      releaseBarrierWait = resolve;
    });
    const lifecycle = new ServiceApiConsumerStartupLifecycle({
      onStartupError: jest.fn(),
    });

    lifecycle.start(async () => {
      startupEntered?.();
      await barrierWait;
      expect(lifecycle.isClosing()).toBe(true);
      events.push('leadership_lock_released');
    });
    await entered;

    const shutdown = lifecycle.shutdown(async () => {
      events.push('consumers_closed');
    });

    expect(lifecycle.isClosing()).toBe(true);
    expect(events).toEqual([]);

    releaseBarrierWait?.();
    await shutdown;

    expect(events).toEqual(['leadership_lock_released', 'consumers_closed']);
  });

  it('reports a startup failure and still completes shutdown', async () => {
    const ServiceApiConsumerStartupLifecycle =
      loadServiceApiConsumerStartupLifecycle();
    const startupError = new Error('consumer_startup_failed');
    let failureReported: (() => void) | undefined;
    const reported = new Promise<void>((resolve) => {
      failureReported = resolve;
    });
    const onStartupError = jest.fn(() => failureReported?.());
    const lifecycle = new ServiceApiConsumerStartupLifecycle({
      onStartupError,
    });

    lifecycle.start(async () => {
      throw startupError;
    });
    await reported;

    const closeConsumers = jest.fn(async () => undefined);
    await lifecycle.shutdown(closeConsumers);

    expect(onStartupError).toHaveBeenCalledWith(startupError);
    expect(closeConsumers).toHaveBeenCalledTimes(1);
  });

  it('does not report cancellation as a startup error during shutdown', async () => {
    const ServiceApiConsumerStartupLifecycle =
      loadServiceApiConsumerStartupLifecycle();
    const onStartupError = jest.fn();
    let rejectBarrierWait: ((error: Error) => void) | undefined;
    const lifecycle = new ServiceApiConsumerStartupLifecycle({
      onStartupError,
    });

    lifecycle.start(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectBarrierWait = reject;
        })
    );
    await Promise.resolve();

    const shutdown = lifecycle.shutdown(async () => undefined);
    rejectBarrierWait?.(new Error('cutover barrier was cancelled'));
    await shutdown;

    expect(onStartupError).not.toHaveBeenCalled();
  });
});
