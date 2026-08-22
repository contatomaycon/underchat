export interface PeriodicTaskLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface PeriodicTask {
  start(): void;
  stop(): Promise<void>;
}

interface CreatePeriodicTaskInput {
  readonly name: string;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
  readonly logger: PeriodicTaskLogger;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs a background task serially and schedules the next execution only after
 * the current one settles. This prevents slow dependencies from creating an
 * unbounded queue of overlapping timer callbacks.
 */
export const createPeriodicTask = (
  input: CreatePeriodicTaskInput
): PeriodicTask => {
  let isStopped = true;
  let timer: NodeJS.Timeout | null = null;
  let currentRun: Promise<void> | null = null;

  const schedule = (delayMs: number): void => {
    if (isStopped) return;

    timer = setTimeout(execute, delayMs);
    timer.unref();
  };

  const execute = (): void => {
    timer = null;
    if (isStopped || currentRun) return;

    currentRun = input
      .run()
      .catch((error: unknown) => {
        input.logger.error(
          { task: input.name, error: errorMessage(error) },
          'Webhook dispatcher background task failed'
        );
      })
      .finally(() => {
        currentRun = null;
        schedule(input.intervalMs);
      });
  };

  return {
    start: (): void => {
      if (!isStopped) return;
      isStopped = false;
      schedule(0);
    },
    stop: async (): Promise<void> => {
      isStopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await currentRun;
    },
  };
};
