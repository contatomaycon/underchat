import {
  dispatchOutboundWebhookHttp,
  OUTBOUND_WEBHOOK_MAX_PAYLOAD_BYTES,
  OUTBOUND_WEBHOOK_MAX_RETRY_AFTER_MS,
  type DispatchOutboundWebhookHttpInput,
  type OutboundWebhookHttpResult,
} from '@core/common/functions/outboundWebhookHttp';
import { createOutboundWebhookSignature } from '@core/common/functions/outboundWebhookSignature';
import {
  OUTBOUND_WEBHOOK_MAX_ATTEMPTS,
  type ClaimedOutboundWebhookDelivery,
  type CompleteOutboundWebhookAttemptInput,
  type OutboundWebhookAttemptOutcome,
  type OutboundWebhookDispatcherStore,
  type OutboundWebhookSuspension,
  type PreparedOutboundWebhookDelivery,
} from '@core/services/outboundWebhookDispatcherStore';
import { randomUUID } from 'node:crypto';

export { OUTBOUND_WEBHOOK_MAX_ATTEMPTS };

export const OUTBOUND_WEBHOOK_LEASE_COMPLETION_GRACE_MS = 5_000;

/** Caps infrastructure retry pressure while keeping database recovery automatic. */
export const OUTBOUND_WEBHOOK_CLAIM_FAILURE_BACKOFF_MAX_MS = 30_000;

/**
 * Retry caps for attempts 1..6. Attempt 1 is sent immediately; a failed attempt
 * uses its corresponding cap before the following attempt.
 */
export const OUTBOUND_WEBHOOK_RETRY_CAPS_MS = [
  0,
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  8 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);
const INTERNAL_HTTP_FAILURE_CODES = new Set(['payload_too_large']);

export interface OutboundWebhookSecretDecryptor {
  decrypt(encryptedText: string): string;
}

export interface OutboundWebhookDispatcherLogger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface OutboundWebhookSuspensionNotifier {
  notify(suspension: OutboundWebhookSuspension): Promise<void>;
}

export interface OutboundWebhookDispatcherOptions {
  readonly concurrency: number;
  readonly leaseDurationMs: number;
  readonly pollIntervalMs: number;
  readonly isProduction: boolean;
  readonly allowLocalhostHttp: boolean;
  readonly requestTimeoutMs?: number;
}

export interface OutboundWebhookDispatcherDependencies {
  readonly store: OutboundWebhookDispatcherStore;
  readonly secretDecryptor: OutboundWebhookSecretDecryptor;
  readonly options: OutboundWebhookDispatcherOptions;
  readonly logger?: OutboundWebhookDispatcherLogger;
  readonly suspensionNotifier?: OutboundWebhookSuspensionNotifier;
  readonly dispatchHttp?: (
    input: DispatchOutboundWebhookHttpInput
  ) => Promise<OutboundWebhookHttpResult>;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly createId?: () => string;
}

