export type WorkerContainerEnvironmentKeyClassification =
  | 'forced_or_injected'
  | 'image_or_system'
  | 'inherited'
  | 'intentionally_denied'
  | 'override';

export const WORKER_INHERITED_ENV_KEYS: ReadonlySet<string> = new Set([
  'APP_ENVIRONMENT',
  'APP_TIMEZONE',
  'APP_URL_BALANCER',
  'APP_URL_MANAGER',
  'APP_URL_PUBLIC',
  'APP_URL_SCHEDULE',
  'APP_URL_SERVICE',
  'BALANCER_GRPC_HOST',
  'BALANCER_GRPC_PORT',
  'CENTRIFUGO_HMAC_SECRET_KEY',
  'CENTRIFUGO_HTTP_API_KEY',
  'CENTRIFUGO_HTTP_API_URL',
  'CENTRIFUGO_PUBLIC_HTTP_API_URL',
  'CENTRIFUGO_PUBLIC_WS_URL',
  'CENTRIFUGO_WS_URL',
  'CRITICAL_REDIS_OPERATION_TIMEOUT_MS',
  'DB_CACHE_HOST',
  'DB_CACHE_PASSWORD',
  'DB_CACHE_PORT',
  'DB_CACHE_PUBLIC_HOST',
  'DB_CACHE_PUBLIC_PORT',
  'DB_ELASTIC_HOST',
  'DB_ELASTIC_PASSWORD',
  'DB_ELASTIC_PUBLIC_HOST',
  'DB_ELASTIC_USER',
  'IP_LATENCY_DNS_IP',
  'KAFKA_ALLOW_PLAINTEXT',
  'KAFKA_BROKER',
  'KAFKA_PASSWORD',
  'KAFKA_PUBLIC_BROKER',
  'KAFKA_PUBLIC_PASSWORD',
  'KAFKA_PUBLIC_SASL_MECHANISM',
  'KAFKA_PUBLIC_SECURITY_PROTOCOL',
  'KAFKA_PUBLIC_USERNAME',
  'KAFKA_SSL_CA_LOCATION',
  'KAFKA_TOPIC_METADATA_PROPAGATION_MAX_MS',
  'KAFKA_USERNAME',
  'LOG_LEVEL',
  'MEDIA_DOWNLOAD_MAX_BYTES',
  'MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS',
  'NATS_CONNECTION_NAME',
  'NATS_PASSWORD',
  'NATS_PUBLIC_URL',
  'NATS_TLS',
  'NATS_URL',
  'NATS_USER',
  'SASL_MECHANISM',
  'SCHEDULE_STATUS_RECONCILIATION_LEASE_TTL_MS',
  'SECURITY_PROTOCOL',
  'UPLOAD_LIMIT_IN_BYTES',
  'USE_DISTRIBUTED_CENTRIFUGO',
  'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS',
  'WHATSAPP_SESSION_DEBUG_ENABLED',
  'WORKER_BAILEYS_GRPC_PORT',
  'WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS',
  'WORKER_DATA_DIR',
  'WORKER_HTTP_PORT',
  'WORKER_NODE_SHUTDOWN_TIMEOUT_MS',
  'WORKER_DATABASE_OUTAGE_GRACE_MS',
  'WORKER_PROVIDER_SEND_MAX_IN_FLIGHT',
  'WORKER_TYPING_MAX_ORPHANS',
  'WORKER_WHATSMEOW_GRPC_PORT',
  'WORKER_WWEBJS_GRPC_PORT',
]);

