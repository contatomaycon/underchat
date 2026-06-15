import { escapeShellSingleQuotes } from './escapeShellSingleQuotes';

export const appEnvVarsToRemove = [
  'ATLAS_PRODUCTION_SERVICE_PORT',
  'ATLAS_PRODUCTION_SERVICE_PORT_80_TCP',
  'ATLAS_PRODUCTION_SERVICE_PORT_80_TCP_ADDR',
  'ATLAS_PRODUCTION_SERVICE_PORT_80_TCP_PORT',
  'ATLAS_PRODUCTION_SERVICE_PORT_80_TCP_PROTO',
  'ATLAS_PRODUCTION_SERVICE_SERVICE_HOST',
  'ATLAS_PRODUCTION_SERVICE_SERVICE_PORT',
  'ATLAS_PRODUCTION_SERVICE_SERVICE_PORT_APP',
  'CHROME_BIN',
  'CHROME_CRASHPAD_DATABASE_PATH',
  'CHROME_PATH',
  'CONFIG_HASH',
  'CRASH_REPORTER_DISABLE',
  'DEVTRON_APP_NAME',
  'DEVTRON_CONTAINER_REPO',
  'DEVTRON_CONTAINER_TAG',
  'DEVTRON_TOKEN',
  'HOSTNAME',
  'HOME',
  'KUBERNETES_PORT',
  'KUBERNETES_PORT_443_TCP',
  'KUBERNETES_PORT_443_TCP_ADDR',
  'KUBERNETES_PORT_443_TCP_PORT',
  'KUBERNETES_PORT_443_TCP_PROTO',
  'KUBERNETES_SERVICE_HOST',
  'KUBERNETES_SERVICE_PORT',
  'KUBERNETES_SERVICE_PORT_HTTPS',
  'MANAGER_PRODUCTION_SERVICE_PORT',
  'MANAGER_PRODUCTION_SERVICE_PORT_80_TCP',
  'MANAGER_PRODUCTION_SERVICE_PORT_80_TCP_ADDR',
  'MANAGER_PRODUCTION_SERVICE_PORT_80_TCP_PORT',
  'MANAGER_PRODUCTION_SERVICE_PORT_80_TCP_PROTO',
  'MANAGER_PRODUCTION_SERVICE_SERVICE_HOST',
  'MANAGER_PRODUCTION_SERVICE_SERVICE_PORT',
  'MANAGER_PRODUCTION_SERVICE_SERVICE_PORT_APP',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'POD_NAME',
  'PUBLIC_PRODUCTION_SERVICE_PORT',
  'PUBLIC_PRODUCTION_SERVICE_PORT_80_TCP',
  'PUBLIC_PRODUCTION_SERVICE_PORT_80_TCP_ADDR',
  'PUBLIC_PRODUCTION_SERVICE_PORT_80_TCP_PORT',
  'PUBLIC_PRODUCTION_SERVICE_PORT_80_TCP_PROTO',
  'PUBLIC_PRODUCTION_SERVICE_SERVICE_HOST',
  'PUBLIC_PRODUCTION_SERVICE_SERVICE_PORT',
  'PUBLIC_PRODUCTION_SERVICE_SERVICE_PORT_APP',
  'PUPPETEER_EXECUTABLE_PATH',
  'PUPPETEER_SKIP_CHROMIUM_DOWNLOAD',
  'PUPPETEER_USER_DATA_DIR',
  'PWD',
  'S3_BUCKET_PREFIX_BACKUP',
  'SCHEDULE_PRODUCTION_SERVICE_PORT',
  'SCHEDULE_PRODUCTION_SERVICE_PORT_80_TCP',
  'SCHEDULE_PRODUCTION_SERVICE_PORT_80_TCP_ADDR',
  'SCHEDULE_PRODUCTION_SERVICE_PORT_80_TCP_PORT',
  'SCHEDULE_PRODUCTION_SERVICE_PORT_80_TCP_PROTO',
  'SCHEDULE_PRODUCTION_SERVICE_SERVICE_HOST',
  'SCHEDULE_PRODUCTION_SERVICE_SERVICE_PORT',
  'SCHEDULE_PRODUCTION_SERVICE_SERVICE_PORT_APP',
  'SECRET_HASH',
  'SERVICE_PRODUCTION_SERVICE_PORT',
  'SERVICE_PRODUCTION_SERVICE_PORT_80_TCP',
  'SERVICE_PRODUCTION_SERVICE_PORT_80_TCP_ADDR',
  'SERVICE_PRODUCTION_SERVICE_PORT_80_TCP_PORT',
  'SERVICE_PRODUCTION_SERVICE_PORT_80_TCP_PROTO',
  'SERVICE_PRODUCTION_SERVICE_SERVICE_HOST',
  'SERVICE_PRODUCTION_SERVICE_SERVICE_PORT',
  'SERVICE_PRODUCTION_SERVICE_SERVICE_PORT_APP',
  'TMPDIR',
  'TZ',
  'VIPSHOME',
  'WEB_PRODUCTION_SERVICE_PORT',
  'WEB_PRODUCTION_SERVICE_PORT_80_TCP',
  'WEB_PRODUCTION_SERVICE_PORT_80_TCP_ADDR',
  'WEB_PRODUCTION_SERVICE_PORT_80_TCP_PORT',
  'WEB_PRODUCTION_SERVICE_PORT_80_TCP_PROTO',
  'WEB_PRODUCTION_SERVICE_SERVICE_HOST',
  'WEB_PRODUCTION_SERVICE_SERVICE_PORT',
  'WEB_PRODUCTION_SERVICE_SERVICE_PORT_APP',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
] as const;

