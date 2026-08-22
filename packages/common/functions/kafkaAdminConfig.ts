import type { KafkaConfig } from 'kafkajs';
import { readFileSync } from 'node:fs';
import { kafkaEnvironment } from '@core/config/environments';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import {
  normalizeKafkaSecurityProtocol,
  resolveKafkaSecurityConfig,
} from './kafkaSecurityConfig';

export type KafkaAdminPurpose = 'provisioner' | 'finalizer';

interface KafkaCredentials {
  username?: string;
  password?: string;
  saslMechanism?: string;
}

export function buildKafkaJsTlsConfig(
  caLocation?: string,
  loadCa: (path: string) => string = (path) => readFileSync(path, 'utf8')
): NonNullable<KafkaConfig['ssl']> {
  const normalizedLocation = caLocation?.trim();
  if (!normalizedLocation || normalizedLocation === 'probe') {
    return {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    };
  }

  let ca: string;
  try {
    ca = loadCa(normalizedLocation);
  } catch (error) {
    throw new InvalidConfigurationError(
      `Kafka CA file could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!ca.trim()) {
    throw new InvalidConfigurationError('Kafka CA file is empty.');
  }
  return {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ca: [ca],
  };
}

function roleConfig(purpose: KafkaAdminPurpose): KafkaCredentials & {
  enabled: boolean;
} {
  return purpose === 'provisioner'
    ? {
        enabled: kafkaEnvironment.provisionerOperationsEnabled,
        username: kafkaEnvironment.provisionerUsername,
        password: kafkaEnvironment.provisionerPassword,
        saslMechanism: kafkaEnvironment.provisionerSaslMechanism,
      }
    : {
        enabled: kafkaEnvironment.finalizerOperationsEnabled,
        username: kafkaEnvironment.finalizerUsername,
        password: kafkaEnvironment.finalizerPassword,
        saslMechanism: kafkaEnvironment.finalizerSaslMechanism,
      };
}

function assertAdminOperationsEnabled(purpose: KafkaAdminPurpose): void {
  if (!roleConfig(purpose).enabled) {
    throw new InvalidConfigurationError(
      `Kafka ${purpose} operations require KAFKA_${purpose.toUpperCase()}_OPERATIONS_ENABLED=true.`
    );
  }
}

function buildKafkaJsConfig(
  brokers: string[],
  clientId: string,
  credentials: KafkaCredentials
): KafkaConfig {
  const protocol = normalizeKafkaSecurityProtocol(
    kafkaEnvironment.securityProtocol
  );
  const usesSasl = protocol === 'sasl_plaintext' || protocol === 'sasl_ssl';
  const mechanism = credentials.saslMechanism?.toLowerCase();
  const username = credentials.username;
  const password = credentials.password;

  resolveKafkaSecurityConfig({
    protocol,
    saslMechanism: credentials.saslMechanism,
    username,
    password,
    caLocation: kafkaEnvironment.sslCaLocation,
  });

  return {
    clientId,
    brokers,
    ssl:
      protocol === 'ssl' || protocol === 'sasl_ssl'
        ? buildKafkaJsTlsConfig(kafkaEnvironment.sslCaLocation)
        : undefined,
    sasl: usesSasl
      ? ({
          mechanism,
          username,
          password,
        } as KafkaConfig['sasl'])
      : undefined,
  };
}

export function buildKafkaJsRuntimeConfig(
  brokers: string[],
  clientId: string
): KafkaConfig {
  return buildKafkaJsConfig(brokers, clientId, {
    username: kafkaEnvironment.kafkaUsername,
    password: kafkaEnvironment.kafkaPassword,
    saslMechanism: kafkaEnvironment.saslMechanism,
  });
}

export function buildNodeKafkaAdminConfig(
  broker: string,
  clientId: string,
  purpose: KafkaAdminPurpose
): Record<string, string | boolean> {
  assertAdminOperationsEnabled(purpose);
  const role = roleConfig(purpose);
  return {
    'client.id': clientId,
    'metadata.broker.list': broker,
    ...resolveKafkaSecurityConfig({
      protocol: kafkaEnvironment.securityProtocol,
      saslMechanism: role.saslMechanism,
      username: role.username,
      password: role.password,
      caLocation: kafkaEnvironment.sslCaLocation,
    }),
  };
}

export function buildKafkaJsAdminConfig(
  brokers: string[],
  clientId: string,
  purpose: KafkaAdminPurpose
): KafkaConfig {
  assertAdminOperationsEnabled(purpose);
  return buildKafkaJsConfig(brokers, clientId, roleConfig(purpose));
}
