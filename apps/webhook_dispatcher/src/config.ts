import { OUTBOUND_WEBHOOK_REQUEST_TIMEOUT_MS } from '@core/common/functions/outboundWebhookHttp';
import { readAliasedIntegerEnvironment } from '@core/common/functions/readAliasedIntegerEnvironment';

const APP_ENVIRONMENTS = ['LOCAL', 'DEV', 'HMG', 'PROD'] as const;
type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export interface WebhookDispatcherRuntimeConfig {
  readonly port: number;
  readonly concurrency: number;
  readonly leaseDurationMs: number;
  readonly pollIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly databasePoolMin: number;
  readonly databasePoolMax: number;
  readonly databasePoolIdleTimeoutMs: number;
  readonly databasePoolAcquireTimeoutMs: number;
  readonly databaseQueryTimeoutMs: number;
  readonly isProduction: boolean;
  readonly allowLocalhostHttp: boolean;
}

interface IntegerEnvironmentOptions {
  readonly key: string;
  readonly minimum: number;
  readonly maximum: number;
}

const parseInteger = (
  raw: string,
  options: IntegerEnvironmentOptions
): number => {
  const parsed = Number(raw.trim());
  if (
    raw.trim() === '' ||
    !Number.isInteger(parsed) ||
    parsed < options.minimum ||
    parsed > options.maximum
  ) {
    throw new Error(
      `${options.key} must be an integer between ${options.minimum} and ${options.maximum}`
    );
  }

  return parsed;
};

const readOptionalInteger = (
  options: IntegerEnvironmentOptions
): number | undefined => {
  const raw = process.env[options.key];
  return raw === undefined ? undefined : parseInteger(raw, options);
};

const readInteger = (
  options: IntegerEnvironmentOptions & { readonly fallback: number }
): number => readOptionalInteger(options) ?? options.fallback;

const readAppEnvironment = (): AppEnvironment => {
  const value = process.env.APP_ENVIRONMENT?.trim().toUpperCase();
  if (!value || !APP_ENVIRONMENTS.includes(value as AppEnvironment)) {
    throw new Error(
      `APP_ENVIRONMENT must be one of: ${APP_ENVIRONMENTS.join(', ')}`
    );
  }

  return value as AppEnvironment;
};

const readBoolean = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${key} must be either true or false`);
};

export const readWebhookDispatcherRuntimeConfig =
  (): WebhookDispatcherRuntimeConfig => {
    const appEnvironment = readAppEnvironment();
    const isDevelopment =
      appEnvironment === 'LOCAL' || appEnvironment === 'DEV';
    const isProduction = !isDevelopment;
    const localhostFlag = readBoolean(
      'OUTBOUND_WEBHOOK_ALLOW_LOCALHOST_HTTP',
      false
    );
    if (localhostFlag && !isDevelopment) {
      throw new Error(
        'OUTBOUND_WEBHOOK_ALLOW_LOCALHOST_HTTP may only be true in LOCAL or DEV'
      );
    }

    const port =
      readOptionalInteger({
        key: 'WEBHOOK_DISPATCHER_PORT',
        minimum: 1,
        maximum: 65_535,
      }) ??
      readOptionalInteger({ key: 'PORT', minimum: 1, maximum: 65_535 }) ??
      3007;
    const concurrency = readInteger({
      key: 'WEBHOOK_DISPATCHER_CONCURRENCY',
      fallback: 16,
      minimum: 1,
      maximum: 100,
    });
    const leaseDurationMs = readInteger({
      key: 'WEBHOOK_DISPATCHER_LEASE_DURATION_MS',
      fallback: 60_000,
      minimum: 30_000,
      maximum: 10 * 60_000,
    });
    const requestTimeoutMs = readInteger({
      key: 'WEBHOOK_DISPATCHER_REQUEST_TIMEOUT_MS',
      fallback: OUTBOUND_WEBHOOK_REQUEST_TIMEOUT_MS,
      minimum: 100,
      maximum: OUTBOUND_WEBHOOK_REQUEST_TIMEOUT_MS,
    });
    if (leaseDurationMs < requestTimeoutMs + 5_000) {
      throw new Error(
        'WEBHOOK_DISPATCHER_LEASE_DURATION_MS must exceed the request timeout by at least 5000 ms'
      );
    }

    const databasePoolMax = readInteger({
      key: 'WEBHOOK_DISPATCHER_DB_POOL_MAX',
      fallback: Math.min(32, Math.max(4, concurrency + 4)),
      minimum: 2,
      maximum: 100,
    });
    const databasePoolMin = readInteger({
      key: 'WEBHOOK_DISPATCHER_DB_POOL_MIN',
      fallback: 1,
      minimum: 0,
      maximum: databasePoolMax,
    });
    const databaseQueryTimeoutMs = readAliasedIntegerEnvironment({
      key: 'WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS',
      legacyKey: 'WEBHOOK_DISPATCHER_DB_STATEMENT_TIMEOUT_MS',
      fallback: Math.min(30_000, leaseDurationMs - 5_000),
      minimum: 1_000,
      maximum: leaseDurationMs - 5_000,
    });

    return {
      port,
      concurrency,
      leaseDurationMs,
      pollIntervalMs: readInteger({
        key: 'WEBHOOK_DISPATCHER_POLL_INTERVAL_MS',
        fallback: 1_000,
        minimum: 50,
        maximum: 60_000,
      }),
      requestTimeoutMs,
      databasePoolMin,
      databasePoolMax,
      databasePoolIdleTimeoutMs: readInteger({
        key: 'WEBHOOK_DISPATCHER_DB_POOL_IDLE_TIMEOUT_MS',
        fallback: 30_000,
        minimum: 1_000,
        maximum: 10 * 60_000,
      }),
      databasePoolAcquireTimeoutMs: readInteger({
        key: 'WEBHOOK_DISPATCHER_DB_POOL_ACQUIRE_TIMEOUT_MS',
        fallback: 5_000,
        minimum: 500,
        maximum: 60_000,
      }),
      databaseQueryTimeoutMs,
      isProduction,
      allowLocalhostHttp: localhostFlag,
    };
  };
