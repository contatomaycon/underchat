import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export type KafkaSecurityProtocol =
  'plaintext' | 'ssl' | 'sasl_plaintext' | 'sasl_ssl';

const KAFKA_SECURITY_PROTOCOLS = new Set<KafkaSecurityProtocol>([
  'plaintext',
  'ssl',
  'sasl_plaintext',
  'sasl_ssl',
]);
const KAFKA_SASL_MECHANISMS = new Set([
  'PLAIN',
  'SCRAM-SHA-256',
  'SCRAM-SHA-512',
]);

export interface KafkaSecurityConfigInput {
  protocol: string;
  saslMechanism?: string;
  username?: string;
  password?: string;
  caLocation?: string;
}

export function normalizeKafkaSecurityProtocol(
  value: string
): KafkaSecurityProtocol {
  const protocol = value.trim().toLowerCase();
  if (!KAFKA_SECURITY_PROTOCOLS.has(protocol as KafkaSecurityProtocol)) {
    throw new InvalidConfigurationError(
      `Unsupported Kafka security protocol: ${value}`
    );
  }
  return protocol as KafkaSecurityProtocol;
}

export function resolveKafkaSecurityConfig(
  input: KafkaSecurityConfigInput
): Record<string, string | boolean> {
  const protocol = normalizeKafkaSecurityProtocol(input.protocol);
  const config: Record<string, string | boolean> = {
    'security.protocol': protocol,
  };
  const usesSasl = protocol === 'sasl_plaintext' || protocol === 'sasl_ssl';
  if (usesSasl) {
    const mechanism = input.saslMechanism?.trim().toUpperCase();
    const username = input.username?.trim();
    const password = input.password;
    if (
      !mechanism ||
      !KAFKA_SASL_MECHANISMS.has(mechanism) ||
      !username ||
      !password
    ) {
      throw new InvalidConfigurationError(
        'Kafka SASL requires a supported mechanism and complete credentials.'
      );
    }
    config['sasl.mechanism'] = mechanism;
    config['sasl.username'] = username;
    config['sasl.password'] = password;
  } else if (
    input.saslMechanism?.trim() ||
    input.username?.trim() ||
    input.password
  ) {
    throw new InvalidConfigurationError(
      `Kafka protocol ${protocol} must not include SASL credentials.`
    );
  }

  if (protocol === 'ssl' || protocol === 'sasl_ssl') {
    config['enable.ssl.certificate.verification'] = true;
    config['ssl.endpoint.identification.algorithm'] = 'https';
    /*
     * Do not add `ssl.min.version` here. This object is consumed by
     * node-rdkafka and its native configuration registry rejects unknown
     * properties synchronously, before it can connect to Kafka. The bundled
     * registry does not expose that property. KafkaJS enforces TLS 1.2
     * independently through buildKafkaJsTlsConfig().
     */
    config['ssl.ca.location'] = input.caLocation?.trim() || 'probe';
  }
  return config;
}