const consoleLogger: OutboundWebhookDispatcherLogger = {
  debug: (context, message) => console.debug(message, context),
  info: (context, message) => console.info(message, context),
  warn: (context, message) => console.warn(message, context),
  error: (context, message) => console.error(message, context),
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isRetryableHttpStatus = (statusCode: number): boolean =>
  RETRYABLE_HTTP_STATUSES.has(statusCode) ||
  (statusCode >= 500 && statusCode <= 599);

const normalizePositiveInteger = (input: {
  value: number | undefined;
  fallback: number;
  maximum?: number;
}): number => {
  const finiteValue = Number.isFinite(input.value)
    ? Math.floor(input.value as number)
    : input.fallback;
  return Math.max(
    1,
    input.maximum === undefined
      ? finiteValue
      : Math.min(finiteValue, input.maximum)
  );
};

export const computeOutboundWebhookRetryDelayMs = (input: {
  attemptNumber: number;
  retryAfterMs: number | null;
  random: () => number;
}): number => {
  const cap = OUTBOUND_WEBHOOK_RETRY_CAPS_MS[input.attemptNumber];
  if (cap === undefined || cap <= 0) {
    throw new Error('No outbound webhook retry follows this attempt');
  }

  const sampledRandom = input.random();
  const randomValue = Number.isFinite(sampledRandom)
    ? Math.min(0.999999999999, Math.max(0, sampledRandom))
    : 0.5;
  const jitter = Math.floor(randomValue * cap);
  const requestedRetryAfter = Number.isFinite(input.retryAfterMs)
    ? (input.retryAfterMs ?? 0)
    : 0;
  const retryAfter = Math.min(
    OUTBOUND_WEBHOOK_MAX_RETRY_AFTER_MS,
    Math.max(0, requestedRetryAfter)
  );
  return Math.max(jitter, retryAfter);
};

/**
 * Applies equal jitter to exponential claim-failure delays. The first failure
 * retains the regular poll interval up to the 30-second safety cap.
 */
export const computeOutboundWebhookClaimFailureBackoffMs = (input: {
  consecutiveFailures: number;
  pollIntervalMs: number;
  random: () => number;
}): number => {
  const pollIntervalMs = normalizePositiveInteger({
    value: input.pollIntervalMs,
    fallback: 1_000,
  });
  const consecutiveFailures = normalizePositiveInteger({
    value: input.consecutiveFailures,
    fallback: 1,
  });
  const baseDelayMs = Math.min(
    pollIntervalMs,
    OUTBOUND_WEBHOOK_CLAIM_FAILURE_BACKOFF_MAX_MS
  );
  const exponent = Math.min(30, consecutiveFailures - 1);
  const exponentialDelayMs = Math.min(
    OUTBOUND_WEBHOOK_CLAIM_FAILURE_BACKOFF_MAX_MS,
    baseDelayMs * 2 ** exponent
  );
  const sampledRandom = input.random();
  const randomValue = Number.isFinite(sampledRandom)
    ? Math.min(0.999999999999, Math.max(0, sampledRandom))
    : 0.5;
  const jitterFloorMs = Math.floor(exponentialDelayMs / 2);
  const jitterRangeMs = exponentialDelayMs - jitterFloorMs;

  return Math.max(
    baseDelayMs,
    jitterFloorMs + Math.floor(randomValue * jitterRangeMs)
  );
};

const serializePayload = (payload: unknown): Buffer => {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error('Outbound webhook payload is not JSON serializable');
  }

  const rawBody = Buffer.from(serialized, 'utf8');
  if (rawBody.byteLength > OUTBOUND_WEBHOOK_MAX_PAYLOAD_BYTES) {
    throw new Error('Outbound webhook payload exceeds 1 MiB');
  }

  return rawBody;
};

const buildCompletionBase = (input: {
  prepared: PreparedOutboundWebhookDelivery;
  finishedAt: Date;
  attemptOutcome: OutboundWebhookAttemptOutcome;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  responseBody: string | null;
  durationMs: number;
  retryAfterMs: number | null;
  affectsEndpointHealth: boolean;
}): Omit<
  CompleteOutboundWebhookAttemptInput,
  'deliveryStatus' | 'retryDelayMs' | 'suspendImmediately'
> => ({
  deliveryId: input.prepared.deliveryId,
  leaseToken: input.prepared.leaseToken,
  attemptId: input.prepared.attemptId,
  attemptNumber: input.prepared.attemptNumber,
  configVersion: input.prepared.configVersion,
  attemptOutcome: input.attemptOutcome,
  finishedAt: input.finishedAt,
  httpStatus: input.httpStatus,
  errorCode: input.errorCode,
  errorMessage: input.errorMessage,
  responseBody: input.responseBody,
  durationMs: input.durationMs,
  retryAfterMs: input.retryAfterMs,
  affectsEndpointHealth: input.affectsEndpointHealth,
});

/**
 * Claims and delivers outbound webhook rows with an at-least-once lease model.
 */
