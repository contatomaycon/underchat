import { CacheEnvironment } from '@core/config/environments/CacheEnvironment';
import { CentrifugoEnvironment } from '@core/config/environments/CentrifugoEnvironment';
import { DatabaseEnvironment } from '@core/config/environments/DatabaseEnvironment';
import { DatabaseElasticEnvironment } from '@core/config/environments/DatabaseElasticEnvironment';
import { KafkaEnvironment } from '@core/config/environments/KafkaEnvironment';
import { resolveUnderchatEnvScope } from '@core/config/environments/envScope';
import { buildNodeKafkaAdminConfig } from '@core/common/functions/kafkaAdminConfig';

const originalEnv = process.env;

describe('environment scope resolver', () => {
  beforeEach(() => {
    process.env = {};
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to private scope', () => {
    expect(resolveUnderchatEnvScope()).toBe('private');
  });

  it('uses explicit public scope', () => {
    process.env.UNDERCHAT_ENV_SCOPE = 'public';

    expect(resolveUnderchatEnvScope()).toBe('public');
  });

  it('infers public scope for external app package names', () => {
    process.env.npm_package_name = 'worker_baileys';

    expect(resolveUnderchatEnvScope()).toBe('public');
  });

  it('rejects invalid explicit scope values', () => {
    process.env.UNDERCHAT_ENV_SCOPE = 'outside';

    expect(() => resolveUnderchatEnvScope()).toThrow(
      'UNDERCHAT_ENV_SCOPE is invalid'
    );
  });

  it('resolves Postgres endpoints from the selected scope', () => {
    process.env.UNDERCHAT_ENV_SCOPE = 'public';
    process.env.DB_PUBLIC_HOST_RW = 'public-rw';
    process.env.DB_PRIVATE_HOST_RW = 'private-rw';
    process.env.DB_PUBLIC_PORT_RW = '15432';
    process.env.DB_PRIVATE_PORT_RW = '5432';
    process.env.DB_PUBLIC_HOST_RO = 'public-ro';
    process.env.DB_PRIVATE_HOST_RO = 'private-ro';
    process.env.DB_PUBLIC_PORT_RO = '15433';
    process.env.DB_PRIVATE_PORT_RO = '5433';
    process.env.DB_PUBLIC_ATLAS = 'postgres://public-atlas';
    process.env.DB_PRIVATE_ATLAS = 'postgres://private-atlas';

    const environment = new DatabaseEnvironment();

    expect(environment.dbHostRw).toBe('public-rw');
    expect(environment.dbPortRw).toBe(15432);
    expect(environment.dbHostRo).toBe('public-ro');
    expect(environment.dbPortRo).toBe(15433);
    expect(environment.dbAtlas).toBe('postgres://public-atlas');
  });

  it('falls back to legacy Postgres envs when scoped envs are absent', () => {
    process.env.UNDERCHAT_ENV_SCOPE = 'public';
    process.env.DB_HOST_RW = 'legacy-rw';
    process.env.DB_PORT_RW = '5432';
    process.env.DB_HOST_RO = 'legacy-ro';
    process.env.DB_PORT_RO = '5433';
    process.env.DB_ATLAS = 'postgres://legacy-atlas';

    const environment = new DatabaseEnvironment();

    expect(environment.dbHostRw).toBe('legacy-rw');
    expect(environment.dbPortRw).toBe(5432);
    expect(environment.dbHostRo).toBe('legacy-ro');
    expect(environment.dbPortRo).toBe(5433);
    expect(environment.dbAtlas).toBe('postgres://legacy-atlas');
  });

  it('keeps the WhatsApp worker login separate from control-plane credentials', () => {
    process.env.DB_USER = 'control-plane-user';
    process.env.DB_PASSWORD = 'control-plane-password';
    process.env.WORKER_DB_USER = 'whatsapp-worker-user';
    process.env.WORKER_DB_PASSWORD = 'whatsapp-worker-password';

    const environment = new DatabaseEnvironment();

    expect(environment.dbUser).toBe('control-plane-user');
    expect(environment.dbPassword).toBe('control-plane-password');
    expect(environment.workerDbUser).toBe('whatsapp-worker-user');
    expect(environment.workerDbPassword).toBe('whatsapp-worker-password');
  });

  it('does not fall back to DB_USER or DB_PASSWORD for a worker login', () => {
    process.env.DB_USER = 'control-plane-user';
    process.env.DB_PASSWORD = 'control-plane-password';

    const environment = new DatabaseEnvironment();

    expect(() => environment.workerDbUser).toThrow(
      'WORKER_DB_USER is not defined.'
    );
    expect(() => environment.workerDbPassword).toThrow(
      'WORKER_DB_PASSWORD is not defined.'
    );
  });

  it('resolves Elastic, Redis, Kafka, and Centrifugo endpoints from public scope', () => {
    process.env.UNDERCHAT_ENV_SCOPE = 'public';
    process.env.DB_ELASTIC_PUBLIC_HOST = 'https://public-elastic';
    process.env.DB_ELASTIC_PRIVATE_HOST = 'https://private-elastic';
    process.env.DB_CACHE_PUBLIC_HOST = 'public-redis';
    process.env.DB_CACHE_PRIVATE_HOST = 'private-redis';
    process.env.DB_CACHE_PUBLIC_PORT = '16379';
    process.env.DB_CACHE_PRIVATE_PORT = '6379';
    process.env.KAFKA_PUBLIC_BROKER = 'public-kafka:9093';
    process.env.KAFKA_PRIVATE_BROKER = 'private-kafka:9092';
    process.env.KAFKA_PUBLIC_SECURITY_PROTOCOL = 'SASL_SSL';
    process.env.KAFKA_PRIVATE_SECURITY_PROTOCOL = 'PLAINTEXT';
    process.env.KAFKA_PUBLIC_USERNAME = 'public-user';
    process.env.KAFKA_PUBLIC_PASSWORD = 'public-pass';
    process.env.KAFKA_PUBLIC_SASL_MECHANISM = 'PLAIN';
    process.env.CENTRIFUGO_PUBLIC_WS_URL = 'wss://public-ws';
    process.env.CENTRIFUGO_PRIVATE_WS_URL = 'ws://private-ws';
    process.env.CENTRIFUGO_PUBLIC_HTTP_API_URL = 'https://public-ws/api';
    process.env.CENTRIFUGO_PRIVATE_HTTP_API_URL = 'http://private-ws/api';

    const elastic = new DatabaseElasticEnvironment();
    const cache = new CacheEnvironment();
    const kafka = new KafkaEnvironment();
    const centrifugo = new CentrifugoEnvironment();

    expect(elastic.elasticSearchHost).toBe('https://public-elastic');
    expect(cache.cacheHost).toBe('public-redis');
    expect(cache.cachePort).toBe(16379);
    expect(kafka.kafkaBroker).toBe('public-kafka:9093');
    expect(kafka.securityProtocol).toBe('sasl_ssl');
    expect(kafka.kafkaUsername).toBe('public-user');
    expect(kafka.kafkaPassword).toBe('public-pass');
    expect(kafka.saslMechanism).toBe('PLAIN');
    expect(centrifugo.centrifugoWsUrl).toBe('wss://public-ws');
    expect(centrifugo.centrifugoHttpApiUrl).toBe('https://public-ws/api');
    expect(centrifugo.centrifugoPublicWsUrl).toBe('wss://public-ws');
  });

  it('uses private Kafka plaintext without requiring scoped credentials', () => {
    process.env.KAFKA_PRIVATE_BROKER = 'private-kafka:9092';
    process.env.KAFKA_PRIVATE_SECURITY_PROTOCOL = 'PLAINTEXT';
    process.env.KAFKA_PUBLIC_USERNAME = 'public-user';
    process.env.KAFKA_PUBLIC_PASSWORD = 'public-pass';

    const kafka = new KafkaEnvironment();

    expect(kafka.kafkaBroker).toBe('private-kafka:9092');
    expect(kafka.securityProtocol).toBe('plaintext');
    expect(kafka.kafkaUsername).toBeUndefined();
    expect(kafka.kafkaPassword).toBeUndefined();
    expect(kafka.saslMechanism).toBeUndefined();
  });

  it('enables fenced Kafka administration with runtime credentials by default', () => {
    process.env.KAFKA_PRIVATE_BROKER = 'private-kafka:9092';
    process.env.KAFKA_PRIVATE_SECURITY_PROTOCOL = 'SASL_SSL';
    process.env.KAFKA_PRIVATE_USERNAME = 'runtime-user';
    process.env.KAFKA_PRIVATE_PASSWORD = 'runtime-password';
    process.env.KAFKA_PRIVATE_SASL_MECHANISM = 'SCRAM-SHA-512';

    const kafka = new KafkaEnvironment();

    expect(kafka.provisionerOperationsEnabled).toBe(true);
    expect(kafka.provisionerAllowRuntimeCredentials).toBe(true);
    expect(kafka.provisionerUsername).toBe('runtime-user');
    expect(kafka.provisionerPassword).toBe('runtime-password');
    expect(kafka.provisionerSaslMechanism).toBe('SCRAM-SHA-512');
    expect(kafka.finalizerOperationsEnabled).toBe(true);
    expect(kafka.finalizerAllowRuntimeCredentials).toBe(true);
    expect(kafka.finalizerUsername).toBe('runtime-user');
    expect(kafka.finalizerPassword).toBe('runtime-password');
    expect(kafka.finalizerSaslMechanism).toBe('SCRAM-SHA-512');
    expect(
      buildNodeKafkaAdminConfig(
        'private-kafka:9092',
        'schedule-default-provisioner',
        'provisioner'
      )
    ).toEqual({
      'client.id': 'schedule-default-provisioner',
      'metadata.broker.list': 'private-kafka:9092',
      'security.protocol': 'sasl_ssl',
      'sasl.mechanism': 'SCRAM-SHA-512',
      'sasl.username': 'runtime-user',
      'sasl.password': 'runtime-password',
      'enable.ssl.certificate.verification': true,
      'ssl.endpoint.identification.algorithm': 'https',
      'ssl.ca.location': 'probe',
    });
  });

  it('allows Kafka administration defaults to be explicitly disabled', () => {
    process.env.KAFKA_PROVISIONER_OPERATIONS_ENABLED = 'false';
    process.env.KAFKA_PROVISIONER_ALLOW_RUNTIME_CREDENTIALS = 'false';
    process.env.KAFKA_FINALIZER_OPERATIONS_ENABLED = 'false';
    process.env.KAFKA_FINALIZER_ALLOW_RUNTIME_CREDENTIALS = 'false';

    const kafka = new KafkaEnvironment();

    expect(kafka.provisionerOperationsEnabled).toBe(false);
    expect(kafka.provisionerAllowRuntimeCredentials).toBe(false);
    expect(kafka.finalizerOperationsEnabled).toBe(false);
    expect(kafka.finalizerAllowRuntimeCredentials).toBe(false);
  });
});
