import {
  BLOCKED_ACCOUNT_STATUS_ID,
  DELETING_WORKER_STATUS_ID,
  PROTECTED_WORKER_KAFKA_CLEANUP_DISABLED,
  buildWorkerTopicNames,
  classifyWorkerDatabaseRow,
  databaseAuthorityFingerprint,
  parseArgs,
  resolveDatabaseConfig,
  runCleanup,
  type DatabaseAuthority,
  type KafkaCleanupOptions,
  type WorkerDatabaseRow,
} from '../../../../scripts/kafka-clean-dead-resources';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKER_ID = '019e4c0a-a74d-734e-8f30-5ecd1908ded8';
const ACCOUNT_ID = '019a930d-c6f4-75ad-88ff-8d2fcd5839e1';
const OPERATION_ID = '019e4c0a-a74d-734e-8f30-5ecd1908ded9';
const GROUP_ID = `group-underchat-whatsmeow-send-${WORKER_ID}`;

const authorityIdentity: Omit<DatabaseAuthority, 'fingerprint'> = {
  transaction_read_only: 'off',
  pg_is_in_recovery: false,
  database: 'underchat',
  server_address: '10.0.0.10',
  server_port: 5432,
  user: 'underchat_finalizer',
  database_oid: '16384',
  server_version_num: '170005',
};
const authority: DatabaseAuthority = {
  ...authorityIdentity,
  fingerprint: databaseAuthorityFingerprint(authorityIdentity),
};

const workerRow = (
  overrides: Partial<WorkerDatabaseRow> = {}
): WorkerDatabaseRow => ({
  requested_worker_id: WORKER_ID,
  worker_id: WORKER_ID,
  worker_account_id: ACCOUNT_ID,
  worker_deleted_at: null,
  worker_status_id: null,
  worker_lifecycle_operation_id: null,
  account_id: ACCOUNT_ID,
  account_status_id: null,
  account_deleted_at: null,
  plan_account_id: '019e4c0a-a74d-734e-8f30-5ecd1908deda',
  next_payment_date: '2099-01-01T00:00:00.000Z',
  cancellation_date: null,
  ...overrides,
});

const tombstone = (
  overrides: Partial<WorkerDatabaseRow> = {}
): WorkerDatabaseRow =>
  workerRow({
    worker_deleted_at: '2026-07-27T00:00:00.000Z',
    worker_status_id: DELETING_WORKER_STATUS_ID,
    worker_lifecycle_operation_id: OPERATION_ID,
    ...overrides,
  });

const options = (
  overrides: Partial<KafkaCleanupOptions> = {}
): KafkaCleanupOptions => ({
  execute: false,
  topicsOnly: false,
  groupsOnly: false,
  batchSize: 1,
  workerIds: [WORKER_ID],
  accountIds: [ACCOUNT_ID],
  now: new Date('2026-07-27T00:00:00.000Z'),
  confirmedDatabaseFingerprint: authority.fingerprint,
  allowedDatabaseFingerprints: [authority.fingerprint],
  confirmationTimeoutMs: 1,
  confirmationPollIntervalMs: 1,
  ...overrides,
});

const kafkaGateway = (
  initialTopics = [buildWorkerTopicNames(WORKER_ID)[0]]
) => ({
  listTopics: jest
    .fn<Promise<string[]>, []>()
    .mockResolvedValueOnce(initialTopics)
    .mockResolvedValue([]),
  listConsumerGroups: jest.fn(async () => [] as string[]),
  deleteTopic: jest.fn<Promise<void>, [string]>(async () => undefined),
  deleteConsumerGroup: jest.fn<Promise<void>, [string]>(async () => undefined),
});

const repository = (rows: WorkerDatabaseRow[] = [tombstone()]) => ({
  findWorkers: jest.fn(async () => rows),
  assertAuthoritativePrimary: jest.fn(async () => authority),
  readAuthoritativeWorkerSnapshot: jest.fn(async () => ({
    authority,
    rows,
  })),
});