export class OutboundWebhookDispatcherService {
  private readonly store: OutboundWebhookDispatcherStore;
  private readonly secretDecryptor: OutboundWebhookSecretDecryptor;
  private readonly options: OutboundWebhookDispatcherOptions;
  private readonly logger: OutboundWebhookDispatcherLogger;
  private readonly suspensionNotifier?: OutboundWebhookSuspensionNotifier;
  private readonly dispatchHttp: (
    input: DispatchOutboundWebhookHttpInput
  ) => Promise<OutboundWebhookHttpResult>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly createId: () => string;
  private isRunningValue = false;
  private isStopping = false;
  private loopPromise: Promise<void> | null = null;
  private sleepAbortController: AbortController | null = null;

  constructor(dependencies: OutboundWebhookDispatcherDependencies) {
    const requestTimeoutMs = normalizePositiveInteger({
      value: dependencies.options.requestTimeoutMs,
      fallback: 10_000,
      maximum: 10_000,
    });
    const minimumLeaseDurationMs =
      requestTimeoutMs + OUTBOUND_WEBHOOK_LEASE_COMPLETION_GRACE_MS;
    this.store = dependencies.store;
    this.secretDecryptor = dependencies.secretDecryptor;
    this.options = {
      ...dependencies.options,
      concurrency: normalizePositiveInteger({
        value: dependencies.options.concurrency,
        fallback: 1,
      }),
      leaseDurationMs: Math.max(
        minimumLeaseDurationMs,
        normalizePositiveInteger({
          value: dependencies.options.leaseDurationMs,
          fallback: minimumLeaseDurationMs,
        })
      ),
      pollIntervalMs: normalizePositiveInteger({
        value: dependencies.options.pollIntervalMs,
        fallback: 1_000,
      }),
      requestTimeoutMs,
    };
    this.logger = dependencies.logger ?? consoleLogger;
    this.suspensionNotifier = dependencies.suspensionNotifier;
    this.dispatchHttp =
      dependencies.dispatchHttp ?? dispatchOutboundWebhookHttp;
    this.now = dependencies.now ?? (() => new Date());
    this.random = dependencies.random ?? Math.random;
    this.createId = dependencies.createId ?? randomUUID;
  }

  get isRunning(): boolean {
    return this.isRunningValue && !this.isStopping;
  }

  start(): void {
    if (this.loopPromise) {
      return;
    }

    this.isStopping = false;
    this.isRunningValue = true;
    this.loopPromise = this.runLoop()
      .catch((error: unknown) => {
        this.logger.error(
          { error: errorMessage(error) },
          'Outbound webhook dispatcher stopped unexpectedly'
        );
      })
      .finally(() => {
        this.isRunningValue = false;
        this.loopPromise = null;
      });
  }

  async stop(): Promise<void> {
    this.isStopping = true;
    this.sleepAbortController?.abort();
    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.isRunningValue = false;
  }

