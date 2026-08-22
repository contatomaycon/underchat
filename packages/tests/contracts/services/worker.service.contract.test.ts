import 'reflect-metadata';

import { APP_TIMEZONE } from '@core/common/constants/timezone';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { BALANCER_RUNTIME_FENCE_TOKEN_ENV } from '@core/common/functions/balancerRuntimeFenceAuth';
import { balanceRuntimeFenceToken } from '@core/common/functions/balanceRuntimeFenceCredential';
import { NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS } from '@core/common/functions/nodeWorkerGracefulShutdown';
import { WorkerService } from '@core/services/worker.service';

type WorkerServicePrivate = {
  buildContainerEnv: (overrides: string[]) => string[];
  getAllowedEnv: (env: string[] | undefined) => Record<string, string>;
  buildContainerLabels: (input: {
    imageName: EWorkerImage;
    workerId: string;
    accountId: string;
    metadata?: { runtimeGeneration?: number };
  }) => Record<string, string>;
  getAllowedLabels: (
    labels: Record<string, string> | undefined
  ) => Record<string, string>;
};

const TEST_IMAGE_CONTENT_ID = `sha256:${'a'.repeat(64)}`;
const ENV_DEPENDENCY_COUNT = 28;

const makeService = (): WorkerServicePrivate => {
  const dependencies = Array.from({ length: ENV_DEPENDENCY_COUNT }, () => ({}));
  dependencies[27] = {
    ensureImage: jest.fn(async (alias: EWorkerImage) => ({
      alias,
      contentId: TEST_IMAGE_CONTENT_ID,
      desiredReference: `${alias.split(':')[0]}:test-current`,
    })),
  };
  return new WorkerService(
    ...(dependencies as ConstructorParameters<typeof WorkerService>)
  ) as unknown as WorkerServicePrivate;
};

const envArrayToMap = (env: string[]): Map<string, string> => {
  return new Map(
    env.map((entry) => {
      const separatorIndex = entry.indexOf('=');

      return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
    })
  );
};

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

