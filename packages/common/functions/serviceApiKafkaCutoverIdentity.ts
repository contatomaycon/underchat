import { createHash } from 'node:crypto';

const SERVICE_API_CONSUMER_GENERATION_SEPARATOR = '--';
const SERVICE_API_CONSUMER_GENERATION_PREFIX = 'ucg-';
const UNRESOLVED_CUTOVER_TOKEN = 'DEVTRON_SECRET_REQUIRED';

export function serviceApiKafkaCutoverGenerationMarker(token: string): string {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    throw new Error('Kafka cutover token must not be empty');
  }

  return `${SERVICE_API_CONSUMER_GENERATION_PREFIX}${createHash('sha256')
    .update(normalizedToken)
    .digest('hex')
    .slice(0, 24)}`;
}

export function buildServiceApiKafkaConsumerClientId(
  baseClientId: string,
  token: string | undefined
): string {
  const normalizedBaseClientId = baseClientId.trim();
  const normalizedToken = token?.trim();
  if (!normalizedToken) {
    return normalizedBaseClientId;
  }

  return `${normalizedBaseClientId}${SERVICE_API_CONSUMER_GENERATION_SEPARATOR}${serviceApiKafkaCutoverGenerationMarker(
    normalizedToken
  )}`;
}

export function resolveServiceApiKafkaCutoverToken(options: {
  token?: string;
  nodeEnvironment?: string;
  bootstrapCutoverEnabled: boolean;
}): string {
  const token = options.token?.trim() ?? '';
  const production =
    options.nodeEnvironment?.trim().toLowerCase() === 'production';

  if (
    production &&
    options.bootstrapCutoverEnabled &&
    (!token || token === UNRESOLVED_CUTOVER_TOKEN)
  ) {
    throw new Error(
      'SERVICE_API_KAFKA_CUTOVER_TOKEN is required in production while the explicit Kafka bootstrap cutover is enabled'
    );
  }

  return token;
}

/**
 * The high-watermark cutover is destructive by design and therefore requires
 * a separate, explicit switch. Merely configuring a token must never make a
 * normal deployment reposition consumer-group offsets.
 */
export function isServiceApiKafkaBootstrapCutoverEnabled(
  value: string | undefined = process.env
    .SERVICE_API_KAFKA_BOOTSTRAP_CUTOVER_ENABLED
): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

export function isServiceApiKafkaConsumerFromGeneration(
  clientId: unknown,
  generationMarker: string
): boolean {
  return (
    typeof clientId === 'string' &&
    clientId.endsWith(
      `${SERVICE_API_CONSUMER_GENERATION_SEPARATOR}${generationMarker}`
    )
  );
}
