import { CacheEnvironment } from '@core/config/environments/CacheEnvironment';
import { CentrifugoEnvironment } from '@core/config/environments/CentrifugoEnvironment';
import { DatabaseEnvironment } from '@core/config/environments/DatabaseEnvironment';
import { DatabaseElasticEnvironment } from '@core/config/environments/DatabaseElasticEnvironment';
import { KafkaEnvironment } from '@core/config/environments/KafkaEnvironment';
import { resolveUnderchatEnvScope } from '@core/config/environments/envScope';

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
    process.env.DB_PUBLIC_DATABASE_URL = 'postgres://public';
    process.env.DB_PRIVATE_DATABASE_URL = 'postgres://private';
    process.env.DB_PUBLIC_ATLAS = 'postgres://public-atlas';
    process.env.DB_PRIVATE_ATLAS = 'postgres://private-atlas';

    const environment = new DatabaseEnvironment();

    expect(environment.dbHostRw).toBe('public-rw');
    expect(environment.dbPortRw).toBe(15432);
    expect(environment.dbHostRo).toBe('public-ro');
    expect(environment.dbPortRo).toBe(15433);
    expect(environment.dbDatabaseUrl).toBe('postgres://public');
    expect(environment.dbAtlas).toBe('postgres://public-atlas');
  });

  it('falls back to legacy Postgres envs when scoped envs are absent', () => {
    process.env.UNDERCHAT_ENV_SCOPE = 'public';
    process.env.DB_HOST_RW = 'legacy-rw';
    process.env.DB_PORT_RW = '5432';
    process.env.DB_HOST_RO = 'legacy-ro';
    process.env.DB_PORT_RO = '5433';
    process.env.DB_DATABASE_URL = 'postgres://legacy';
    process.env.DB_ATLAS = 'postgres://legacy-atlas';

    const environment = new DatabaseEnvironment();

    expect(environment.dbHostRw).toBe('legacy-rw');
    expect(environment.dbPortRw).toBe(5432);
    expect(environment.dbHostRo).toBe('legacy-ro');
    expect(environment.dbPortRo).toBe(5433);
    expect(environment.dbDatabaseUrl).toBe('postgres://legacy');
    expect(environment.dbAtlas).toBe('postgres://legacy-atlas');
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
});