describe('WorkerService timezone container env', () => {
  const originalTz = process.env.TZ;
  const originalPgTz = process.env.PGTZ;

  afterEach(() => {
    restoreEnv('TZ', originalTz);
    restoreEnv('PGTZ', originalPgTz);
  });

  it('adds Sao Paulo timezone env when parent process does not define it', () => {
    delete process.env.TZ;
    delete process.env.PGTZ;

    const service = makeService();
    const env = envArrayToMap(
      service.buildContainerEnv(['WORKER_ID=worker-1'])
    );

    expect(env.get('TZ')).toBe(APP_TIMEZONE);
    expect(env.get('PGTZ')).toBe(APP_TIMEZONE);
  });

  it('forces Sao Paulo timezone over inherited or override values', () => {
    process.env.TZ = 'UTC';
    process.env.PGTZ = 'UTC';

    const service = makeService();
    const env = envArrayToMap(
      service.buildContainerEnv(['TZ=UTC', 'PGTZ=UTC'])
    );

    expect(env.get('TZ')).toBe(APP_TIMEZONE);
    expect(env.get('PGTZ')).toBe(APP_TIMEZONE);
  });

  it('exposes timezone env in safe container inspection diagnostics', () => {
    const service = makeService();

    expect(
      service.getAllowedEnv([
        `TZ=${APP_TIMEZONE}`,
        `PGTZ=${APP_TIMEZONE}`,
        'PASSWORD=secret',
      ])
    ).toEqual({
      TZ: APP_TIMEZONE,
      PGTZ: APP_TIMEZONE,
    });
  });

  it('exposes runtime generation in safe container diagnostics', () => {
    const service = makeService();

    expect(
      service.getAllowedEnv([
        'RUNTIME_GENERATION=7',
        'WORKER_RUNTIME_CAPABILITY=capability-secret',
        'WORKER_WRITER_EPOCH=018f0000-0000-7000-8000-000000000001',
        'WORKER_DATABASE_URL=postgres://worker-secret',
        'PASSWORD=secret',
      ])
    ).toEqual({ RUNTIME_GENERATION: '7' });
    expect(
      service.getAllowedLabels(
        service.buildContainerLabels({
          imageName: EWorkerImage.wwebjs,
          workerId: 'worker-1',
          accountId: 'account-1',
          metadata: { runtimeGeneration: 7 },
        })
      )
    ).toEqual(expect.objectContaining({ 'underchat.runtime_generation': '7' }));
  });

  it('passes only worker runtime capabilities and strips control-plane secrets', () => {
    const inherited = {
      DB_HOST_RW: 'postgres-primary',
      DB_PUBLIC_DATABASE_URL: 'postgres://public-secret',
      DB_PRIVATE_DATABASE_URL: 'postgres://private-secret',
      DB_USER: 'database-user',
      DB_PASSWORD: 'database-password',
      WORKER_DB_USER: 'worker-database-user',
      WORKER_DB_PASSWORD: 'worker-database-password',
      DATABASE_URL: 'postgres://conventional-secret',
      PGHOST: 'postgres-host',
      PGPASSWORD: 'postgres-password',
      KAFKA_PROVISIONER_OPERATIONS_ENABLED: 'true',
      KAFKA_PROVISIONER_USERNAME: 'topic-creator',
      KAFKA_PROVISIONER_PASSWORD: 'topic-creator-password',
      KAFKA_FINALIZER_OPERATIONS_ENABLED: 'true',
      KAFKA_FINALIZER_USERNAME: 'topic-finalizer',
      KAFKA_FINALIZER_PASSWORD: 'topic-finalizer-password',
      KAFKA_CLEANER_ALLOWED_DATABASE_FINGERPRINTS: 'primary-fingerprint',
      JWT_SECRET: 'jwt-secret',
      GIT_TOKEN: 'git-secret',
      HARBOR_PASSWORD: 'registry-secret',
      SMTP_PASSWORD: 'smtp-secret',
      ASAAS_TOKEN: 'billing-secret',
      SERVICE_API_KAFKA_CUTOVER_TOKEN: 'service-control-secret',
      WARM_WORKER_POOL_ENABLED: 'true',
      WORKER_WARM_POOL_DELETE_REDRIVE_BATCH_SIZE: '500',
      UNDERCHAT_ENV_SCOPE: 'private',
      NODE_ENV: 'test',
      DB_CACHE_HOST: 'redis-legacy',
      DB_CACHE_PUBLIC_HOST: 'redis-public',
      DB_CACHE_PORT: '6380',
      DB_CACHE_PUBLIC_PORT: '6379',
      DB_CACHE_PRIVATE_HOST: 'redis-private',
      DB_CACHE_PASSWORD: 'redis-password',
      DB_ELASTIC_HOST: 'https://elastic-legacy:9200',
      DB_ELASTIC_PUBLIC_HOST: 'https://elastic-public:9200',
      DB_ELASTIC_PRIVATE_HOST: 'http://elastic-private:9200',
      DB_ELASTIC_USER: 'elastic-worker',
      DB_ELASTIC_PASSWORD: 'elastic-password',
      KAFKA_PUBLIC_BROKER: 'kafka-public:9092',
      KAFKA_PUBLIC_SECURITY_PROTOCOL: 'sasl_ssl',
      KAFKA_PUBLIC_USERNAME: 'worker-runtime',
      KAFKA_PUBLIC_PASSWORD: 'worker-runtime-password',
      KAFKA_PUBLIC_SASL_MECHANISM: 'SCRAM-SHA-512',
      KAFKA_BROKER: 'kafka-legacy:9092',
      KAFKA_USERNAME: 'legacy-runtime',
      KAFKA_PASSWORD: 'legacy-runtime-password',
      SECURITY_PROTOCOL: 'sasl_ssl',
      SASL_MECHANISM: 'SCRAM-SHA-512',
      KAFKA_PRIVATE_BROKER: 'kafka-private:9092',
      KAFKA_PRIVATE_USERNAME: 'private-runtime-user',
      KAFKA_PRIVATE_PASSWORD: 'private-runtime-password',
      KAFKA_ADMIN_PASSWORD: 'unrecognized-admin-secret',
      KAFKA_SSL_CA_LOCATION: '/run/secrets/kafka-ca.pem',
      BALANCER_GRPC_RUNTIME_FENCE_TOKEN:
        'runtime-fence-token-that-is-at-least-32-bytes',
      S3_SECRET_ACCESS_KEY: 'worker-s3-secret',
      S3_PRIVATE_ACCESS_KEY: 'private-storage-secret',
      CENTRIFUGO_HMAC_SECRET_KEY: 'worker-centrifugo-secret',
      CENTRIFUGO_HTTP_API_KEY: 'worker-centrifugo-api-key',
      CENTRIFUGO_HTTP_API_URL: 'https://centrifugo-legacy/api',
      CENTRIFUGO_WS_URL: 'wss://centrifugo-legacy/connection/websocket',
      CENTRIFUGO_PUBLIC_HTTP_API_URL: 'https://centrifugo-public/api',
      CENTRIFUGO_PUBLIC_WS_URL: 'wss://centrifugo-public/connection/websocket',
      CENTRIFUGO_PRIVATE_HTTP_API_URL: 'http://centrifugo-private/api',
      WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS: 'true',
      WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS: '300000',
      INBOUND_MESSAGE_SPOOL_BATCH_SIZE: '75',
      LID_JID_CACHE_TTL_SECONDS: '86400',
      SCHEDULE_MESSAGE_IN_FLIGHT_TTL_MS: '300000',
      WORKER_SELF_MONITOR_INTERVAL_MS: '30000',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );

    try {
      Object.assign(process.env, inherited);
      const env = envArrayToMap(
        makeService().buildContainerEnv(['WORKER_ID=worker-1'])
      );

      for (const key of [
        'DB_HOST_RW',
        'DB_PUBLIC_DATABASE_URL',
        'DB_PRIVATE_DATABASE_URL',
        'DB_USER',
        'DB_PASSWORD',
        'WORKER_DB_USER',
        'WORKER_DB_PASSWORD',
        'DATABASE_URL',
        'PGHOST',
        'PGPASSWORD',
        'KAFKA_PROVISIONER_OPERATIONS_ENABLED',
        'KAFKA_PROVISIONER_USERNAME',
        'KAFKA_PROVISIONER_PASSWORD',
        'KAFKA_FINALIZER_OPERATIONS_ENABLED',
        'KAFKA_FINALIZER_USERNAME',
        'KAFKA_FINALIZER_PASSWORD',
        'KAFKA_CLEANER_ALLOWED_DATABASE_FINGERPRINTS',
        'JWT_SECRET',
        'GIT_TOKEN',
        'HARBOR_PASSWORD',
        'SMTP_PASSWORD',
        'ASAAS_TOKEN',
        'SERVICE_API_KAFKA_CUTOVER_TOKEN',
        'WARM_WORKER_POOL_ENABLED',
        'WORKER_WARM_POOL_DELETE_REDRIVE_BATCH_SIZE',
        'DB_CACHE_PRIVATE_HOST',
        'DB_ELASTIC_PRIVATE_HOST',
        'KAFKA_PRIVATE_BROKER',
        'KAFKA_PRIVATE_USERNAME',
        'KAFKA_PRIVATE_PASSWORD',
        'KAFKA_ADMIN_PASSWORD',
        'S3_PRIVATE_ACCESS_KEY',
        'CENTRIFUGO_PRIVATE_HTTP_API_URL',
      ]) {
        expect(env.has(key)).toBe(false);
      }
      expect(
        [...env.keys()].filter((key) => /(^|_)PRIVATE(_|$)/u.test(key))
      ).toEqual([]);

      expect(Object.fromEntries(env)).toEqual(
        expect.objectContaining({
          WORKER_ID: 'worker-1',
          NODE_ENV: 'production',
          UNDERCHAT_ENV_SCOPE: 'public',
          DB_CACHE_HOST: 'redis-legacy',
          DB_CACHE_PUBLIC_HOST: 'redis-public',
          DB_CACHE_PORT: '6380',
          DB_CACHE_PUBLIC_PORT: '6379',
          DB_CACHE_PASSWORD: 'redis-password',
          DB_ELASTIC_HOST: 'https://elastic-legacy:9200',
          DB_ELASTIC_PUBLIC_HOST: 'https://elastic-public:9200',
          DB_ELASTIC_USER: 'elastic-worker',
          DB_ELASTIC_PASSWORD: 'elastic-password',
          KAFKA_PUBLIC_BROKER: 'kafka-public:9092',
          KAFKA_PUBLIC_SECURITY_PROTOCOL: 'sasl_ssl',
          KAFKA_PUBLIC_USERNAME: 'worker-runtime',
          KAFKA_PUBLIC_PASSWORD: 'worker-runtime-password',
          KAFKA_PUBLIC_SASL_MECHANISM: 'SCRAM-SHA-512',
          KAFKA_BROKER: 'kafka-legacy:9092',
          KAFKA_USERNAME: 'legacy-runtime',
          KAFKA_PASSWORD: 'legacy-runtime-password',
          SECURITY_PROTOCOL: 'sasl_ssl',
          SASL_MECHANISM: 'SCRAM-SHA-512',
          KAFKA_SSL_CA_LOCATION: '/run/secrets/kafka-ca.pem',
          S3_SECRET_ACCESS_KEY: 'worker-s3-secret',
          CENTRIFUGO_HMAC_SECRET_KEY: 'worker-centrifugo-secret',
          CENTRIFUGO_HTTP_API_KEY: 'worker-centrifugo-api-key',
          CENTRIFUGO_HTTP_API_URL: 'https://centrifugo-legacy/api',
          CENTRIFUGO_WS_URL: 'wss://centrifugo-legacy/connection/websocket',
          CENTRIFUGO_PUBLIC_HTTP_API_URL: 'https://centrifugo-public/api',
          CENTRIFUGO_PUBLIC_WS_URL:
            'wss://centrifugo-public/connection/websocket',
          WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS: 'true',
          WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS: '300000',
          INBOUND_MESSAGE_SPOOL_BATCH_SIZE: '75',
          LID_JID_CACHE_TTL_SECONDS: '86400',
          SCHEDULE_MESSAGE_IN_FLIGHT_TTL_MS: '300000',
          WORKER_SELF_MONITOR_INTERVAL_MS: '30000',
        })
      );
      expect(env.has(BALANCER_RUNTIME_FENCE_TOKEN_ENV)).toBe(false);
    } finally {
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('normalizes the public NATS endpoints into NATS_URL without exposing private scope', () => {
    const inherited = {
      NATS_URL: 'nats://legacy.example:4222',
      NATS_PUBLIC_URL:
        ' nats://public-a.example:4222, nats://public-b.example:4222, nats://public-a.example:4222 ',
      NATS_PRIVATE_URL: 'nats://under-nats-1:4222,nats://under-nats-2:4222',
      NATS_USER: 'worker-runtime',
      NATS_PASSWORD: 'worker-runtime-password',
      NATS_TLS: 'TRUE',
      NATS_CONNECTION_NAME: 'underchat-worker',
      WORKER_COMMAND_TRANSPORT: 'kafka',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );

    try {
      Object.assign(process.env, inherited);
      const env = envArrayToMap(
        makeService().buildContainerEnv(['WORKER_ID=worker-1'])
      );

      const publicServers =
        'nats://public-a.example:4222,nats://public-b.example:4222';
      expect(env.get('NATS_URL')).toBe(publicServers);
      expect(env.get('NATS_PUBLIC_URL')).toBe(publicServers);
      expect(env.get('NATS_USER')).toBe('worker-runtime');
      expect(env.get('NATS_PASSWORD')).toBe('worker-runtime-password');
      expect(env.get('NATS_TLS')).toBe('true');
      expect(env.get('NATS_CONNECTION_NAME')).toBe('underchat-worker');
      expect(env.has('NATS_PRIVATE_URL')).toBe(false);
      expect(env.has('WORKER_COMMAND_TRANSPORT')).toBe(false);
    } finally {
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('uses canonical NATS_URL when no public alias is configured', () => {
    const inherited = {
      NATS_URL: ' nats://edge-a.example:4222, nats://edge-b.example:4222 ',
      NATS_USER: 'worker-runtime',
      NATS_PASSWORD: 'worker-runtime-password',
      NATS_TOKEN: 'stale-token-that-must-not-be-inherited',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );
    const cleared = new Map(
      ['NATS_PUBLIC_URL'].map((key) => [key, process.env[key]])
    );

    try {
      for (const key of cleared.keys()) delete process.env[key];
      Object.assign(process.env, inherited);
      const env = envArrayToMap(
        makeService().buildContainerEnv(['WORKER_ID=worker-1'])
      );

      expect(env.get('NATS_URL')).toBe(
        'nats://edge-a.example:4222,nats://edge-b.example:4222'
      );
      expect(env.has('NATS_PUBLIC_URL')).toBe(false);
      expect(env.get('NATS_USER')).toBe('worker-runtime');
      expect(env.get('NATS_PASSWORD')).toBe('worker-runtime-password');
      expect(env.has('NATS_TOKEN')).toBe(false);
    } finally {
      for (const [key, value] of cleared) restoreEnv(key, value);
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('uses only static NATS user/password for active and warm workers', () => {
    const inherited = {
      APP_ENVIRONMENT: process.env.APP_ENVIRONMENT,
      NATS_USER: process.env.NATS_USER,
      NATS_PASSWORD: process.env.NATS_PASSWORD,
      NATS_TOKEN: process.env.NATS_TOKEN,
      NATS_CREDS_BASE64: process.env.NATS_CREDS_BASE64,
    };
    try {
      process.env.APP_ENVIRONMENT = 'PROD';
      process.env.NATS_USER = 'shared-user';
      process.env.NATS_PASSWORD = 'shared-password';
      process.env.NATS_TOKEN = 'shared-token';
      process.env.NATS_CREDS_BASE64 = 'stale-creds';
      const activeEnv = envArrayToMap(
        makeService().buildContainerEnv(['WORKER_ID=worker-1'])
      );
      const warmEnv = envArrayToMap(
        makeService().buildContainerEnv([
          'WARM_STANDBY=true',
          'WARM_POOL_ID=warm-pool-1',
        ])
      );

      for (const env of [activeEnv, warmEnv]) {
        expect(env.get('NATS_USER')).toBe('shared-user');
        expect(env.get('NATS_PASSWORD')).toBe('shared-password');
        expect(env.has('NATS_TOKEN')).toBe(false);
        expect(env.has('NATS_CREDS_BASE64')).toBe(false);
      }
    } finally {
      restoreEnv('APP_ENVIRONMENT', inherited.APP_ENVIRONMENT);
      restoreEnv('NATS_USER', inherited.NATS_USER);
      restoreEnv('NATS_PASSWORD', inherited.NATS_PASSWORD);
      restoreEnv('NATS_TOKEN', inherited.NATS_TOKEN);
      restoreEnv('NATS_CREDS_BASE64', inherited.NATS_CREDS_BASE64);
    }
  });

  it('fails closed outside LOCAL when static NATS credentials are missing or incomplete', () => {
    const inherited = {
      APP_ENVIRONMENT: process.env.APP_ENVIRONMENT,
      NATS_USER: process.env.NATS_USER,
      NATS_PASSWORD: process.env.NATS_PASSWORD,
    };
    try {
      process.env.APP_ENVIRONMENT = 'PROD';
      delete process.env.NATS_USER;
      delete process.env.NATS_PASSWORD;
      expect(() =>
        makeService().buildContainerEnv(['WORKER_ID=worker-1'])
      ).toThrow('nats_worker_static_credentials_missing');

      process.env.NATS_USER = 'runtime-user';
      expect(() =>
        makeService().buildContainerEnv(['WORKER_ID=worker-1'])
      ).toThrow('nats_worker_static_credentials_incomplete');
    } finally {
      restoreEnv('APP_ENVIRONMENT', inherited.APP_ENVIRONMENT);
      restoreEnv('NATS_USER', inherited.NATS_USER);
      restoreEnv('NATS_PASSWORD', inherited.NATS_PASSWORD);
    }
  });

  it('rejects cold and warm creation before any Docker access when static credentials are missing', async () => {
    const inherited = {
      APP_ENVIRONMENT: process.env.APP_ENVIRONMENT,
      NATS_USER: process.env.NATS_USER,
      NATS_PASSWORD: process.env.NATS_PASSWORD,
    };
    const dockerCalls = {
      createContainer: jest.fn(),
      createVolume: jest.fn(),
      getContainer: jest.fn(),
      getImage: jest.fn(),
      getVolume: jest.fn(),
      info: jest.fn(),
      listContainers: jest.fn(),
    };
    const service = makeService();
    Object.defineProperty(service, 'docker', { value: dockerCalls });

    try {
      process.env.APP_ENVIRONMENT = 'PROD';
      delete process.env.NATS_USER;
      delete process.env.NATS_PASSWORD;

      await expect(
        (service as unknown as WorkerService).createContainerWorker(
          EWorkerImage.baileys,
          'worker-1',
          'account-1'
        )
      ).rejects.toThrow('nats_worker_static_credentials_missing');
      await expect(
        (service as unknown as WorkerService).createWarmContainerWorker({
          imageName: EWorkerImage.baileys,
          imageContentId: TEST_IMAGE_CONTENT_ID,
          warmPoolId: 'warm-pool-1',
          serverId: 'server-1',
          workerTypeId: EWorkerType.baileys,
          runtimeCapability: 'c'.repeat(48),
          writerEpoch: '018f0000-0000-7000-8000-000000000001',
        })
      ).rejects.toThrow('nats_worker_static_credentials_missing');

      for (const dockerCall of Object.values(dockerCalls)) {
        expect(dockerCall).not.toHaveBeenCalled();
      }
    } finally {
      restoreEnv('APP_ENVIRONMENT', inherited.APP_ENVIRONMENT);
      restoreEnv('NATS_USER', inherited.NATS_USER);
      restoreEnv('NATS_PASSWORD', inherited.NATS_PASSWORD);
    }
  });

  it('injects the resolved runtime-fence token instead of a Devtron placeholder', () => {
    const inherited = {
      APP_ENVIRONMENT: 'LOCAL',
      BALANCER_GRPC_RUNTIME_FENCE_TOKEN: 'DEVTRON_SECRET_REQUIRED',
      CENTRIFUGO_HMAC_SECRET_KEY:
        'centrifugo-hmac-secret-used-only-by-contract-tests-2026',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );

    try {
      Object.assign(process.env, inherited);
      const expectedToken = balanceRuntimeFenceToken();
      const service = makeService();
      const env = envArrayToMap(
        service.buildContainerEnv([
          'WORKER_ID=worker-1',
          `WORKER_TYPE_ID=${EWorkerType.wwebjs}`,
          `WORKER_SESSION_STORAGE=${EWorkerSessionStorage.legacy_volume}`,
        ])
      );

      expect(env.get(BALANCER_RUNTIME_FENCE_TOKEN_ENV)).toBe(expectedToken);
      expect(env.get(BALANCER_RUNTIME_FENCE_TOKEN_ENV)).not.toBe(
        'DEVTRON_SECRET_REQUIRED'
      );
      expect(env.get(BALANCER_RUNTIME_FENCE_TOKEN_ENV)).not.toBe(
        inherited.CENTRIFUGO_HMAC_SECRET_KEY
      );
      expect(
        Buffer.byteLength(
          env.get(BALANCER_RUNTIME_FENCE_TOKEN_ENV) ?? '',
          'utf8'
        )
      ).toBeGreaterThanOrEqual(32);
    } finally {
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('derives from a Balance-only credential without propagating that credential', () => {
    const inherited = {
      APP_ENVIRONMENT: 'PROD',
      BALANCER_GRPC_RUNTIME_FENCE_TOKEN: 'DEVTRON_SECRET_REQUIRED',
      CENTRIFUGO_HMAC_SECRET_KEY: 'DEVTRON_SECRET_REQUIRED',
      JWT_SECRET: 'existing-balance-jwt-secret-used-only-by-contract-tests',
      NATS_USER: 'runtime-user',
      NATS_PASSWORD: 'runtime-password',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );

    try {
      Object.assign(process.env, inherited);
      const expectedToken = balanceRuntimeFenceToken();
      const service = makeService();
      const env = envArrayToMap(
        service.buildContainerEnv([
          'WORKER_ID=worker-1',
          `WORKER_TYPE_ID=${EWorkerType.wwebjs}`,
          `WORKER_SESSION_STORAGE=${EWorkerSessionStorage.legacy_volume}`,
        ])
      );

      expect(env.get(BALANCER_RUNTIME_FENCE_TOKEN_ENV)).toBe(expectedToken);
      expect(env.has('JWT_SECRET')).toBe(false);
      expect(expectedToken).not.toBe(inherited.JWT_SECRET);
    } finally {
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('does not inject Balance access or create a volume for warm Whatsmeow Postgres containers', async () => {
    const inherited = {
      APP_ENVIRONMENT: 'LOCAL',
      UNDERCHAT_ENV_SCOPE: 'public',
      DB_PUBLIC_HOST_RW: 'public-worker-db.invalid',
      DB_PUBLIC_PORT_RW: '15432',
      DB_USER: 'control-plane-user',
      DB_PASSWORD: 'control-plane-password',
      WORKER_DB_USER: 'worker-user',
      WORKER_DB_PASSWORD: 'worker-password',
      DB_DATABASE: 'underchat',
      DB_SSLMODE: 'false',
      DB_PUBLIC_DATABASE_URL: 'postgresql://must-not-be-used.invalid/underchat',
      BALANCER_GRPC_RUNTIME_FENCE_TOKEN: 'DEVTRON_SECRET_REQUIRED',
      CENTRIFUGO_HMAC_SECRET_KEY:
        'centrifugo-hmac-secret-used-only-by-contract-tests-2026',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );
    const service = makeService();
    const createContainer = jest.fn(async (_options: unknown) => ({
      id: 'warm-container',
      start: jest.fn(async () => undefined),
    }));
    const createVolume = jest.fn(async () => ({}));
    Object.defineProperty(service, 'docker', {
      value: {
        getImage: jest.fn(() => ({
          inspect: jest.fn(async () => ({ Id: TEST_IMAGE_CONTENT_ID })),
        })),
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        getVolume: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such volume'), {
              statusCode: 404,
            });
          }),
        })),
        createVolume,
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    try {
      Object.assign(process.env, inherited);
      await (service as unknown as WorkerService).createWarmContainerWorker({
        imageName: EWorkerImage.whatsmeow,
        imageContentId: `sha256:${'a'.repeat(64)}`,
        warmPoolId: 'warm-pool-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.whatsmeow,
        runtimeCapability: 'c'.repeat(48),
        writerEpoch: '018f0000-0000-7000-8000-000000000001',
      });

      expect(createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: `sha256:${'a'.repeat(64)}`,
          StopTimeout: NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS,
          Env: expect.arrayContaining([
            'NODE_ENV=production',
            'UNDERCHAT_ENV_SCOPE=public',
            'WARM_STANDBY=true',
            `WORKER_SESSION_STORAGE=${EWorkerSessionStorage.postgres}`,
          ]),
        })
      );
      expect(createVolume).not.toHaveBeenCalled();
      const containerOptions = createContainer.mock.calls[0]?.[0] as {
        Env?: string[];
        HostConfig?: { Binds?: string[] };
        Volumes?: Record<string, unknown>;
      };
      const containerEnv = containerOptions.Env;
      expect(containerOptions.HostConfig).not.toHaveProperty('Binds');
      expect(containerOptions).not.toHaveProperty('Volumes');
      expect(containerEnv).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^BALANCER_GRPC_(?:HOST|PORT|RUNTIME_FENCE_TOKEN)=/u
          ),
        ])
      );
      expect(containerEnv).toContain(
        'WORKER_DATABASE_URL=postgresql://worker-user:worker-password@public-worker-db.invalid:15432/underchat?sslmode=disable'
      );
      expect(containerEnv).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining('must-not-be-used.invalid'),
        ])
      );
    } finally {
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('mounts a warm legacy volume without copying image session data', async () => {
    const previousDatabaseUrl = process.env.DB_PUBLIC_DATABASE_URL;
    process.env.DB_PUBLIC_DATABASE_URL =
      'postgresql://worker-runtime.invalid/underchat';
    const service = makeService();
    const start = jest.fn(async () => undefined);
    const createContainer = jest.fn(async (_options: unknown) => ({
      id: 'warm-legacy-container',
      start,
    }));
    const createVolume = jest.fn(async () => ({}));
    Object.defineProperty(service, 'docker', {
      value: {
        getImage: jest.fn(() => ({
          inspect: jest.fn(async () => ({ Id: TEST_IMAGE_CONTENT_ID })),
        })),
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        getVolume: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such volume'), {
              statusCode: 404,
            });
          }),
        })),
        createVolume,
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    try {
      await (service as unknown as WorkerService).createWarmContainerWorker({
        imageName: EWorkerImage.baileys,
        imageContentId: TEST_IMAGE_CONTENT_ID,
        warmPoolId: 'legacy-pool-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        sessionStorage: EWorkerSessionStorage.legacy_volume,
        runtimeCapability: 'c'.repeat(48),
        writerEpoch: '018f0000-0000-7000-8000-000000000001',
      });

      expect(createVolume).toHaveBeenCalledWith(
        expect.objectContaining({ Name: 'warm-legacy-pool-1' })
      );
      expect(createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: ['warm-legacy-pool-1:/app/data:nocopy'],
          }),
          Volumes: { '/app/data': {} },
        })
      );
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      restoreEnv('DB_PUBLIC_DATABASE_URL', previousDatabaseUrl);
    }
  });

  it('mounts the Whatsmeow legacy volume without copying image session data', async () => {
    const inherited = {
      UNDERCHAT_ENV_SCOPE: 'public',
      DB_PUBLIC_HOST_RW: 'public-worker-db.invalid',
      DB_PUBLIC_PORT_RW: '15432',
      DB_USER: 'worker-user',
      DB_PASSWORD: 'worker-password',
      WORKER_DB_USER: 'legacy-runtime-user',
      WORKER_DB_PASSWORD: 'legacy-runtime-password',
      DB_DATABASE: 'underchat',
      DB_SSLMODE: 'false',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );
    const service = makeService();
    const start = jest.fn(async () => undefined);
    const createContainer = jest.fn(async (_options: unknown) => ({
      id: 'legacy-whatsmeow-container',
      remove: jest.fn(async () => undefined),
      start,
    }));
    const createVolume = jest.fn(async () => ({}));
    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        getVolume: jest.fn(() => ({ inspect: jest.fn(async () => ({})) })),
        createVolume,
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    try {
      Object.assign(process.env, inherited);
      await (service as unknown as WorkerService).createContainerWorker(
        EWorkerImage.whatsmeow,
        'worker-whatsmeow-legacy',
        'account-1',
        false,
        undefined,
        undefined,
        undefined,
        {
          workerTypeId: EWorkerType.whatsmeow,
          runtimeGeneration: 7,
          lifecycleOperationId: 'operation-1',
          serverId: 'server-1',
          sessionStorage: EWorkerSessionStorage.legacy_volume,
          runtimeCapability: 'c'.repeat(48),
          writerEpoch: '018f0000-0000-7000-8000-000000000001',
        },
        'whatsmeow-session-legacy',
        {
          beforeStart: async () => undefined,
          requireExistingVolume: true,
        }
      );

      expect(createVolume).not.toHaveBeenCalled();
      expect(createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: expect.arrayContaining([
            `WORKER_SESSION_STORAGE=${EWorkerSessionStorage.legacy_volume}`,
            'SESSION_VOLUME_NAME=whatsmeow-session-legacy',
          ]),
          HostConfig: expect.objectContaining({
            Binds: ['whatsmeow-session-legacy:/app/data:nocopy'],
          }),
          Volumes: { '/app/data': {} },
        })
      );
      const env = (createContainer.mock.calls[0]?.[0] as { Env?: string[] })
        .Env;
      expect(env).toContain(
        'WORKER_DATABASE_URL=postgresql://legacy-runtime-user:legacy-runtime-password@public-worker-db.invalid:15432/underchat?sslmode=disable'
      );
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('does not expose the WhatsApp database DSN to an unrelated worker type', () => {
    const previousDatabaseUrl = process.env.DB_PUBLIC_DATABASE_URL;
    process.env.DB_PUBLIC_DATABASE_URL =
      'postgresql://worker-runtime.invalid/underchat';

    try {
      const env = envArrayToMap(
        makeService().buildContainerEnv([
          'WORKER_ID=worker-1',
          `WORKER_TYPE_ID=${EWorkerType.telegram}`,
          `WORKER_SESSION_STORAGE=${EWorkerSessionStorage.legacy_volume}`,
        ])
      );
      expect(env.has('WORKER_DATABASE_URL')).toBe(false);
    } finally {
      restoreEnv('DB_PUBLIC_DATABASE_URL', previousDatabaseUrl);
    }
  });

  it('rejects attempts to add database or Kafka admin credentials as overrides', () => {
    const service = makeService();

    expect(() =>
      service.buildContainerEnv(['DB_PASSWORD=must-not-enter-worker'])
    ).toThrow('worker_container_env_override_not_allowed:DB_PASSWORD');
    expect(() =>
      service.buildContainerEnv([
        'KAFKA_PROVISIONER_PASSWORD=must-not-enter-worker',
      ])
    ).toThrow(
      'worker_container_env_override_not_allowed:KAFKA_PROVISIONER_PASSWORD'
    );
  });

  it('accepts only the internal legacy-migration identity as worker overrides', () => {
    const migrationId = '018f0000-0000-7000-8000-000000000002';
    const checksum = 'a'.repeat(64);
    const env = envArrayToMap(
      makeService().buildContainerEnv([
        `SESSION_STORAGE_MIGRATION_ID=${migrationId}`,
        'LEGACY_SESSION_VOLUME_NAME=worker-legacy-volume',
        `LEGACY_SESSION_CHECKSUM_SHA256=${checksum}`,
      ])
    );

    expect(env.get('SESSION_STORAGE_MIGRATION_ID')).toBe(migrationId);
    expect(env.get('LEGACY_SESSION_VOLUME_NAME')).toBe('worker-legacy-volume');
    expect(env.get('LEGACY_SESSION_CHECKSUM_SHA256')).toBe(checksum);
    expect(() =>
      makeService().buildContainerEnv([
        'SESSION_STORAGE_MIGRATION_COMMAND=untrusted',
      ])
    ).toThrow(
      'worker_container_env_override_not_allowed:SESSION_STORAGE_MIGRATION_COMMAND'
    );
  });

  it('does not leak proxy connection fields or aliases into a direct worker', () => {
    const inherited = {
      PROXY_PROTOCOL: 'socks5',
      PROXY_HOST: 'should-not-enter-worker.test',
      PROXY_PORT: '1080',
      PROXY_USERNAME: 'proxy-user',
      PROXY_PASSWORD: 'proxy-password',
      PROXY_ADDRESS: 'socks5://should-not-enter-worker.test:1080',
      PROXY_AUTH: 'proxy-user:proxy-password',
      PROXY_PASS: 'proxy-password',
      PROXY_SERVER: 'should-not-enter-worker.test',
      PROXY_URI: 'socks5://should-not-enter-worker.test:1080',
      PROXY_URL: 'socks5://should-not-enter-worker.test:1080',
      PROXY_USER: 'proxy-user',
      PROXY_CONNECT_TIMEOUT_MS: '5000',
    } as const;
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]])
    );

    try {
      Object.assign(process.env, inherited);
      const env = envArrayToMap(
        makeService().buildContainerEnv(['WORKER_ID=worker-direct'])
      );

      for (const key of [
        'PROXY_PROTOCOL',
        'PROXY_HOST',
        'PROXY_PORT',
        'PROXY_USERNAME',
        'PROXY_PASSWORD',
        'PROXY_ADDRESS',
        'PROXY_AUTH',
        'PROXY_PASS',
        'PROXY_SERVER',
        'PROXY_URI',
        'PROXY_URL',
        'PROXY_USER',
      ]) {
        expect(env.has(key)).toBe(false);
      }
      expect(env.get('PROXY_CONNECT_TIMEOUT_MS')).toBe('5000');
    } finally {
      for (const [key, value] of previous) {
        restoreEnv(key, value);
      }
    }
  });

  it('persists a restart-safe activated warm identity in container env and labels', async () => {
    const service = makeService();
    const start = jest.fn(async () => undefined);
    const createContainer = jest.fn(async (_options: unknown) => ({
      id: 'container-new',
      start,
    }));
    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        getVolume: jest.fn(() => ({ inspect: jest.fn(async () => ({})) })),
        createVolume: jest.fn(async () => ({})),
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    await (service as unknown as WorkerService).createContainerWorker(
      EWorkerImage.wwebjs,
      'worker-1',
      'account-1',
      false,
      undefined,
      undefined,
      undefined,
      {
        workerTypeId: 'worker-type-wwebjs',
        workerGrpcPort: 50053,
        runtimeGeneration: 7,
        warmPoolId: 'warm-pool-1',
        serverId: 'server-1',
        proxyMode: 'direct',
      },
      'warm-warm-pool-1'
    );

    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        StopTimeout: NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS,
        Env: expect.arrayContaining([
          'WORKER_ID=worker-1',
          'ACCOUNT_ID=account-1',
          'RUNTIME_GENERATION=7',
          'SESSION_VOLUME_NAME=warm-warm-pool-1',
          'WARM_POOL_ID=warm-pool-1',
          'WARM_STANDBY=false',
        ]),
        HostConfig: expect.objectContaining({
          Init: false,
          Memory: 3_072 * 1024 * 1024,
          MemoryReservation: 1_536 * 1024 * 1024,
          MemorySwap: 3_072 * 1024 * 1024,
          NanoCpus: 2_000_000_000,
          OomKillDisable: false,
          OomScoreAdj: 250,
          PidsLimit: 512,
        }),
        Labels: expect.objectContaining({
          'underchat.worker_id': 'worker-1',
          'underchat.account_id': 'account-1',
          'underchat.server_id': 'server-1',
          'underchat.runtime_generation': '7',
          'underchat.session_volume_name': 'warm-warm-pool-1',
          'underchat.warm_pool_id': 'warm-pool-1',
          'underchat.warm_standby': 'false',
          'underchat.proxy_mode': 'direct',
          'underchat.worker_image_content_id': TEST_IMAGE_CONTENT_ID,
          'underchat.resource_policy': 'v2',
          'underchat.resource_profile': 'active',
          'underchat.resource_memory_bytes': String(3_072 * 1024 * 1024),
          'underchat.resource_memory_reservation_bytes': String(
            1_536 * 1024 * 1024
          ),
          'underchat.resource_memory_swap_bytes': String(3_072 * 1024 * 1024),
          'underchat.resource_nano_cpus': '2000000000',
          'underchat.resource_oom_kill_disable': 'false',
          'underchat.resource_oom_score_adj': '250',
          'underchat.resource_pids_limit': '512',
        }),
      })
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('composes the cold worker DSN from discrete fields and persists runtime identity before start', async () => {
    const databaseEnvironment = {
      UNDERCHAT_ENV_SCOPE: 'public',
      DB_PUBLIC_HOST_RW: 'cold-worker-db.invalid',
      DB_PUBLIC_PORT_RW: '15432',
      DB_USER: 'control-plane-user',
      DB_PASSWORD: 'control-plane-password',
      WORKER_DB_USER: 'cold-worker',
      WORKER_DB_PASSWORD: 'cold-password',
      DB_DATABASE: 'underchat',
      DB_SSLMODE: 'false',
      DB_PUBLIC_DATABASE_URL: 'postgresql://must-not-be-used.invalid/underchat',
      DB_DATABASE_URL: 'postgresql://legacy-must-not-be-used.invalid/underchat',
    } as const;
    const previousDatabaseEnvironment = new Map(
      Object.keys(databaseEnvironment).map((key) => [key, process.env[key]])
    );
    Object.assign(process.env, databaseEnvironment);
    const service = makeService();
    const events: string[] = [];
    const remove = jest.fn(async () => undefined);
    const start = jest.fn(async () => {
      events.push('start');
    });
    const beforeStart = jest.fn(async (containerId: string) => {
      expect(containerId).toBe('container-new');
      expect(start).not.toHaveBeenCalled();
      events.push('runtime-cas');
    });
    const createContainer = jest.fn(async (_options: unknown) => ({
      id: 'container-new',
      remove,
      start,
    }));
    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    try {
      await expect(
        (service as unknown as WorkerService).createContainerWorker(
          EWorkerImage.baileys,
          'worker-1',
          'account-1',
          false,
          undefined,
          undefined,
          undefined,
          {
            workerTypeId: EWorkerType.baileys,
            runtimeGeneration: 7,
            lifecycleOperationId: 'operation-1',
            serverId: 'server-1',
            sessionStorage: EWorkerSessionStorage.postgres,
            runtimeCapability: 'c'.repeat(48),
            writerEpoch: '018f0000-0000-7000-8000-000000000001',
          },
          undefined,
          { beforeStart }
        )
      ).resolves.toBe('container-new');

      expect(events).toEqual(['runtime-cas', 'start']);
      expect(remove).not.toHaveBeenCalled();
      const env = (createContainer.mock.calls[0]?.[0] as { Env?: string[] })
        .Env;
      expect(env).toContain(
        'WORKER_DATABASE_URL=postgresql://cold-worker:cold-password@cold-worker-db.invalid:15432/underchat?sslmode=disable'
      );
      expect(env).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining('must-not-be-used.invalid'),
        ])
      );
    } finally {
      for (const [key, value] of previousDatabaseEnvironment) {
        restoreEnv(key, value);
      }
    }
  });

  it('starts a PostgreSQL migration target with an exact read-only legacy mount', async () => {
    const databaseEnvironment = {
      UNDERCHAT_ENV_SCOPE: 'public',
      DB_PUBLIC_HOST_RW: 'migration-worker-db.invalid',
      DB_PUBLIC_PORT_RW: '15432',
      DB_USER: 'control-plane-user',
      DB_PASSWORD: 'control-plane-password',
      WORKER_DB_USER: 'migration-worker',
      WORKER_DB_PASSWORD: 'migration-password',
      DB_DATABASE: 'underchat',
      DB_SSLMODE: 'false',
    } as const;
    const previousDatabaseEnvironment = new Map(
      Object.keys(databaseEnvironment).map((key) => [key, process.env[key]])
    );
    Object.assign(process.env, databaseEnvironment);
    const service = makeService();
    const start = jest.fn(async () => undefined);
    const createContainer = jest.fn(async (_options: unknown) => ({
      id: 'migration-container',
      remove: jest.fn(async () => undefined),
      start,
    }));
    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        getVolume: jest.fn(() => ({ inspect: jest.fn(async () => ({})) })),
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    try {
      await expect(
        (service as unknown as WorkerService).createContainerWorker(
          EWorkerImage.wwebjs,
          'worker-1',
          'account-1',
          false,
          undefined,
          undefined,
          undefined,
          {
            workerTypeId: EWorkerType.wwebjs,
            runtimeGeneration: 8,
            lifecycleOperationId: 'operation-migration-1',
            serverId: 'server-1',
            sessionStorage: EWorkerSessionStorage.postgres,
            runtimeCapability: 'c'.repeat(48),
            writerEpoch: '018f0000-0000-7000-8000-000000000001',
            sessionStorageMigrationId: '018f0000-0000-7000-8000-000000000002',
            legacySessionVolumeName: 'worker-legacy-volume',
            legacySessionChecksum: 'a'.repeat(64),
          },
          undefined,
          { beforeStart: async () => undefined }
        )
      ).resolves.toBe('migration-container');

      const options = createContainer.mock.calls[0]?.[0] as {
        Env?: string[];
        HostConfig?: { Binds?: string[] };
        Labels?: Record<string, string>;
        Volumes?: Record<string, unknown>;
      };
      expect(options.Env).toEqual(
        expect.arrayContaining([
          'SESSION_STORAGE_MIGRATION_ID=018f0000-0000-7000-8000-000000000002',
          'LEGACY_SESSION_VOLUME_NAME=worker-legacy-volume',
          `LEGACY_SESSION_CHECKSUM_SHA256=${'a'.repeat(64)}`,
        ])
      );
      expect(options.HostConfig?.Binds).toEqual([
        'worker-legacy-volume:/app/legacy-session:ro,nocopy',
      ]);
      expect(options.Volumes).toEqual({ '/app/legacy-session': {} });
      expect(options.Volumes).not.toHaveProperty('/app/data');
      expect(options.Labels).toEqual(
        expect.objectContaining({
          'underchat.session_storage_migration_id':
            '018f0000-0000-7000-8000-000000000002',
          'underchat.legacy_session_volume_name': 'worker-legacy-volume',
          'underchat.legacy_session_checksum_sha256': 'a'.repeat(64),
        })
      );
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      for (const [key, value] of previousDatabaseEnvironment) {
        restoreEnv(key, value);
      }
    }
  });

  it('ignores composite URLs and rejects a cold worker before Docker when the discrete endpoint is missing', async () => {
    const databaseEnvironment = {
      UNDERCHAT_ENV_SCOPE: 'public',
      DB_PUBLIC_DATABASE_URL: 'postgresql://must-not-be-used.invalid/underchat',
      DB_DATABASE_URL: 'postgresql://legacy-must-not-be-used.invalid/underchat',
    } as const;
    const keys = [
      ...Object.keys(databaseEnvironment),
      'DB_PUBLIC_HOST_RW',
      'DB_HOST_RW',
    ];
    const previousDatabaseEnvironment = new Map(
      keys.map((key) => [key, process.env[key]])
    );
    Object.assign(process.env, databaseEnvironment);
    delete process.env.DB_PUBLIC_HOST_RW;
    delete process.env.DB_HOST_RW;

    try {
      await expect(
        (makeService() as unknown as WorkerService).createContainerWorker(
          EWorkerImage.baileys,
          'worker-1',
          'account-1',
          false,
          undefined,
          undefined,
          undefined,
          {
            workerTypeId: EWorkerType.baileys,
            runtimeGeneration: 7,
            lifecycleOperationId: 'operation-1',
            serverId: 'server-1',
            sessionStorage: EWorkerSessionStorage.postgres,
            runtimeCapability: 'c'.repeat(48),
            writerEpoch: '018f0000-0000-7000-8000-000000000001',
          },
          undefined,
          { beforeStart: async () => undefined }
        )
      ).rejects.toThrow('postgres_worker_database_url_missing');
    } finally {
      for (const [key, value] of previousDatabaseEnvironment) {
        restoreEnv(key, value);
      }
    }
  });

  it('removes the still-stopped cold container when the runtime CAS fails', async () => {
    const previousDatabaseUrl = process.env.DB_PUBLIC_DATABASE_URL;
    process.env.DB_PUBLIC_DATABASE_URL =
      'postgresql://worker-runtime.invalid/underchat';
    const service = makeService();
    const expected = new Error('runtime claim stale');
    const remove = jest.fn(async () => undefined);
    const start = jest.fn(async () => undefined);
    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        createContainer: jest.fn(async () => ({
          id: 'container-new',
          remove,
          start,
        })),
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    try {
      await expect(
        (service as unknown as WorkerService).createContainerWorker(
          EWorkerImage.wwebjs,
          'worker-1',
          'account-1',
          false,
          undefined,
          undefined,
          undefined,
          {
            workerTypeId: EWorkerType.wwebjs,
            runtimeGeneration: 7,
            lifecycleOperationId: 'operation-1',
            serverId: 'server-1',
            sessionStorage: EWorkerSessionStorage.postgres,
            runtimeCapability: 'c'.repeat(48),
            writerEpoch: '018f0000-0000-7000-8000-000000000001',
          },
          undefined,
          { beforeStart: async () => Promise.reject(expected) }
        )
      ).rejects.toBe(expected);

      expect(remove).toHaveBeenCalledWith({ force: true });
      expect(start).not.toHaveBeenCalled();
    } finally {
      restoreEnv('DB_PUBLIC_DATABASE_URL', previousDatabaseUrl);
    }
  });

  it('creates from an explicit content ID without re-resolving a retagged alias', async () => {
    const service = makeService();
    const retaggedImageId = `sha256:${'b'.repeat(64)}`;
    const ensureImage = jest.fn(async () => ({
      alias: EWorkerImage.baileys,
      contentId: retaggedImageId,
      desiredReference: 'under-worker-baileys:test-retagged',
    }));
    const getImage = jest.fn((reference: string) => ({
      inspect: jest.fn(async () => ({
        Id:
          reference.toLowerCase() === TEST_IMAGE_CONTENT_ID
            ? TEST_IMAGE_CONTENT_ID
            : retaggedImageId,
      })),
    }));
    const createContainer = jest.fn(async () => ({
      id: 'container-pinned-a',
      start: jest.fn(async () => undefined),
    }));
    Object.defineProperty(service, 'workerImageProvisionerService', {
      value: { ensureImage },
    });
    Object.defineProperty(service, 'docker', {
      value: {
        getImage,
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw Object.assign(new Error('No such container'), {
              statusCode: 404,
            });
          }),
        })),
        getVolume: jest.fn(() => ({
          inspect: jest.fn(async () => ({})),
        })),
        createVolume: jest.fn(async () => ({})),
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    await expect(
      (service as unknown as WorkerService).createContainerWorker(
        EWorkerImage.baileys,
        'worker-1',
        'account-1',
        false,
        undefined,
        undefined,
        undefined,
        { workerTypeId: 'worker-type-baileys' },
        'warm-warm-pool-1',
        {
          imageContentId: TEST_IMAGE_CONTENT_ID,
          requireExistingVolume: true,
          requireContainerNameAvailable: true,
        }
      )
    ).resolves.toBe('container-pinned-a');

    expect(ensureImage).not.toHaveBeenCalled();
    expect(getImage).toHaveBeenCalledTimes(1);
    expect(getImage).toHaveBeenCalledWith(TEST_IMAGE_CONTENT_ID);
    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: TEST_IMAGE_CONTENT_ID,
      })
    );
  });

  it('keeps the logical alias when Docker Config.Image is content-addressed', async () => {
    const service = makeService();
    const containerId = 'c'.repeat(64);
    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => ({
            Id: containerId,
            Name: '/worker-1',
            Image: TEST_IMAGE_CONTENT_ID,
            State: {
              Running: true,
              Status: 'running',
            },
            Config: {
              Image: TEST_IMAGE_CONTENT_ID,
              Env: [`WORKER_IMAGE=${EWorkerImage.baileys}`],
              Labels: {
                'underchat.worker_image': EWorkerImage.baileys,
                'underchat.worker_image_content_id': TEST_IMAGE_CONTENT_ID,
                'underchat.resource_policy': 'v2',
                'underchat.resource_profile': 'active',
                'underchat.resource_memory_bytes': '1610612736',
                'underchat.resource_memory_reservation_bytes': '805306368',
                'underchat.resource_memory_swap_bytes': '1610612736',
                'underchat.resource_nano_cpus': '1500000000',
                'underchat.resource_oom_kill_disable': 'false',
                'underchat.resource_oom_score_adj': '250',
                'underchat.resource_pids_limit': '512',
              },
            },
          })),
        })),
      },
    });

    await expect(
      (service as unknown as WorkerService).inspectContainerWorkerByIdStrict(
        'worker-1'
      )
    ).resolves.toEqual(
      expect.objectContaining({
        exists: true,
        container_id: containerId,
        container_image: EWorkerImage.baileys,
        container_image_reference: TEST_IMAGE_CONTENT_ID,
        container_image_id: TEST_IMAGE_CONTENT_ID,
        container_labels: expect.objectContaining({
          'underchat.resource_policy': 'v2',
          'underchat.resource_profile': 'active',
          'underchat.worker_image_content_id': TEST_IMAGE_CONTENT_ID,
          'underchat.resource_memory_bytes': '1610612736',
          'underchat.resource_memory_reservation_bytes': '805306368',
          'underchat.resource_memory_swap_bytes': '1610612736',
          'underchat.resource_nano_cpus': '1500000000',
          'underchat.resource_oom_kill_disable': 'false',
          'underchat.resource_oom_score_adj': '250',
          'underchat.resource_pids_limit': '512',
        }),
      })
    );
  });

  it('fails closed on Docker inspection errors when an existing session volume is required', async () => {
    const service = makeService();
    const remove = jest.fn(async () => undefined);
    const createVolume = jest.fn(async () => ({}));
    const createContainer = jest.fn(async () => ({
      id: 'container-new',
      start: jest.fn(async () => undefined),
    }));
    const daemonError = Object.assign(new Error('docker daemon unavailable'), {
      statusCode: 500,
    });
    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => ({
            Id: 'container-existing',
            Name: '/worker-1',
            State: { Running: true, Status: 'running' },
            Config: { Env: [], Labels: {} },
          })),
          remove,
        })),
        getVolume: jest.fn(() => ({
          inspect: jest.fn(async () => {
            throw daemonError;
          }),
        })),
        createVolume,
        createContainer,
      },
    });

    await expect(
      (service as unknown as WorkerService).createContainerWorker(
        EWorkerImage.wwebjs,
        'worker-1',
        'account-1',
        false,
        undefined,
        undefined,
        undefined,
        { runtimeGeneration: 7 },
        'preserved-session-volume',
        { requireExistingVolume: true }
      )
    ).rejects.toBe(daemonError);

    expect(remove).not.toHaveBeenCalled();
    expect(createVolume).not.toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
  });

  it('does not re-inspect a required session volume after removing the serving container', async () => {
    const service = makeService();
    let servingContainerRemoved = false;
    const remove = jest.fn(async () => {
      servingContainerRemoved = true;
    });
    const inspectVolume = jest.fn(async () => {
      if (servingContainerRemoved) {
        throw new Error('docker daemon became unavailable after removal');
      }
      return {};
    });
    const start = jest.fn(async () => undefined);
    const createContainer = jest.fn(async () => ({
      id: 'container-new',
      start,
    }));

    Object.defineProperty(service, 'docker', {
      value: {
        getContainer: jest.fn(() => ({
          inspect: jest.fn(async () => ({
            Id: 'container-existing',
            Name: '/worker-1',
            State: { Running: true, Status: 'running' },
            Config: { Env: [], Labels: {} },
          })),
          remove,
        })),
        getVolume: jest.fn(() => ({ inspect: inspectVolume })),
        createVolume: jest.fn(async () => ({})),
        createContainer,
        info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
        listContainers: jest.fn(async () => []),
      },
    });

    await expect(
      (service as unknown as WorkerService).createContainerWorker(
        EWorkerImage.wwebjs,
        'worker-1',
        'account-1',
        false,
        undefined,
        undefined,
        undefined,
        { runtimeGeneration: 7 },
        'preserved-session-volume',
        { requireExistingVolume: true }
      )
    ).resolves.toBe('container-new');

    expect(inspectVolume).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(createContainer).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('revokes a stale runtime fence even when an idempotent delete finds the worker already deleted', async () => {
    const service = makeService() as unknown as {
      deleteWorkerById: WorkerService['deleteWorkerById'];
      workerDeleterRepository: {
        deleteWorkerById: jest.Mock<Promise<boolean>, [string, string]>;
      };
      redis: {
        eval: jest.Mock<Promise<number>, unknown[]>;
        get: jest.Mock<Promise<string>, unknown[]>;
      };
    };
    service.workerDeleterRepository = {
      deleteWorkerById: jest.fn(
        async (_accountId: string, _workerId: string) => false
      ),
    };
    service.redis = {
      eval: jest.fn(async () => 1),
      get: jest.fn(async () =>
        JSON.stringify({
          state: 'revoked',
          worker_id: 'worker-1',
          revoked_at: Date.now(),
        })
      ),
    };

    await expect(
      service.deleteWorkerById('account-1', 'worker-1')
    ).resolves.toBe(false);
    expect(
      service.workerDeleterRepository.deleteWorkerById
    ).toHaveBeenCalledWith('account-1', 'worker-1');
    expect(service.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('state = incoming_state'),
      4,
      'whatsapp:runtime-fence:v1:worker-1',
      'whatsapp:runtime-fence:v1:worker-1:activation-lock',
      'whatsapp:runtime-fence:v1:worker-1:effect-leases',
      'whatsapp:runtime-fence:v1:worker-1:effect-lease-owners',
      'worker-1',
      'revoked',
      '',
      ''
    );
  });

  it('reports only authoritative running containers whose immutable image is stale', async () => {
    const previousServerId = process.env.SERVER_ID;
    const serverId = '019e98ad-aab4-715d-aa6b-9e0e027edc24';
    const accountId = '019fa877-2825-741a-a3b2-2b48fdd47ac0';
    const staleWorkerId = '019fa877-9f95-7518-9753-3f4e32569dee';
    const currentWorkerId = '019fa878-3387-769c-bee0-a442f6a3cbd9';
    const expectedContentId = `sha256:${'b'.repeat(64)}`;
    const staleContentId = `sha256:${'c'.repeat(64)}`;
    const baseLabels = {
      'underchat.account_id': accountId,
      'underchat.runtime_generation': '7',
      'underchat.server_id': serverId,
      'underchat.warm_standby': 'false',
      'underchat.worker_image': EWorkerImage.baileys,
    };
    const service = makeService();
    const listContainers = jest.fn(async () => [
      {
        Id: '1'.repeat(64),
        ImageID: staleContentId,
        Labels: {
          ...baseLabels,
          'underchat.worker_id': staleWorkerId,
        },
      },
      {
        Id: '2'.repeat(64),
        ImageID: expectedContentId,
        Labels: {
          ...baseLabels,
          'underchat.worker_id': currentWorkerId,
        },
      },
      {
        Id: '3'.repeat(64),
        ImageID: staleContentId,
        Labels: {
          ...baseLabels,
          'underchat.warm_standby': 'true',
          'underchat.worker_id': '019fa878-3387-769c-bee0-a442f6a3cbd8',
        },
      },
      {
        Id: '4'.repeat(64),
        ImageID: staleContentId,
        Labels: {
          ...baseLabels,
          'underchat.server_id': '019e98ad-aab4-715d-aa6b-9e0e027edc25',
          'underchat.worker_id': '019fa878-3387-769c-bee0-a442f6a3cbd7',
        },
      },
    ]);
    Object.defineProperty(service, 'docker', {
      configurable: true,
      value: { listContainers },
    });

    try {
      process.env.SERVER_ID = serverId;
      await expect(
        (service as unknown as WorkerService).listActiveWorkerImageDrifts({
          [EWorkerImage.baileys]: expectedContentId,
        })
      ).resolves.toEqual([
        {
          account_id: accountId,
          alias: EWorkerImage.baileys,
          container_id: '1'.repeat(64),
          current_content_id: staleContentId,
          expected_content_id: expectedContentId,
          runtime_generation: 7,
          server_id: serverId,
          worker_id: staleWorkerId,
        },
      ]);
    } finally {
      restoreEnv('SERVER_ID', previousServerId);
    }
  });

  it('finds legacy WWebJS safety drift with absent server/lifecycle labels and rejects malformed identity', async () => {
    const previousServerId = process.env.SERVER_ID;
    const serverId = '019e98ad-aab4-715d-aa6b-9e0e027edc24';
    const accountId = '019fa877-2825-741a-a3b2-2b48fdd47ac0';
    const legacyWorkerId = '019fa877-9f95-7518-9753-3f4e32569dee';
    const malformedWorkerId = '019fa878-3387-769c-bee0-a442f6a3cbd9';
    const legacyContainerId = '1'.repeat(64);
    const malformedContainerId = '2'.repeat(64);
    const expectedContentId = `sha256:${'b'.repeat(64)}`;
    const staleContentId = `sha256:${'c'.repeat(64)}`;
    const sessionVolumeName = 'session-legacy-wwebjs';
    const containerLabels = (workerId: string) => ({
      'underchat.account_id': accountId,
      'underchat.runtime_generation': '7',
      'underchat.session_volume_name': sessionVolumeName,
      'underchat.warm_standby': 'false',
      'underchat.worker_id': workerId,
      'underchat.worker_image': EWorkerImage.wwebjs,
      'underchat.worker_type_id': EWorkerType.wwebjs,
    });
    const inspectContainer = (workerId: string, containerId: string) => ({
      Id: containerId,
      Image: staleContentId,
      Name: `/${workerId}`,
      State: {
        Running: true,
        Status: 'running',
      },
      Config: {
        Image: EWorkerImage.wwebjs,
        Entrypoint: ['docker-entrypoint.sh'],
        Env: [
          `WORKER_ID=${workerId}`,
          `ACCOUNT_ID=${
            workerId === malformedWorkerId ? 'wrong-account' : accountId
          }`,
          `WORKER_TYPE_ID=${EWorkerType.wwebjs}`,
          `WORKER_IMAGE=${EWorkerImage.wwebjs}`,
          'RUNTIME_GENERATION=7',
          `SESSION_VOLUME_NAME=${sessionVolumeName}`,
          'WARM_STANDBY=false',
        ],
        Labels: containerLabels(workerId),
      },
      HostConfig: {
        PidsLimit: null,
      },
      Mounts: [
        {
          Destination: '/app/data',
          Name: sessionVolumeName,
          RW: true,
          Type: 'volume',
        },
      ],
    });
    const inspections = new Map([
      [legacyContainerId, inspectContainer(legacyWorkerId, legacyContainerId)],
      [
        malformedContainerId,
        inspectContainer(malformedWorkerId, malformedContainerId),
      ],
    ]);
    const service = makeService();
    Object.defineProperty(service, 'docker', {
      configurable: true,
      value: {
        listContainers: jest.fn(async () => [
          {
            Id: legacyContainerId,
            ImageID: staleContentId,
            Labels: containerLabels(legacyWorkerId),
          },
          {
            Id: malformedContainerId,
            ImageID: staleContentId,
            Labels: containerLabels(malformedWorkerId),
          },
        ]),
        getContainer: jest.fn((containerId: string) => ({
          inspect: jest.fn(async () => inspections.get(containerId)),
        })),
      },
    });

    try {
      process.env.SERVER_ID = serverId;
      await expect(
        (
          service as unknown as WorkerService
        ).listActiveWwebjsRuntimeSafetyDrifts(expectedContentId)
      ).resolves.toEqual([
        {
          account_id: accountId,
          alias: EWorkerImage.wwebjs,
          container_id: legacyContainerId,
          current_content_id: staleContentId,
          expected_content_id: expectedContentId,
          runtime_generation: 7,
          safety_reasons: [
            'image_mismatch',
            'tini_missing',
            'pids_limit_missing',
          ],
          server_id: serverId,
          worker_id: legacyWorkerId,
        },
      ]);
    } finally {
      restoreEnv('SERVER_ID', previousServerId);
    }
  });
});

