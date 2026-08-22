export type ServiceApiConsumerStartupAttemptState =
  'pending' | 'fulfilled' | 'rejected';

export interface IServiceApiConsumerStartupAttempt {
  attempt: number;
  error?: unknown;
  promise: Promise<void>;
  retry: () => Promise<void>;
  state: ServiceApiConsumerStartupAttemptState;
}

const startupAttempts = new WeakMap<
  object,
  IServiceApiConsumerStartupAttempt
>();

/**
 * Starts a consumer while retaining its promise for the central startup
 * coordinator. Keeping this outside the consumer implementations lets every
 * Service API consumer participate without coupling the shared consumers to
 * the Service API lifecycle.
 */
export function launchServiceApiConsumerStartup<TConsumer extends object>(
  consumer: TConsumer,
  start: () => Promise<void>,
  onError: (error: unknown) => void
): TConsumer {
  const attempt: IServiceApiConsumerStartupAttempt = {
    attempt: 0,
    promise: Promise.resolve(),
    retry: async () => undefined,
    state: 'pending',
  };
  const run = (): Promise<void> => {
    attempt.attempt += 1;
    attempt.error = undefined;
    attempt.state = 'pending';
    const promise = Promise.resolve().then(start);
    attempt.promise = promise;

    void promise.then(
      () => {
        if (attempt.promise === promise) {
          attempt.state = 'fulfilled';
        }
      },
      (error: unknown) => {
        if (attempt.promise !== promise) {
          return;
        }
        attempt.error = error;
        attempt.state = 'rejected';
        try {
          onError(error);
        } catch {
          // Startup coordination remains authoritative even if logging fails.
        }
      }
    );
    return promise;
  };
  attempt.retry = run;
  startupAttempts.set(consumer, attempt);
  void run();

  return consumer;
}

export function getServiceApiConsumerStartupAttempt(
  consumer: object
): IServiceApiConsumerStartupAttempt | null {
  return startupAttempts.get(consumer) ?? null;
}