export const externalAppEnvPublicPromotions = [
  ['DB_PUBLIC_HOST_RW', 'DB_HOST_RW'],
  ['DB_PUBLIC_PORT_RW', 'DB_PORT_RW'],
  ['DB_PUBLIC_HOST_RO', 'DB_HOST_RO'],
  ['DB_PUBLIC_PORT_RO', 'DB_PORT_RO'],
  ['DB_PUBLIC_DATABASE_URL', 'DB_DATABASE_URL'],
  ['DB_PUBLIC_ATLAS', 'DB_ATLAS'],
  ['DB_ELASTIC_PUBLIC_HOST', 'DB_ELASTIC_HOST'],
  ['DB_CACHE_PUBLIC_HOST', 'DB_CACHE_HOST'],
  ['DB_CACHE_PUBLIC_PORT', 'DB_CACHE_PORT'],
  ['CENTRIFUGO_PUBLIC_WS_URL', 'CENTRIFUGO_WS_URL'],
  ['CENTRIFUGO_PUBLIC_HTTP_API_URL', 'CENTRIFUGO_HTTP_API_URL'],
  ['KAFKA_PUBLIC_BROKER', 'KAFKA_BROKER'],
  ['KAFKA_PUBLIC_SECURITY_PROTOCOL', 'SECURITY_PROTOCOL'],
  ['KAFKA_PUBLIC_USERNAME', 'KAFKA_USERNAME'],
  ['KAFKA_PUBLIC_PASSWORD', 'KAFKA_PASSWORD'],
  ['KAFKA_PUBLIC_SASL_MECHANISM', 'SASL_MECHANISM'],
] as const;

export const externalAppPrivateScopedEnvVarsToRemove = [
  'DB_PRIVATE_HOST_RW',
  'DB_PRIVATE_PORT_RW',
  'DB_PRIVATE_HOST_RO',
  'DB_PRIVATE_PORT_RO',
  'DB_PRIVATE_DATABASE_URL',
  'DB_PRIVATE_ATLAS',
  'DB_ELASTIC_PRIVATE_HOST',
  'DB_CACHE_PRIVATE_HOST',
  'DB_CACHE_PRIVATE_PORT',
  'CENTRIFUGO_PRIVATE_WS_URL',
  'CENTRIFUGO_PRIVATE_HTTP_API_URL',
  'KAFKA_PRIVATE_BROKER',
  'KAFKA_PRIVATE_SECURITY_PROTOCOL',
  'KAFKA_PRIVATE_USERNAME',
  'KAFKA_PRIVATE_PASSWORD',
  'KAFKA_PRIVATE_SASL_MECHANISM',
] as const;

function escapeForSedPattern(value: string): string {
  return value.replaceAll(/[[\]{}()*+?.\\^$|/]/g, String.raw`\$&`);
}

export function getRemoveEnvVarsFromFileCommand(
  envFilePath: string,
  envVars: readonly string[] = appEnvVarsToRemove
): string {
  if (envVars.length === 0) {
    return ':';
  }

  const escapedPath = escapeShellSingleQuotes(envFilePath);
  const deleteExpressions = envVars
    .map((envVar) => `-e '/^${escapeForSedPattern(envVar)}=/d'`)
    .join(' ');

  return `sed -i ${deleteExpressions} '${escapedPath}'`;
}

export function getUpsertEnvVarInFileCommand(
  envFilePath: string,
  key: string,
  value: string
): string {
  if (!key) {
    return ':';
  }

  const escapedPath = escapeShellSingleQuotes(envFilePath);
  const escapedKeyPattern = escapeForSedPattern(key);
  const escapedKeyValue = escapeShellSingleQuotes(`${key}=${value}`);

  return `sed -i -e '/^${escapedKeyPattern}=/d' '${escapedPath}' && printf '%s\\n' '${escapedKeyValue}' >> '${escapedPath}'`;
}

export function getPrepareExternalAppEnvFileCommand(
  envFilePath: string
): string {
  const escapedPath = escapeShellSingleQuotes(envFilePath);
  const promotionCommands = externalAppEnvPublicPromotions
    .map(([source, target]) => `promote_env '${source}' '${target}'`)
    .join('\n');
  const privateDeleteExpressions = externalAppPrivateScopedEnvVarsToRemove
    .map((envVar) => `-e '/^${escapeForSedPattern(envVar)}=/d'`)
    .join(' ');

  const script = `set -e
ENV_FILE='${escapedPath}'
promote_env() {
  SOURCE="$1"
  TARGET="$2"
  VALUE=$(awk -F= -v key="$SOURCE" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { if (value != "") print value }' "$ENV_FILE")
  if [ -n "$VALUE" ]; then
    sed -i -e "/^$TARGET=/d" "$ENV_FILE"
    printf '%s=%s\\n' "$TARGET" "$VALUE" >> "$ENV_FILE"
  fi
}
${promotionCommands}
sed -i ${privateDeleteExpressions} -e '/^UNDERCHAT_ENV_SCOPE=/d' "$ENV_FILE"
printf '%s\\n' 'UNDERCHAT_ENV_SCOPE=public' >> "$ENV_FILE"`;

  return `bash -c '${escapeShellSingleQuotes(script)}'`;
}