describe('WorkerService container environment integrity', () => {
  const debugKey = 'WHATSAPP_SESSION_DEBUG_ENABLED';
  const lifecycleDebugKey = 'CONNECTION_LIFECYCLE_DEBUG_ENABLED';
  const originalDebug = process.env[debugKey];
  const originalLifecycleDebug = process.env[lifecycleDebugKey];

  afterEach(() => {
    restoreEnv(debugKey, originalDebug);
    restoreEnv(lifecycleDebugKey, originalLifecycleDebug);
    jest.restoreAllMocks();
  });

  it('normalizes strict debug booleans before injecting a worker', () => {
    process.env[debugKey] = ' TRUE ';
    process.env[lifecycleDebugKey] = 'False';

    const env = envArrayToMap(
      makeService().buildContainerEnv(['WORKER_ID=worker-1'])
    );

    expect(env.get(debugKey)).toBe('true');
    expect(env.get(lifecycleDebugKey)).toBe('false');
  });

  it('recovers a concatenated debug boolean without propagating its suffix', () => {
    process.env[debugKey] = 'trueDB_HOST_RW=postgres-primary.internal';
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const containerEnv = makeService().buildContainerEnv([
      'WORKER_ID=worker-1',
    ]);
    const env = envArrayToMap(containerEnv);

    expect(env.get(debugKey)).toBe('true');
    expect(env.has('DB_HOST_RW')).toBe(false);
    expect(containerEnv).not.toEqual(
      expect.arrayContaining([expect.stringContaining('postgres-primary')])
    );
    expect(warn).toHaveBeenCalledWith(
      '[worker-container-env]',
      JSON.stringify({
        event: 'worker.container_env.malformed_boolean_recovered',
        environment_key: debugKey,
        discarded_environment_key: 'DB_HOST_RW',
        action: 'discarded_concatenated_suffix',
      })
    );
    expect(warn.mock.calls.flat().join(' ')).not.toContain(
      'postgres-primary.internal'
    );
  });

  it('rejects invalid booleans and control-character injection', () => {
    process.env[debugKey] = 'enabled';
    expect(() =>
      makeService().buildContainerEnv(['WORKER_ID=worker-1'])
    ).toThrow(`worker_container_env_value_invalid:${debugKey}`);

    delete process.env[debugKey];
    expect(() =>
      makeService().buildContainerEnv([
        'PROXY_HOST=proxy.internal\nWORKER_ID=forged-worker',
      ])
    ).toThrow('worker_container_env_value_invalid:PROXY_HOST');
  });
});

describe('WorkerService optional provider auxiliary timeout env', () => {
  const key = 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS';
  const originalValue = process.env[key];

  afterEach(() => {
    restoreEnv(key, originalValue);
  });

  it('boots a worker without injecting the optional timeout override', () => {
    delete process.env[key];

    const env = envArrayToMap(
      makeService().buildContainerEnv(['WORKER_ID=worker-with-defaults'])
    );

    expect(env.has(key)).toBe(false);
  });

  it('inherits the timeout only when an operator explicitly configures it', () => {
    process.env[key] = '12000';

    const env = envArrayToMap(
      makeService().buildContainerEnv(['WORKER_ID=worker-with-override'])
    );

    expect(env.get(key)).toBe('12000');
  });
});
