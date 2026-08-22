export interface IServiceApiConsumerStartupLifecycleOptions {
  onStartupError: (error: unknown) => void;
}

/**
 * Coordinates the asynchronous Kafka startup with Fastify shutdown.
 *
 * The cutover leader owns a renewable Redis lock while startup is pending.
 * Shutdown must therefore signal cancellation and await the startup promise so
 * the barrier can run its lock-release `finally` before consumers are closed.
 */
export class ServiceApiConsumerStartupLifecycle {
  private closing = false;
  private startupPromise: Promise<void> | null = null;

  constructor(
    private readonly options: IServiceApiConsumerStartupLifecycleOptions
  ) {}

  isClosing = (): boolean => this.closing;

  start(startup: () => Promise<void>): void {
    if (this.startupPromise) {
      throw new Error('Service API consumer startup is already running');
    }

    this.closing = false;
    const attempt = Promise.resolve().then(startup);
    this.startupPromise = attempt;
    void attempt.catch((error: unknown) => {
      if (this.closing) {
        return;
      }
      this.options.onStartupError(error);
    });
  }

  async shutdown(closeConsumers: () => Promise<void>): Promise<void> {
    this.closing = true;
    const startupAttempt = this.startupPromise;

    if (startupAttempt) {
      await startupAttempt.catch(() => undefined);
      if (this.startupPromise === startupAttempt) {
        this.startupPromise = null;
      }
    }

    await closeConsumers();
  }
}