export const WORKER_INHERITED_ENV_PREFIXES = [
  'AUTOMATION_',
  'BAILEYS_',
  'CONNECTION_',
  'CRYPTO_',
  'HISTORY_RECONCILIATION_',
  'INBOUND_MESSAGE_SPOOL_',
  'KAFKA_CONSUMER_',
  'KAFKA_METADATA_',
  'LID_JID_CACHE_',
  'MESSAGE_',
  'OUTBOUND_WEBHOOK_',
  'PLAN_ENTITLEMENT_',
  'PROXY_',
  'S3_',
  'SCHEDULE_LEGACY_PROCESSING_',
  'SCHEDULE_MESSAGE_',
  'SECURE_CONNECTION_',
  'TYPING_SIMULATION_',
  'WHATSAPP_RUNTIME_',
  'WHATS_MEOW_',
  'WORKER_CONNECTION_',
  'WORKER_DAILY_MAINTENANCE_',
  'WORKER_KAFKA_',
  'WORKER_OUTBOUND_',
  'WORKER_SELF_HEAL_',
  'WORKER_SELF_MONITOR_',
  'WORKER_SEND_',
  'WORKER_WHATSAPP_',
  'WWEBJS_',
] as const;

export const WORKER_FORBIDDEN_ENV_PREFIXES = [
  'KAFKA_CLEANER_',
  'KAFKA_FINALIZER_',
  'KAFKA_PROVISIONER_',
  'KAFKA_RESOURCE_DELETION_',
  'KAFKA_WORKER_TOPIC_',
  'WORKER_DELETION_PROOF_',
] as const;

export const WORKER_OVERRIDE_ENV_KEYS: ReadonlySet<string> = new Set([
  'ACCOUNT_ID',
  'BALANCER_GRPC_HOST',
  'BALANCER_GRPC_PORT',
  'LEGACY_SESSION_CHECKSUM_SHA256',
  'LEGACY_SESSION_VOLUME_NAME',
  'PGTZ',
  'PROXY_HOST',
  'PROXY_PASSWORD',
  'PROXY_PORT',
  'PROXY_PROTOCOL',
  'PROXY_USERNAME',
  'RUNTIME_GENERATION',
  'SESSION_STORAGE_MIGRATION_ID',
  'SESSION_VOLUME_NAME',
  'TZ',
  'WARM_POOL_ID',
  'WARM_STANDBY',
  'WORKER_GRPC_PORT',
  'WORKER_ID',
  'WORKER_IMAGE',
  'WORKER_TYPE_ID',
  'WORKER_RUNTIME_CAPABILITY',
  'WORKER_SESSION_STORAGE',
  'WORKER_WRITER_EPOCH',
]);

export const WORKER_FORCED_OR_INJECTED_ENV_KEYS: ReadonlySet<string> = new Set([
  'BALANCER_GRPC_RUNTIME_FENCE_TOKEN',
  'NODE_ENV',
  'PGTZ',
  'TZ',
  'UNDERCHAT_ENV_SCOPE',
  'WORKER_DATABASE_URL',
]);

export const WORKER_IMAGE_OR_SYSTEM_ENV_KEYS: ReadonlySet<string> = new Set([
  'HOSTNAME',
  'INIT_CWD',
  'PUPPETEER_EXECUTABLE_PATH',
  'PWD',
  'npm_package_name',
]);

export interface WorkerContainerDatabaseConfiguration {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: string;
}

/**
 * Builds the worker-only PostgreSQL DSN from the already scoped, discrete
 * database configuration. Composite DB_*_DATABASE_URL values deliberately do
 * not participate in this boundary.
 */
export function buildWorkerContainerDatabaseUrl(
  configuration: WorkerContainerDatabaseConfiguration
): string {
  const host = configuration.host.trim();
  const user = configuration.user.trim();
  const database = configuration.database.trim();
  const sslMode = configuration.sslMode.trim();
  if (
    !host ||
    !user ||
    !configuration.password ||
    !database ||
    !sslMode ||
    !Number.isInteger(configuration.port) ||
    configuration.port < 1 ||
    configuration.port > 65_535
  ) {
    throw new Error('worker_database_configuration_invalid');
  }

  const normalizedHost =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const url = new URL(
    `postgresql://${normalizedHost}:${configuration.port.toString()}`
  );
  url.username = user;
  url.password = configuration.password;
  url.pathname = `/${encodeURIComponent(database)}`;
  url.searchParams.set('sslmode', sslMode);

  return url.toString();
}

