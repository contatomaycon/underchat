const DEFAULT_BAILEYS_SEND_MESSAGE_TIMEOUT_MS = 45_000;
const MIN_BAILEYS_SEND_MESSAGE_TIMEOUT_MS = 5_000;
const MAX_BAILEYS_SEND_MESSAGE_TIMEOUT_MS = 120_000;

export function resolveBaileysSendMessageTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.BAILEYS_SEND_MESSAGE_TIMEOUT_MS ?? '',
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BAILEYS_SEND_MESSAGE_TIMEOUT_MS;
  }

  return Math.min(
    MAX_BAILEYS_SEND_MESSAGE_TIMEOUT_MS,
    Math.max(MIN_BAILEYS_SEND_MESSAGE_TIMEOUT_MS, parsed)
  );
}

export class BaileysSendMessageTimeoutError extends Error {
  readonly code = 'BAILEYS_SEND_MESSAGE_TIMEOUT';

  constructor(timeoutMs: number) {
    super(`Baileys provider send timed out after ${timeoutMs}ms`);
    this.name = 'BaileysSendMessageTimeoutError';
  }
}

interface InvokeBaileysProviderSendWithTimeoutInput<T> {
  invoke: () => Promise<T>;
  operation: 'relay_message' | 'send_message';
  timeoutMs: number;
}

function describeError(error: unknown): {
  name?: string;
  message: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  return { message: String(error ?? '') };
}

export function invokeBaileysProviderSendWithTimeout<T>(
  input: InvokeBaileysProviderSendWithTimeoutInput<T>
): Promise<T> {
  const startedAt = Date.now();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      const error = new BaileysSendMessageTimeoutError(input.timeoutMs);
      console.error('[BaileysSend] provider_send_timeout', {
        operation: input.operation,
        timeout_ms: input.timeoutMs,
        duration_ms: Date.now() - startedAt,
        error: describeError(error),
      });
      reject(error);
    }, input.timeoutMs);
    timer.unref?.();

    /*
     * Baileys does not expose cancellation for these provider calls. Keep
     * handlers attached after our deadline so a late rejection is observed
     * and can never become an unhandled rejection in the worker process.
     */
    let providerCall: Promise<T>;
    try {
      providerCall = input.invoke();
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
      return;
    }

    void providerCall.then(
      (value) => {
        if (settled) {
          console.warn(
            '[BaileysSend] provider_send_resolved_after_application_timeout',
            {
              operation: input.operation,
              timeout_ms: input.timeoutMs,
              duration_ms: Date.now() - startedAt,
            }
          );
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          console.warn(
            '[BaileysSend] provider_send_rejected_after_application_timeout',
            {
              operation: input.operation,
              timeout_ms: input.timeoutMs,
              duration_ms: Date.now() - startedAt,
              error: describeError(error),
            }
          );
          return;
        }

        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