const proofRepository = () => ({
  assert: jest.fn(async () => undefined),
});

describe('kafka dead resource cleaner permanent deletion guard', () => {
  it.each([
    [
      'missing worker',
      workerRow({
        worker_id: null,
        worker_account_id: null,
      }),
    ],
    [
      'blocked account',
      workerRow({
        account_status_id: BLOCKED_ACCOUNT_STATUS_ID,
      }),
    ],
    [
      'expired plan',
      workerRow({
        next_payment_date: '2020-01-01T00:00:00.000Z',
      }),
    ],
    [
      'deleted worker without lifecycle proof',
      workerRow({
        worker_deleted_at: '2026-07-27T00:00:00.000Z',
      }),
    ],
    [
      'tombstone that is no longer deleting',
      tombstone({ worker_status_id: null }),
    ],
  ])('does not authorize queue deletion for %s', (_name, row) => {
    expect(classifyWorkerDatabaseRow(row)).toMatchObject({
      isDead: false,
      reason: null,
    });
  });

  it('authorizes only a deleting tombstone with its lifecycle operation', () => {
    expect(classifyWorkerDatabaseRow(tombstone())).toMatchObject({
      isDead: true,
      reason: 'worker_permanently_deleted',
      accountId: ACCOUNT_ID,
      workerDeletedAt: '2026-07-27T00:00:00.000Z',
      lifecycleOperationId: OPERATION_ID,
    });
  });

  it('refuses programmatic execution without explicit worker and account scopes', async () => {
    const kafka = kafkaGateway([]);
    const workerRepository = repository([]);
    const deletionProofRepository = proofRepository();

    await expect(
      runCleanup(
        { kafka, workerRepository, deletionProofRepository },
        options({ execute: true, workerIds: [] })
      )
    ).rejects.toThrow('execute_requires_explicit_worker_ids');
    await expect(
      runCleanup(
        { kafka, workerRepository, deletionProofRepository },
        options({ execute: true, accountIds: [] })
      )
    ).rejects.toThrow('execute_requires_explicit_account_ids');

    expect(kafka.listTopics).not.toHaveBeenCalled();
    expect(kafka.deleteTopic).not.toHaveBeenCalled();
  });

  it('requires the immutable proof repository before any Kafka read', async () => {
    const kafka = kafkaGateway();
    await expect(
      runCleanup(
        { kafka, workerRepository: repository() },
        options({ execute: true })
      )
    ).rejects.toThrow('execute_requires_immutable_deletion_proof_repository');
    expect(kafka.listTopics).not.toHaveBeenCalled();
  });

  it.each([
    ['topics and groups', false, false],
    ['topics only', true, false],
    ['groups only', false, true],
  ])(
    'hard-disables protected worker mutation for %s',
    async (_name, topicsOnly, groupsOnly) => {
      const kafka = kafkaGateway();
      kafka.listConsumerGroups.mockResolvedValue([GROUP_ID]);
      const workerRepository = repository();
      const deletionProofRepository = proofRepository();

      await expect(
        runCleanup(
          { kafka, workerRepository, deletionProofRepository },
          options({ execute: true, topicsOnly, groupsOnly })
        )
      ).rejects.toThrow(PROTECTED_WORKER_KAFKA_CLEANUP_DISABLED);

      expect(
        workerRepository.assertAuthoritativePrimary
      ).not.toHaveBeenCalled();
      expect(workerRepository.findWorkers).not.toHaveBeenCalled();
      expect(deletionProofRepository.assert).not.toHaveBeenCalled();
      expect(kafka.listTopics).not.toHaveBeenCalled();
      expect(kafka.listConsumerGroups).not.toHaveBeenCalled();
      expect(kafka.deleteTopic).not.toHaveBeenCalled();
      expect(kafka.deleteConsumerGroup).not.toHaveBeenCalled();
    }
  );

  it('marks dry-run candidates unavailable when immutable proof cannot be read', async () => {
    const report = await runCleanup(
      {
        kafka: kafkaGateway(),
        workerRepository: repository(),
      },
      options()
    );

    expect(report.candidates).toEqual([]);
    expect(report.skipped.proof_unavailable_worker_ids).toEqual([WORKER_ID]);
  });
});

