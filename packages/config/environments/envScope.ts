import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export type UnderchatEnvScope = 'public' | 'private';

const PUBLIC_PACKAGE_NAMES = new Set([
  'balancer',
  'worker_baileys',
  'worker_wwebjs',
  'worker_whatsmeow',
]);

const PUBLIC_APP_PATHS = [
  '/apps/balance_api',
  '/apps/worker_baileys',
  '/apps/worker_wwebjs',
  '/apps/worker_whatsmeow',
];

function normalizeScope(value: string | undefined): UnderchatEnvScope | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'public' || normalized === 'private') {
    return normalized;
  }

  throw new InvalidConfigurationError(
    `UNDERCHAT_ENV_SCOPE is invalid: ${value}.`
  );
}

function pathMatchesPublicApp(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.replaceAll('\\', '/');
  return PUBLIC_APP_PATHS.some(
    (appPath) =>
      normalized.endsWith(appPath) || normalized.includes(`${appPath}/`)
  );
}

export function resolveUnderchatEnvScope(): UnderchatEnvScope {
  const explicitScope = normalizeScope(process.env.UNDERCHAT_ENV_SCOPE);
  if (explicitScope) {
    return explicitScope;
  }

  const packageName = process.env.npm_package_name?.trim();
  if (packageName && PUBLIC_PACKAGE_NAMES.has(packageName)) {
    return 'public';
  }

  const candidatePaths = [
    process.cwd(),
    process.env.PWD,
    process.env.INIT_CWD,
    process.argv[1],
  ];

  if (candidatePaths.some(pathMatchesPublicApp)) {
    return 'public';
  }

  return 'private';
}

function readNonEmptyEnv(key: string | undefined): string | undefined {
  if (!key) {
    return undefined;
  }

  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value;
}

export interface ScopedEnvValueOptions {
  publicKey: string;
  privateKey: string;
  legacyKey?: string;
  fallback?: string;
}

export function resolveScopedEnvValue(
  options: ScopedEnvValueOptions
): string | undefined {
  const scope = resolveUnderchatEnvScope();
  const scopedKey = scope === 'public' ? options.publicKey : options.privateKey;

  return (
    readNonEmptyEnv(scopedKey) ??
    readNonEmptyEnv(options.legacyKey) ??
    options.fallback
  );
}
