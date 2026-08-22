import { spawn } from 'node:child_process';
import path from 'node:path';
import * as dotenv from 'dotenv';

const ATLAS_TARGET_DATABASE_URL_ENV = 'ATLAS_TARGET_DATABASE_URL';

const SSL_MODE_ALIASES: Readonly<Record<string, string>> = {
  true: 'require',
  '1': 'require',
  yes: 'require',
  false: 'disable',
  '0': 'disable',
  no: 'disable',
};

const SSL_MODE_VALUES = new Set([
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
  'no-verify',
]);

export interface AtlasMigrationConfiguration {
  atlasEnvironment: string;
  targetDatabaseUrl: string;
}

export interface AtlasMigrationOptions {
  checkOnly: boolean;
  execOrder?: 'non-linear';
}

export interface AtlasCommandInvocation {
  command: 'atlas';
  args: string[];
  environment: NodeJS.ProcessEnv;
  stage: 'apply' | 'hash';
}

export type AtlasCommandRunner = (
  invocation: AtlasCommandInvocation
) => Promise<void>;

function readNonEmptyEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  key: string
): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

function requireEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  key: string
): string {
  const value = readNonEmptyEnvironmentValue(environment, key);
  if (!value) {
    throw new Error(`atlas_database_configuration_missing:${key}`);
  }
  return value;
}

function resolvePublicThenLegacyEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  publicKey: string,
  legacyKey: string
): string {
  const value =
    readNonEmptyEnvironmentValue(environment, publicKey) ??
    readNonEmptyEnvironmentValue(environment, legacyKey);
  if (!value) {
    throw new Error(
      `atlas_database_configuration_missing:${publicKey}|${legacyKey}`
    );
  }
  return value;
}

function resolveKubernetesDirectDatabaseEndpoint(
  environment: NodeJS.ProcessEnv
): { host: string; port: number } | undefined {
  if (!readNonEmptyEnvironmentValue(environment, 'KUBERNETES_SERVICE_HOST')) {
    return undefined;
  }

  const rawUrl = readNonEmptyEnvironmentValue(
    environment,
    'DB_PRIVATE_DATABASE_URL'
  );
  if (!rawUrl) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      'atlas_database_configuration_invalid:DB_PRIVATE_DATABASE_URL'
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(
      'atlas_database_configuration_invalid:DB_PRIVATE_DATABASE_URL'
    );
  }

  const host = url.hostname;
  const port = Number(url.port || '5432');
  if (
    !host ||
    host.toLowerCase().includes('pooler') ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      'atlas_database_configuration_invalid:DB_PRIVATE_DATABASE_URL'
    );
  }

  return { host, port };
}

function normalizeSslMode(rawMode: string): string {
  const normalized = rawMode.trim().toLowerCase();
  const aliased = SSL_MODE_ALIASES[normalized] ?? normalized;
  if (!SSL_MODE_VALUES.has(aliased)) {
    throw new Error('atlas_database_configuration_invalid:DB_SSLMODE');
  }
  return aliased;
}

function buildTargetDatabaseUrl(input: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: string;
}): string {
  const normalizedHost =
    input.host.includes(':') && !input.host.startsWith('[')
      ? `[${input.host}]`
      : input.host;
  const url = new URL(`postgresql://${normalizedHost}:${input.port}`);
  url.username = input.user;
  url.password = input.password;
  url.pathname = `/${encodeURIComponent(input.database)}`;
  url.searchParams.set('search_path', 'public');
  url.searchParams.set('sslmode', input.sslMode);
  return url.toString();
}