describe('kafka dead resource cleaner database configuration', () => {
  const databaseEnvironmentKeys = [
    'UNDERCHAT_ENV_SCOPE',
    'DB_PUBLIC_HOST_RO',
    'DB_PRIVATE_HOST_RO',
    'DB_HOST_RO',
    'DB_PUBLIC_PORT_RO',
    'DB_PRIVATE_PORT_RO',
    'DB_PORT_RO',
    'DB_PUBLIC_HOST_RW',
    'DB_PRIVATE_HOST_RW',
    'DB_HOST_RW',
    'DB_PUBLIC_PORT_RW',
    'DB_PRIVATE_PORT_RW',
    'DB_PORT_RW',
    'DB_USER',
    'DB_PASSWORD',
    'DB_DATABASE',
    'DB_SSLMODE',
  ] as const;
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of databaseEnvironmentKeys) {
      originalEnvironment.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.UNDERCHAT_ENV_SCOPE = 'public';
    process.env.DB_PUBLIC_HOST_RO = 'readonly.database.internal';
    process.env.DB_PUBLIC_PORT_RO = '5433';
    process.env.DB_PUBLIC_HOST_RW = 'primary.database.internal';
    process.env.DB_PUBLIC_PORT_RW = '5434';
    process.env.DB_USER = 'cleaner';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_DATABASE = 'underchat';
    process.env.DB_SSLMODE = 'disable';
  });

  afterEach(() => {
    for (const key of databaseEnvironmentKeys) {
      const original = originalEnvironment.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    originalEnvironment.clear();
  });

  it('uses the discrete readonly endpoint for dry-run', () => {
    const config = resolveDatabaseConfig({ execute: false });

    expect(config.identity).toBe('readonly.database.internal:5433/underchat');
    expect(config.poolConfig).toMatchObject({
      host: 'readonly.database.internal',
      port: 5433,
      user: 'cleaner',
      password: 'secret',
      database: 'underchat',
      ssl: false,
    });
    expect(config.poolConfig).not.toHaveProperty('connectionString');
  });

  it('uses the discrete read-write endpoint for execute', () => {
    const config = resolveDatabaseConfig({ execute: true });

    expect(config.identity).toBe('primary.database.internal:5434/underchat');
    expect(config.poolConfig).toMatchObject({
      host: 'primary.database.internal',
      port: 5434,
      user: 'cleaner',
      password: 'secret',
      database: 'underchat',
      ssl: false,
    });
    expect(config.poolConfig).not.toHaveProperty('connectionString');
  });

  it.each([
    'DB_PUBLIC_HOST_RO',
    'DB_PUBLIC_PORT_RO',
    'DB_USER',
    'DB_PASSWORD',
    'DB_DATABASE',
    'DB_SSLMODE',
  ] as const)('requires discrete database setting %s', (key) => {
    delete process.env[key];

    expect(() => resolveDatabaseConfig({ execute: false })).toThrow(
      'Database config is missing'
    );
  });

  it('rejects the removed composed-url CLI override', () => {
    expect(() =>
      parseArgs(['--database-url', 'postgresql://ignored.invalid/underchat'])
    ).toThrow('Unknown argument: --database-url');
  });

  it('contains no composed database URL lookup or CLI fallback', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/kafka-clean-dead-resources.ts'),
      'utf8'
    );

    expect(source).not.toContain('DB_PUBLIC_DATABASE_URL');
    expect(source).not.toContain('DB_PRIVATE_DATABASE_URL');
    expect(source).not.toContain('DB_DATABASE_URL');
    expect(source).not.toContain('--database-url <url>');
  });
});