/*
 * These keys are present in shared source modules reached by a worker build,
 * but are deliberately not part of the worker runtime contract. Keep this
 * list exact: a new source-only key must be reviewed instead of being silently
 * admitted by a broad prefix.
 */
export const WORKER_INTENTIONALLY_DENIED_ENV_KEYS: ReadonlySet<string> =
  new Set([
    'CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP',
    'GIT_BRANCH',
    'GIT_REPO',
    'GIT_TOKEN',
    'JWT_SECRET',
    'JWT_SECRET_EXPIRES_IN',
    'NATS_CREDS_BASE64',
    'NATS_TOKEN',
    'PUBLIC_API_RATE_LIMIT_PER_MINUTE',
    /*
     * Only the five canonical PROXY_* connection fields below may enter a
     * worker, and only through WorkerService's explicit proxy override. These
     * common aliases must not slip through the broad PROXY_ tuning prefix:
     * third-party clients may interpret them even though UnderChat does not.
     */
    'PROXY_ADDRESS',
    'PROXY_AUTH',
    'PROXY_PASS',
    'PROXY_SERVER',
    'PROXY_URI',
    'PROXY_URL',
    'PROXY_USER',
    'SERVER_ID',
    'SERVICE_API_KAFKA_BOOTSTRAP_CUTOVER_ENABLED',
    'SERVICE_API_KAFKA_CUTOVER_EMPTY_STABILITY_MS',
    'SERVICE_API_KAFKA_CUTOVER_LOCK_LEASE_MS',
    'SERVICE_API_KAFKA_CUTOVER_POLL_MS',
    'SERVICE_API_KAFKA_CUTOVER_TOKEN',
    'SERVICE_API_KAFKA_MAX_IN_FLIGHT_PER_PARTITION',
    'SERVICE_API_KAFKA_MAX_IN_FLIGHT_TOTAL',
    'WORKER_DB_PASSWORD',
    'WORKER_DB_USER',
    'WORKER_SERVICE_API_INTERNAL_URL',
  ]);

function isPrivateEnvironmentKey(key: string): boolean {
  return /(^|_)PRIVATE(_|$)/u.test(key);
}

function hasPrefix(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix));
}

export function isInheritedWorkerEnvironmentKeyAllowed(key: string): boolean {
  if (
    isPrivateEnvironmentKey(key) ||
    hasPrefix(key, WORKER_FORBIDDEN_ENV_PREFIXES) ||
    WORKER_INTENTIONALLY_DENIED_ENV_KEYS.has(key) ||
    WORKER_OVERRIDE_ENV_KEYS.has(key)
  ) {
    return false;
  }

  return (
    WORKER_INHERITED_ENV_KEYS.has(key) ||
    hasPrefix(key, WORKER_INHERITED_ENV_PREFIXES)
  );
}

export function classifyWorkerContainerEnvironmentKey(
  key: string
): WorkerContainerEnvironmentKeyClassification | null {
  if (
    isPrivateEnvironmentKey(key) ||
    hasPrefix(key, WORKER_FORBIDDEN_ENV_PREFIXES) ||
    WORKER_INTENTIONALLY_DENIED_ENV_KEYS.has(key)
  ) {
    return 'intentionally_denied';
  }
  if (WORKER_FORCED_OR_INJECTED_ENV_KEYS.has(key)) {
    return 'forced_or_injected';
  }
  if (WORKER_OVERRIDE_ENV_KEYS.has(key)) {
    return 'override';
  }
  if (isInheritedWorkerEnvironmentKeyAllowed(key)) {
    return 'inherited';
  }
  if (WORKER_IMAGE_OR_SYSTEM_ENV_KEYS.has(key)) {
    return 'image_or_system';
  }

  return null;
}