  async runOnce(): Promise<number> {
    if (this.isStopping) {
      return 0;
    }

    const leaseToken = this.createId();
    const claims = await this.store.claimDue({
      limit: this.options.concurrency,
      leaseToken,
      leaseDurationMs: this.options.leaseDurationMs,
      now: this.now(),
    });

    const results = await Promise.allSettled(
      claims.map((claim) => this.processClaim(claim))
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          {
            delivery_id: claims[index]?.deliveryId,
            error: errorMessage(result.reason),
          },
          'Outbound webhook delivery processing failed; its lease will expire'
        );
      }
    });

    return claims.length;
  }

  private async runLoop(): Promise<void> {
    this.logger.info({}, 'Outbound webhook dispatcher started');
    let consecutiveClaimFailures = 0;

    while (!this.isStopping) {
      let claimed = 0;
      try {
        claimed = await this.runOnce();
        consecutiveClaimFailures = 0;
      } catch (error: unknown) {
        consecutiveClaimFailures += 1;
        const retryDelayMs = computeOutboundWebhookClaimFailureBackoffMs({
          consecutiveFailures: consecutiveClaimFailures,
          pollIntervalMs: this.options.pollIntervalMs,
          random: this.random,
        });
        this.logger.error(
          {
            error: errorMessage(error),
            consecutive_claim_failures: consecutiveClaimFailures,
            retry_delay_ms: retryDelayMs,
            retry_delay_cap_ms: OUTBOUND_WEBHOOK_CLAIM_FAILURE_BACKOFF_MAX_MS,
          },
          'Outbound webhook claim cycle failed'
        );

        if (!this.isStopping) {
          await this.waitForDelay(retryDelayMs);
        }
        continue;
      }

      if (!this.isStopping && claimed === 0) {
        await this.waitForNextPoll();
      }
    }

    this.logger.info({}, 'Outbound webhook dispatcher drained');
  }

  private async waitForNextPoll(): Promise<void> {
    await this.waitForDelay(this.options.pollIntervalMs);
  }

  private async waitForDelay(delayMs: number): Promise<void> {
    const controller = new AbortController();
    this.sleepAbortController = controller;

    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timeout = setTimeout(finish, delayMs);
      timeout.unref();
      controller.signal.addEventListener('abort', finish, { once: true });
    });

    if (this.sleepAbortController === controller) {
      this.sleepAbortController = null;
    }
  }

  private async processClaim(
    claim: ClaimedOutboundWebhookDelivery
  ): Promise<void> {
    const prepared = await this.store.prepareAttempt({
      claim,
      attemptId: this.createId(),
      leaseDurationMs: this.options.leaseDurationMs,
      now: this.now(),
    });

    if (prepared.kind !== 'ready') {
      this.logger.debug(
        {
          delivery_id: prepared.deliveryId,
          result: prepared.kind,
          reason: prepared.kind === 'suppressed' ? prepared.reason : undefined,
        },
        'Outbound webhook preflight did not produce a request'
      );
      return;
    }

    let rawBody: Buffer;
    let secret: string;
    try {
      rawBody = serializePayload(prepared.payload);
      secret = this.secretDecryptor.decrypt(prepared.secretEncrypted);
      if (!secret) {
        throw new Error('Outbound webhook signing secret is empty');
      }
    } catch (error: unknown) {
      await this.completeInternalFailure({
        prepared,
        error,
        retryable: false,
      });
      return;
    }

    const requestStartedAt = this.now();
    const unixTimestamp = Math.floor(requestStartedAt.getTime() / 1000);
    let signature: string;
    try {
      signature = createOutboundWebhookSignature({
        secret,
        unixTimestamp,
        rawBody,
      });
    } catch (error: unknown) {
      await this.completeInternalFailure({
        prepared,
        error,
        retryable: false,
      });
      return;
    }

    let result: OutboundWebhookHttpResult;
    try {
      result = await this.dispatchHttp({
        url: prepared.endpointUrl,
        rawBody,
        signature,
        unixTimestamp,
        metadata: {
          event: prepared.eventType,
          eventId: prepared.eventId,
          deliveryId: prepared.deliveryId,
          attempt: prepared.attemptNumber,
          webhookConfigVersion: prepared.configVersion,
        },
        isProduction: this.options.isProduction,
        allowLocalhostHttp: this.options.allowLocalhostHttp,
        timeoutMs: this.options.requestTimeoutMs,
      });
    } catch (error: unknown) {
      await this.completeInternalFailure({
        prepared,
        error,
        retryable: true,
      });
      return;
    }

    await this.completeHttpResult(prepared, result);
  }

  private async completeInternalFailure(input: {
    prepared: PreparedOutboundWebhookDelivery;
    error: unknown;
    retryable: boolean;
  }): Promise<void> {
    const finishedAt = this.now();
    const message = errorMessage(input.error);
    const canRetry =
      input.retryable &&
      input.prepared.attemptNumber < OUTBOUND_WEBHOOK_MAX_ATTEMPTS;
    const completionBase = buildCompletionBase({
      prepared: input.prepared,
      finishedAt,
      attemptOutcome: 'internal_error',
      httpStatus: null,
      errorCode: 'internal_error',
      errorMessage: message,
      responseBody: null,
      durationMs: 0,
      retryAfterMs: null,
      affectsEndpointHealth: false,
    });

    if (canRetry) {
      const delayMs = computeOutboundWebhookRetryDelayMs({
        attemptNumber: input.prepared.attemptNumber,
        retryAfterMs: null,
        random: this.random,
      });
      await this.completeAndNotify({
        ...completionBase,
        deliveryStatus: 'retrying',
        retryDelayMs: delayMs,
        suspendImmediately: false,
      });
      return;
    }

    await this.completeAndNotify({
      ...completionBase,
      deliveryStatus: 'dead',
      suspendImmediately: false,
    });
  }

  private async completeHttpResult(
    prepared: PreparedOutboundWebhookDelivery,
    result: OutboundWebhookHttpResult
  ): Promise<void> {
    const finishedAt = this.now();

    if (result.kind === 'response') {
      const isSuccess = result.statusCode >= 200 && result.statusCode <= 299;
      const retryable = isRetryableHttpStatus(result.statusCode);
      const canRetry =
        retryable && prepared.attemptNumber < OUTBOUND_WEBHOOK_MAX_ATTEMPTS;
      const completionBase = buildCompletionBase({
        prepared,
        finishedAt,
        attemptOutcome: isSuccess ? 'succeeded' : 'http_error',
        httpStatus: result.statusCode,
        errorCode: isSuccess ? null : `http_${result.statusCode}`,
        errorMessage: isSuccess
          ? null
          : `Outbound webhook returned HTTP ${result.statusCode}`,
        responseBody: result.responseBody,
        durationMs: result.durationMs,
        retryAfterMs: result.retryAfterMs,
        affectsEndpointHealth: true,
      });

      if (isSuccess) {
        await this.completeAndNotify({
          ...completionBase,
          deliveryStatus: 'succeeded',
          suspendImmediately: false,
        });
        return;
      }

      if (canRetry) {
        const delayMs = computeOutboundWebhookRetryDelayMs({
          attemptNumber: prepared.attemptNumber,
          retryAfterMs: result.retryAfterMs,
          random: this.random,
        });
        await this.completeAndNotify({
          ...completionBase,
          deliveryStatus: 'retrying',
          retryDelayMs: delayMs,
          suspendImmediately: false,
        });
        return;
      }

      await this.completeAndNotify({
        ...completionBase,
        deliveryStatus: 'dead',
        suspendImmediately: result.statusCode === 410,
      });
      return;
    }

    const canRetry =
      result.retryable &&
      prepared.attemptNumber < OUTBOUND_WEBHOOK_MAX_ATTEMPTS;
    const affectsEndpointHealth = !INTERNAL_HTTP_FAILURE_CODES.has(result.code);
    const attemptOutcome: OutboundWebhookAttemptOutcome = result.isTimeout
      ? 'timeout'
      : affectsEndpointHealth
        ? 'network_error'
        : 'internal_error';
    const completionBase = buildCompletionBase({
      prepared,
      finishedAt,
      attemptOutcome,
      httpStatus: null,
      errorCode: result.code,
      errorMessage: result.message,
      responseBody: null,
      durationMs: result.durationMs,
      retryAfterMs: null,
      affectsEndpointHealth,
    });

    if (canRetry) {
      const delayMs = computeOutboundWebhookRetryDelayMs({
        attemptNumber: prepared.attemptNumber,
        retryAfterMs: null,
        random: this.random,
      });
      await this.completeAndNotify({
        ...completionBase,
        deliveryStatus: 'retrying',
        retryDelayMs: delayMs,
        suspendImmediately: false,
      });
      return;
    }

    await this.completeAndNotify({
      ...completionBase,
      deliveryStatus: 'dead',
      suspendImmediately: false,
    });
  }

  private async completeAndNotify(
    completion: CompleteOutboundWebhookAttemptInput
  ): Promise<void> {
    const result = await this.store.completeAttempt(completion);
    if (!result.suspension) {
      return;
    }

    this.logger.warn(
      {
        webhook_id: result.suspension.webhookId,
        account_id: result.suspension.accountId,
        reason: result.suspension.reason,
      },
      'Outbound webhook endpoint was automatically suspended'
    );

    if (!this.suspensionNotifier) {
      return;
    }

    try {
      await this.suspensionNotifier.notify(result.suspension);
    } catch (error: unknown) {
      this.logger.error(
        {
          webhook_id: result.suspension.webhookId,
          account_id: result.suspension.accountId,
          error: errorMessage(error),
        },
        'Outbound webhook suspension notification failed'
      );
    }
  }
}