export function resolveAtlasMigrationConfiguration(
  environment: NodeJS.ProcessEnv
): AtlasMigrationConfiguration {
  const atlasEnvironment = requireEnvironmentValue(environment, 'ENV');
  requireEnvironmentValue(environment, 'DB_ATLAS');
  const directEndpoint = resolveKubernetesDirectDatabaseEndpoint(environment);
  const host =
    directEndpoint?.host ??
    resolvePublicThenLegacyEnvironmentValue(
      environment,
      'DB_PUBLIC_HOST_RW',
      'DB_HOST_RW'
    );
  const port =
    directEndpoint?.port ??
    Number(
      resolvePublicThenLegacyEnvironmentValue(
        environment,
        'DB_PUBLIC_PORT_RW',
        'DB_PORT_RW'
      )
    );
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      'atlas_database_configuration_invalid:DB_PUBLIC_PORT_RW|DB_PORT_RW'
    );
  }

  const user = requireEnvironmentValue(environment, 'DB_USER');
  const password = requireEnvironmentValue(environment, 'DB_PASSWORD');
  const database = requireEnvironmentValue(environment, 'DB_DATABASE');
  const sslMode = normalizeSslMode(
    requireEnvironmentValue(environment, 'DB_SSLMODE')
  );

  return {
    atlasEnvironment,
    targetDatabaseUrl: buildTargetDatabaseUrl({
      host,
      port,
      user,
      password,
      database,
      sslMode,
    }),
  };
}

export function parseAtlasMigrationOptions(
  args: readonly string[]
): AtlasMigrationOptions {
  const options: AtlasMigrationOptions = { checkOnly: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') {
      options.checkOnly = true;
      continue;
    }
    if (argument === '--exec-order' && args[index + 1] === 'non-linear') {
      options.execOrder = 'non-linear';
      index += 1;
      continue;
    }
    throw new Error('atlas_migration_argument_invalid');
  }

  return options;
}

function atlasChildEnvironment(
  environment: NodeJS.ProcessEnv,
  targetDatabaseUrl: string
): NodeJS.ProcessEnv {
  return {
    ...environment,
    [ATLAS_TARGET_DATABASE_URL_ENV]: targetDatabaseUrl,
  };
}

export async function executeAtlasMigration(
  configuration: AtlasMigrationConfiguration,
  options: AtlasMigrationOptions,
  environment: NodeJS.ProcessEnv,
  runner: AtlasCommandRunner = runAtlasCommand
): Promise<void> {
  if (options.checkOnly) {
    return;
  }

  const commonArgs = ['--env', configuration.atlasEnvironment];
  const childEnvironment = atlasChildEnvironment(
    environment,
    configuration.targetDatabaseUrl
  );
  await runner({
    command: 'atlas',
    args: ['migrate', 'hash', ...commonArgs],
    environment: childEnvironment,
    stage: 'hash',
  });

  const applyArgs = ['migrate', 'apply'];
  if (options.execOrder) {
    applyArgs.push('--exec-order', options.execOrder);
  }
  applyArgs.push(...commonArgs);
  await runner({
    command: 'atlas',
    args: applyArgs,
    environment: childEnvironment,
    stage: 'apply',
  });
}

async function runAtlasCommand(
  invocation: AtlasCommandInvocation
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const child = spawn(invocation.command, invocation.args, {
      env: invocation.environment,
      stdio: 'inherit',
    });
    child.once('error', () => {
      finish(new Error(`atlas_migration_${invocation.stage}_start_failed`));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          signal
            ? `atlas_migration_${invocation.stage}_signal`
            : `atlas_migration_${invocation.stage}_exit_${String(code)}`
        )
      );
    });
  });
}

function isDirectScriptRun(): boolean {
  const entrypoint = process.argv[1]
    ? path.normalize(path.resolve(process.argv[1]))
    : '';
  return (
    entrypoint.endsWith(path.normalize('scripts/atlas-migrate.ts')) ||
    entrypoint.endsWith(path.normalize('scripts/atlas-migrate.js'))
  );
}

async function main(): Promise<void> {
  dotenv.config({
    path: path.resolve(process.cwd(), '.env'),
    quiet: true,
  });
  const options = parseAtlasMigrationOptions(process.argv.slice(2));
  const configuration = resolveAtlasMigrationConfiguration(process.env);
  await executeAtlasMigration(configuration, options, process.env);
}

if (isDirectScriptRun()) {
  main().catch((error) => {
    const safeMessage =
      error instanceof Error ? error.message : 'atlas_migration_failed';
    console.error(safeMessage);
    process.exitCode = 1;
  });
}
