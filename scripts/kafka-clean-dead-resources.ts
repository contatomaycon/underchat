import dotenv from 'dotenv';
import { Kafka, logLevel, type Admin, type KafkaConfig } from 'kafkajs';
import { Pool, type PoolConfig } from 'pg';
import path from 'node:path';

dotenv.config({ quiet: true });

export const DELETE_CONFIRMATION_TOKEN = 'DELETE_DEAD_KAFKA_RESOURCES';
export const BLOCKED_ACCOUNT_STATUS_ID = '019a930d-c6f4-75ad-88ff-75403daff4e1';

const WORKER_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKER_UUID_IN_TEXT_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const WORKER_TOPIC_SUFFIXES = [
  'send.message',
  'schedule.send.message',
  'validate.phone',
  'notification.message',
  'webhook.integration',
] as const;

const WORKER_CONSUMER_GROUP_PREFIXES = [
  'group-underchat-whatsmeow-send-',
  'group-underchat-schedule-message-whatsmeow-',
  'group-underchat-whatsmeow-validate-phone-',
  'group-underchat-whatsmeow-notification-send-',
  'group-underchat-webhook-integration-whatsmeow-',
  'group-underchat-mark-read-whatsmeow-',
  'group-underchat-worker-config-update-whatsmeow-',
  'group-underchat-baileys-send-',
  'group-underchat-wwebjs-send-',
  'group-underchat-schedule-message-',
  'group-underchat-schedule-message-wwebjs-',
  'group-underchat-baileys-validate-phone-',
  'group-underchat-wwebjs-validate-phone-',
  'group-underchat-baileys-notification-send-',
  'group-underchat-wwebjs-notification-send-',
  'group-underchat-webhook-integration-',
  'group-underchat-webhook-integration-wwebjs-',
  'group-underchat-mark-read-',
  'group-underchat-mark-read-wwebjs-',
  'group-underchat-worker-config-update-',
  'group-underchat-worker-config-update-wwebjs-',
] as const;

type WorkerTopicSuffix = (typeof WORKER_TOPIC_SUFFIXES)[number];

export interface ParsedWorkerTopic {
  topic: string;
  workerId: string;
  suffix: WorkerTopicSuffix;
}

export interface ParsedWorkerConsumerGroup {
  groupId: string;
  workerId: string;
  prefix: string;
}

export type DeadWorkerReason =
  | 'worker_not_found'
  | 'account_not_found'
  | 'account_deleted'
  | 'account_blocked'
  | 'plan_not_found'
  | 'plan_next_payment_missing'
  | 'plan_next_payment_invalid'
  | 'plan_expired';

export interface WorkerDatabaseRow {
  requested_worker_id: string;
  worker_id: string | null;
  worker_account_id: string | null;
  worker_deleted_at: Date | string | null;
  account_id: string | null;
  account_status_id: string | null;
  account_deleted_at: Date | string | null;
  plan_account_id: string | null;
  next_payment_date: Date | string | null;
  cancellation_date: Date | string | null;
}

export interface WorkerClassification {
  workerId: string;
  accountId: string | null;
  isDead: boolean;
  reason: DeadWorkerReason | null;
  workerExists: boolean;
  accountExists: boolean;
  accountStatusId: string | null;
  accountDeletedAt: string | null;
  planAccountId: string | null;
  nextPaymentDate: string | null;
  cancellationDate: string | null;
}

export interface KafkaCleanupOptions {
  execute: boolean;
  topicsOnly: boolean;
  groupsOnly: boolean;
  limit?: number;
  batchSize: number;
  workerIds: string[];
  accountIds: string[];
  now?: Date;
}

export interface KafkaAdminGateway {
  listTopics(): Promise<string[]>;
  listConsumerGroups(): Promise<string[]>;
  deleteTopic(topic: string): Promise<void>;
  deleteConsumerGroup(groupId: string): Promise<void>;
}

export interface WorkerStateRepository {
  findWorkers(workerIds: string[]): Promise<WorkerDatabaseRow[]>;
}

export interface CleanupCandidate {
  worker_id: string;
  account_id: string | null;
  reason: DeadWorkerReason;
  topics: string[];
  consumer_groups: string[];
}

export interface ResourceOperationResult {
  type: 'topic' | 'consumer_group';
  name: string;
  worker_id: string;
  status: 'planned' | 'deleted' | 'already_missing' | 'failed';
  error?: string;
}

export interface CleanupReport {
  mode: 'dry-run' | 'execute';
  started_at: string;
  finished_at: string;
  duration_ms: number;
  options: {
    limit: number | null;
    batch_size: number;
    topics_only: boolean;
    groups_only: boolean;
    worker_ids: string[];
    account_ids: string[];
  };
  scanned: {
    topics_total: number;
    consumer_groups_total: number;
    worker_topics_matched: number;
    worker_consumer_groups_matched: number;
    worker_ids_checked: number;
  };
  skipped: {
    unmatched_worker_topics: string[];
    unmatched_worker_consumer_groups: string[];
    active_workers: WorkerClassification[];
    filtered_by_account: WorkerClassification[];
    dead_workers_without_resources: WorkerClassification[];
    limited_worker_ids: string[];
  };
  candidates: CleanupCandidate[];
  operations: {
    planned: ResourceOperationResult[];
    succeeded: ResourceOperationResult[];
    failed: ResourceOperationResult[];
  };
}

interface CliOptions extends KafkaCleanupOptions {
  help: boolean;
  dryRun: boolean;
  confirm?: string;
  confirmBroker?: string;
  confirmDatabase?: string;
  broker?: string;
  databaseUrl?: string;
}

interface RuntimeConfig {
  kafka: {
    brokers: string[];
    identity: string;
    config: KafkaConfig;
  };
  database: {
    identity: string;
    poolConfig: PoolConfig;
    safe: {
      host: string;
      port: number;
      database: string;
      user: string | null;
      source: string;
    };
  };
}

export function isUuid(value: string): boolean {
  return WORKER_UUID_PATTERN.test(value);
}

export function parseWorkerTopic(topic: string): ParsedWorkerTopic | null {
  if (!topic.startsWith('worker.')) {
    return null;
  }

  for (const suffix of WORKER_TOPIC_SUFFIXES) {
    const ending = `.${suffix}`;
    if (!topic.endsWith(ending)) {
      continue;
    }

    const workerId = topic.slice('worker.'.length, -ending.length);
    if (!isUuid(workerId)) {
      continue;
    }

    const exactTopic = buildWorkerTopicName(workerId, suffix);
    if (topic !== exactTopic) {
      continue;
    }

    return { topic, workerId, suffix };
  }

  return null;
}

export function buildWorkerTopicName(
  workerId: string,
  suffix: WorkerTopicSuffix
): string {
  return `worker.${workerId}.${suffix}`;
}

export function buildWorkerTopicNames(workerId: string): string[] {
  return WORKER_TOPIC_SUFFIXES.map((suffix) =>
    buildWorkerTopicName(workerId, suffix)
  );
}

export function parseWorkerConsumerGroup(
  groupId: string
): ParsedWorkerConsumerGroup | null {
  for (const prefix of WORKER_CONSUMER_GROUP_PREFIXES) {
    if (!groupId.startsWith(prefix)) {
      continue;
    }

    const workerId = groupId.slice(prefix.length);
    if (!isUuid(workerId)) {
      continue;
    }

    return { groupId, workerId, prefix };
  }

  return null;
}

export function buildWorkerConsumerGroupNames(workerId: string): string[] {
  return Array.from(
    new Set(
      WORKER_CONSUMER_GROUP_PREFIXES.map((prefix) => `${prefix}${workerId}`)
    )
  );
}

export function classifyWorkerDatabaseRow(
  row: WorkerDatabaseRow,
  now = new Date()
): WorkerClassification {
  const workerId = row.requested_worker_id;
  const accountId = row.account_id ?? row.worker_account_id;
  const nextPaymentDate = normalizeDate(row.next_payment_date);

  const base = {
    workerId,
    accountId,
    accountStatusId: row.account_status_id,
    accountDeletedAt: normalizeDate(row.account_deleted_at),
    planAccountId: row.plan_account_id,
    nextPaymentDate,
    cancellationDate: normalizeDate(row.cancellation_date),
    workerExists: row.worker_id !== null,
    accountExists: row.account_id !== null,
  };

  if (!row.worker_id) {
    return dead(base, 'worker_not_found');
  }

  if (!row.account_id) {
    return dead(base, 'account_not_found');
  }

  if (row.account_deleted_at) {
    return dead(base, 'account_deleted');
  }

  if (row.account_status_id === BLOCKED_ACCOUNT_STATUS_ID) {
    return dead(base, 'account_blocked');
  }

  if (!row.plan_account_id) {
    return dead(base, 'plan_not_found');
  }

  if (!row.next_payment_date) {
    return dead(base, 'plan_next_payment_missing');
  }

  const parsedNextPaymentDate = toDate(row.next_payment_date);
  if (!parsedNextPaymentDate) {
    return dead(base, 'plan_next_payment_invalid');
  }

  if (parsedNextPaymentDate.getTime() <= now.getTime()) {
    return dead(base, 'plan_expired');
  }

  return {
    ...base,
    isDead: false,
    reason: null,
  };
}

export async function runCleanup(
  deps: {
    kafka: KafkaAdminGateway;
    workerRepository: WorkerStateRepository;
  },
  options: KafkaCleanupOptions
): Promise<CleanupReport> {
  const startedAt = new Date();
  const now = options.now ?? startedAt;
  const topics = options.groupsOnly ? [] : await deps.kafka.listTopics();
  const consumerGroups = options.topicsOnly
    ? []
    : await deps.kafka.listConsumerGroups();

  const {
    byWorkerId: topicsByWorkerId,
    unmatchedWorkerLikeResources: unmatchedWorkerTopics,
  } = collectMatchedResources(topics, parseWorkerTopic, (resource) =>
    resource.startsWith('worker.')
  );
  const {
    byWorkerId: consumerGroupsByWorkerId,
    unmatchedWorkerLikeResources: unmatchedWorkerConsumerGroups,
  } = collectMatchedResources(
    consumerGroups,
    parseWorkerConsumerGroup,
    (resource) =>
      resource.startsWith('group-underchat-') &&
      WORKER_UUID_IN_TEXT_PATTERN.test(resource)
  );

  const requestedWorkerIds = new Set<string>(options.workerIds);
  const workerIdsToCheck = Array.from(
    new Set([
      ...topicsByWorkerId.keys(),
      ...consumerGroupsByWorkerId.keys(),
      ...requestedWorkerIds,
    ])
  )
    .filter((workerId) =>
      requestedWorkerIds.size > 0 ? requestedWorkerIds.has(workerId) : true
    )
    .sort();

  const rows = await deps.workerRepository.findWorkers(workerIdsToCheck);
  const rowsByWorkerId = new Map(
    rows.map((row) => [row.requested_worker_id, row])
  );
  const classifications = workerIdsToCheck.map((workerId) =>
    classifyWorkerDatabaseRow(
      rowsByWorkerId.get(workerId) ?? missingWorkerRow(workerId),
      now
    )
  );

  const accountFilter = new Set(options.accountIds);
  const activeWorkers: WorkerClassification[] = [];
  const filteredByAccount: WorkerClassification[] = [];
  const deadWorkersWithoutResources: WorkerClassification[] = [];
  const limitedWorkerIds: string[] = [];
  const candidates: CleanupCandidate[] = [];

  for (const classification of classifications) {
    if (!classification.isDead) {
      activeWorkers.push(classification);
      continue;
    }

    if (
      accountFilter.size > 0 &&
      (!classification.accountId ||
        !accountFilter.has(classification.accountId))
    ) {
      filteredByAccount.push(classification);
      continue;
    }

    const topicsForWorker = options.groupsOnly
      ? []
      : (topicsByWorkerId.get(classification.workerId) ?? []).map(
          (parsed) => parsed.topic
        );
    const groupsForWorker = options.topicsOnly
      ? []
      : buildWorkerConsumerGroupNames(classification.workerId).filter(
          (groupId) =>
            consumerGroupsByWorkerId
              .get(classification.workerId)
              ?.some((parsed) => parsed.groupId === groupId) ?? false
        );

    if (topicsForWorker.length === 0 && groupsForWorker.length === 0) {
      deadWorkersWithoutResources.push(classification);
      continue;
    }

    candidates.push({
      worker_id: classification.workerId,
      account_id: classification.accountId,
      reason: classification.reason as DeadWorkerReason,
      topics: topicsForWorker.sort(),
      consumer_groups: groupsForWorker.sort(),
    });
  }

  let selectedCandidates = candidates;
  if (options.limit !== undefined) {
    selectedCandidates = candidates.slice(0, options.limit);
    limitedWorkerIds.push(
      ...candidates.slice(options.limit).map((candidate) => candidate.worker_id)
    );
  }

  const planned = buildPlannedOperations(selectedCandidates);
  const succeeded: ResourceOperationResult[] = [];
  const failed: ResourceOperationResult[] = [];

  if (options.execute) {
    const topicOperations = planned.filter(
      (operation) => operation.type === 'topic'
    );
    const groupOperations = planned.filter(
      (operation) => operation.type === 'consumer_group'
    );

    await processInBatches(
      topicOperations,
      options.batchSize,
      async (operation) => {
        try {
          await deps.kafka.deleteTopic(operation.name);
          succeeded.push({ ...operation, status: 'deleted' });
        } catch (error) {
          if (isMissingTopicError(error)) {
            succeeded.push({ ...operation, status: 'already_missing' });
            return;
          }

          failed.push({
            ...operation,
            status: 'failed',
            error: formatError(error),
          });
        }
      }
    );

    await processInBatches(
      groupOperations,
      options.batchSize,
      async (operation) => {
        try {
          await deps.kafka.deleteConsumerGroup(operation.name);
          succeeded.push({ ...operation, status: 'deleted' });
        } catch (error) {
          if (isMissingConsumerGroupError(error)) {
            succeeded.push({ ...operation, status: 'already_missing' });
            return;
          }

          failed.push({
            ...operation,
            status: 'failed',
            error: formatError(error),
          });
        }
      }
    );
  }

  const finishedAt = new Date();

  return {
    mode: options.execute ? 'execute' : 'dry-run',
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    options: {
      limit: options.limit ?? null,
      batch_size: options.batchSize,
      topics_only: options.topicsOnly,
      groups_only: options.groupsOnly,
      worker_ids: [...options.workerIds].sort(),
      account_ids: [...options.accountIds].sort(),
    },
    scanned: {
      topics_total: topics.length,
      consumer_groups_total: consumerGroups.length,
      worker_topics_matched: Array.from(topicsByWorkerId.values()).reduce(
        (count, parsed) => count + parsed.length,
        0
      ),
      worker_consumer_groups_matched: Array.from(
        consumerGroupsByWorkerId.values()
      ).reduce((count, parsed) => count + parsed.length, 0),
      worker_ids_checked: workerIdsToCheck.length,
    },
    skipped: {
      unmatched_worker_topics: unmatchedWorkerTopics.sort(),
      unmatched_worker_consumer_groups: unmatchedWorkerConsumerGroups.sort(),
      active_workers: activeWorkers.sort(compareClassification),
      filtered_by_account: filteredByAccount.sort(compareClassification),
      dead_workers_without_resources: deadWorkersWithoutResources.sort(
        compareClassification
      ),
      limited_worker_ids: limitedWorkerIds.sort(),
    },
    candidates: selectedCandidates,
    operations: {
      planned,
      succeeded,
      failed,
    },
  };
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    dryRun: false,
    execute: false,
    topicsOnly: false,
    groupsOnly: false,
    batchSize: 10,
    workerIds: [],
    accountIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.includes('=')
      ? (arg.split(/=(.*)/s, 2) as [string, string])
      : [arg, undefined];

    const readValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }

      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${name}.`);
      }

      index += 1;
      return value;
    };

    switch (name) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--confirm':
        options.confirm = readValue();
        break;
      case '--confirm-broker':
        options.confirmBroker = readValue();
        break;
      case '--confirm-database':
        options.confirmDatabase = readValue();
        break;
      case '--broker':
        options.broker = readValue();
        break;
      case '--database-url':
        options.databaseUrl = readValue();
        break;
      case '--limit':
        options.limit = parsePositiveInteger(readValue(), '--limit');
        break;
      case '--batch-size':
        options.batchSize = parsePositiveInteger(readValue(), '--batch-size');
        break;
      case '--worker-id':
        options.workerIds.push(...parseUuidList(readValue(), '--worker-id'));
        break;
      case '--account-id':
        options.accountIds.push(...parseUuidList(readValue(), '--account-id'));
        break;
      case '--topics-only':
        options.topicsOnly = true;
        break;
      case '--groups-only':
        options.groupsOnly = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  if (options.execute && options.dryRun) {
    throw new Error('Use either --dry-run or --execute, not both.');
  }

  if (options.topicsOnly && options.groupsOnly) {
    throw new Error('Use either --topics-only or --groups-only, not both.');
  }

  options.workerIds = Array.from(new Set(options.workerIds)).sort();
  options.accountIds = Array.from(new Set(options.accountIds)).sort();

  return options;
}

class KafkaJsAdminGateway implements KafkaAdminGateway {
  private constructor(private readonly admin: Admin) {}

  static async connect(config: KafkaConfig): Promise<KafkaJsAdminGateway> {
    const kafka = new Kafka(config);
    const admin = kafka.admin();
    await admin.connect();
    return new KafkaJsAdminGateway(admin);
  }

  async listTopics(): Promise<string[]> {
    return this.admin.listTopics();
  }

  async listConsumerGroups(): Promise<string[]> {
    const response = await this.admin.listGroups();
    return response.groups.map((group) => group.groupId);
  }

  async deleteTopic(topic: string): Promise<void> {
    await this.admin.deleteTopics({ topics: [topic], timeout: 30_000 });
  }

  async deleteConsumerGroup(groupId: string): Promise<void> {
    await this.admin.deleteGroups([groupId]);
  }

  async disconnect(): Promise<void> {
    await this.admin.disconnect();
  }
}

class PostgresWorkerStateRepository implements WorkerStateRepository {
  constructor(private readonly pool: Pool) {}

  async findWorkers(workerIds: string[]): Promise<WorkerDatabaseRow[]> {
    if (workerIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<WorkerDatabaseRow>(
      `
        SELECT
          requested.worker_id::text AS requested_worker_id,
          w.worker_id::text AS worker_id,
          w.account_id::text AS worker_account_id,
          w.deleted_at AS worker_deleted_at,
          a.account_id::text AS account_id,
          a.account_status_id::text AS account_status_id,
          a.deleted_at AS account_deleted_at,
          latest_plan.plan_account_id::text AS plan_account_id,
          latest_plan.next_payment_date AS next_payment_date,
          latest_plan.cancellation_date AS cancellation_date
        FROM unnest($1::uuid[]) AS requested(worker_id)
        LEFT JOIN worker w
          ON w.worker_id = requested.worker_id
        LEFT JOIN account a
          ON a.account_id = w.account_id
        LEFT JOIN LATERAL (
          SELECT
            pa.plan_account_id,
            pa.next_payment_date,
            pa.cancellation_date
          FROM plan_account pa
          WHERE pa.account_id = a.account_id
          ORDER BY
            pa.created_at DESC NULLS LAST,
            pa.updated_at DESC NULLS LAST,
            pa.plan_account_id DESC
          LIMIT 1
        ) latest_plan ON true
      `,
      [workerIds]
    );

    return result.rows;
  }
}

function dead(
  base: Omit<WorkerClassification, 'isDead' | 'reason'>,
  reason: DeadWorkerReason
): WorkerClassification {
  return {
    ...base,
    isDead: true,
    reason,
  };
}

function normalizeDate(value: Date | string | null): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function toDate(value: Date | string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function collectMatchedResources<T extends { workerId: string }>(
  resources: string[],
  parser: (resource: string) => T | null,
  isWorkerLikeResource: (resource: string) => boolean
): {
  byWorkerId: Map<string, T[]>;
  unmatchedWorkerLikeResources: string[];
} {
  const byWorkerId = new Map<string, T[]>();
  const unmatchedWorkerLikeResources: string[] = [];

  for (const resource of resources) {
    const parsed = parser(resource);
    if (parsed) {
      const entries = byWorkerId.get(parsed.workerId) ?? [];
      entries.push(parsed);
      byWorkerId.set(parsed.workerId, entries);
      continue;
    }

    if (isWorkerLikeResource(resource)) {
      unmatchedWorkerLikeResources.push(resource);
    }
  }

  return { byWorkerId, unmatchedWorkerLikeResources };
}

function missingWorkerRow(workerId: string): WorkerDatabaseRow {
  return {
    requested_worker_id: workerId,
    worker_id: null,
    worker_account_id: null,
    worker_deleted_at: null,
    account_id: null,
    account_status_id: null,
    account_deleted_at: null,
    plan_account_id: null,
    next_payment_date: null,
    cancellation_date: null,
  };
}

function buildPlannedOperations(
  candidates: CleanupCandidate[]
): ResourceOperationResult[] {
  return candidates.flatMap((candidate) => [
    ...candidate.topics.map<ResourceOperationResult>((topic) => ({
      type: 'topic',
      name: topic,
      worker_id: candidate.worker_id,
      status: 'planned',
    })),
    ...candidate.consumer_groups.map<ResourceOperationResult>((groupId) => ({
      type: 'consumer_group',
      name: groupId,
      worker_id: candidate.worker_id,
      status: 'planned',
    })),
  ]);
}

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.all(batch.map((item) => handler(item)));
  }
}

function compareClassification(
  left: WorkerClassification,
  right: WorkerClassification
): number {
  return left.workerId.localeCompare(right.workerId);
}

function isMissingTopicError(error: unknown): boolean {
  return /unknown_topic|unknown topic|topic.*not found|topic.*does not exist/i.test(
    formatError(error)
  );
}

function isMissingConsumerGroupError(error: unknown): boolean {
  return /group_id_not_found|group.*not found|group.*does not exist|unknown group/i.test(
    formatError(error)
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }

  return parsed;
}

function parseUuidList(value: string, optionName: string): string[] {
  const values = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`${optionName} requires at least one UUID.`);
  }

  for (const entry of values) {
    if (!isUuid(entry)) {
      throw new Error(`${optionName} has an invalid UUID: ${entry}.`);
    }
  }

  return values;
}

function resolveRuntimeConfig(options: CliOptions): RuntimeConfig {
  const broker =
    options.broker ??
    readScopedEnv({
      publicKey: 'KAFKA_PUBLIC_BROKER',
      privateKey: 'KAFKA_PRIVATE_BROKER',
      legacyKey: 'KAFKA_BROKER',
    });

  if (!broker) {
    throw new Error(
      'Kafka broker is missing. Set KAFKA_BROKER or use --broker.'
    );
  }

  const brokers = broker
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (brokers.length === 0) {
    throw new Error('Kafka broker list is empty.');
  }

  const securityProtocol = (
    readScopedEnv({
      publicKey: 'KAFKA_PUBLIC_SECURITY_PROTOCOL',
      privateKey: 'KAFKA_PRIVATE_SECURITY_PROTOCOL',
      legacyKey: 'SECURITY_PROTOCOL',
      fallback: 'PLAINTEXT',
    }) ?? 'PLAINTEXT'
  ).toUpperCase();

  const kafkaConfig: KafkaConfig = {
    clientId: 'underchat-kafka-dead-resource-cleaner',
    brokers,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    retry: {
      retries: 2,
    },
    logLevel: logLevel.NOTHING,
  };

  if (securityProtocol.includes('SSL')) {
    kafkaConfig.ssl = true;
  }

  if (securityProtocol !== 'PLAINTEXT') {
    const username = readScopedEnv({
      publicKey: 'KAFKA_PUBLIC_USERNAME',
      privateKey: 'KAFKA_PRIVATE_USERNAME',
      legacyKey: 'KAFKA_USERNAME',
    });
    const password = readScopedEnv({
      publicKey: 'KAFKA_PUBLIC_PASSWORD',
      privateKey: 'KAFKA_PRIVATE_PASSWORD',
      legacyKey: 'KAFKA_PASSWORD',
    });
    const mechanism = normalizeSaslMechanism(
      readScopedEnv({
        publicKey: 'KAFKA_PUBLIC_SASL_MECHANISM',
        privateKey: 'KAFKA_PRIVATE_SASL_MECHANISM',
        legacyKey: 'SASL_MECHANISM',
        fallback: 'PLAIN',
      }) ?? 'PLAIN'
    );

    if (!username || !password) {
      throw new Error(
        'Kafka SASL credentials are missing for non-PLAINTEXT protocol.'
      );
    }

    kafkaConfig.sasl = {
      mechanism,
      username,
      password,
    } as KafkaConfig['sasl'];
  }

  const database = resolveDatabaseConfig(options);

  return {
    kafka: {
      brokers,
      identity: brokers.join(','),
      config: kafkaConfig,
    },
    database,
  };
}

function resolveDatabaseConfig(options: CliOptions): RuntimeConfig['database'] {
  if (options.databaseUrl) {
    return databaseConfigFromUrl(options.databaseUrl, 'cli --database-url');
  }

  const readonlyHost = readScopedEnv({
    publicKey: 'DB_PUBLIC_HOST_RO',
    privateKey: 'DB_PRIVATE_HOST_RO',
    legacyKey: 'DB_HOST_RO',
  });
  const readonlyPort = readScopedEnv({
    publicKey: 'DB_PUBLIC_PORT_RO',
    privateKey: 'DB_PRIVATE_PORT_RO',
    legacyKey: 'DB_PORT_RO',
    fallback: '5432',
  });
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE;

  if (readonlyHost && readonlyPort && user && password && database) {
    const port = Number(readonlyPort);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`DB_PORT_RO is invalid: ${readonlyPort}.`);
    }

    const poolConfig: PoolConfig = {
      host: readonlyHost,
      port,
      user,
      password,
      database,
      ssl: resolvePgSsl(),
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    };

    return {
      identity: `${readonlyHost}:${port}/${database}`,
      poolConfig,
      safe: {
        host: readonlyHost,
        port,
        database,
        user,
        source: 'readonly host env',
      },
    };
  }

  const databaseUrl = readScopedEnv({
    publicKey: 'DB_PUBLIC_DATABASE_URL',
    privateKey: 'DB_PRIVATE_DATABASE_URL',
    legacyKey: 'DB_DATABASE_URL',
  });

  if (!databaseUrl) {
    throw new Error(
      'Database config is missing. Set DB_HOST_RO/DB_PORT_RO/DB_USER/DB_PASSWORD/DB_DATABASE, DB_DATABASE_URL, or use --database-url.'
    );
  }

  return databaseConfigFromUrl(databaseUrl, 'database url env');
}

function databaseConfigFromUrl(
  databaseUrl: string,
  source: string
): RuntimeConfig['database'] {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const port = parsed.port ? Number(parsed.port) : 5432;
  const sslMode = parsed.searchParams.get('sslmode') ?? process.env.DB_SSLMODE;
  const poolConfig: PoolConfig = {
    connectionString: databaseUrl,
    ssl: resolvePgSsl(sslMode),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };

  return {
    identity: `${parsed.hostname}:${port}/${database}`,
    poolConfig,
    safe: {
      host: parsed.hostname,
      port,
      database,
      user: parsed.username ? decodeURIComponent(parsed.username) : null,
      source,
    },
  };
}

function resolvePgSsl(
  rawMode = process.env.DB_SSLMODE
): PoolConfig['ssl'] | undefined {
  const sslMode = rawMode?.trim().toLowerCase();
  if (
    !sslMode ||
    sslMode === 'disable' ||
    sslMode === 'false' ||
    sslMode === '0'
  ) {
    return false;
  }

  if (sslMode === 'no-verify' || sslMode === 'require' || sslMode === 'true') {
    return { rejectUnauthorized: false };
  }

  return true;
}

function normalizeSaslMechanism(
  value: string
): 'plain' | 'scram-sha-256' | 'scram-sha-512' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'plain') {
    return 'plain';
  }

  if (normalized === 'scram-sha-256') {
    return 'scram-sha-256';
  }

  if (normalized === 'scram-sha-512') {
    return 'scram-sha-512';
  }

  throw new Error(`Unsupported Kafka SASL mechanism: ${value}.`);
}

function readScopedEnv(options: {
  publicKey: string;
  privateKey: string;
  legacyKey?: string;
  fallback?: string;
}): string | undefined {
  const scope =
    process.env.UNDERCHAT_ENV_SCOPE?.trim().toLowerCase() === 'public'
      ? 'public'
      : 'private';
  const scopedKey = scope === 'public' ? options.publicKey : options.privateKey;

  return (
    readNonEmptyEnv(scopedKey) ??
    readNonEmptyEnv(options.legacyKey) ??
    options.fallback
  );
}

function readNonEmptyEnv(key: string | undefined): string | undefined {
  if (!key) {
    return undefined;
  }

  const value = process.env[key];
  if (!value || value.trim() === '') {
    return undefined;
  }

  return value;
}

function validateExecutionConfirmation(
  options: CliOptions,
  runtime: RuntimeConfig
): void {
  if (!options.execute) {
    return;
  }

  const failures: string[] = [];

  if (options.confirm !== DELETE_CONFIRMATION_TOKEN) {
    failures.push(`--confirm must be exactly ${DELETE_CONFIRMATION_TOKEN}.`);
  }

  if (options.confirmBroker !== runtime.kafka.identity) {
    failures.push(
      `--confirm-broker must be exactly ${runtime.kafka.identity}.`
    );
  }

  if (options.confirmDatabase !== runtime.database.identity) {
    failures.push(
      `--confirm-database must be exactly ${runtime.database.identity}.`
    );
  }

  if (failures.length > 0) {
    throw new Error(
      [
        'Refusing to execute Kafka deletion because confirmation is incomplete.',
        ...failures,
      ].join('\n')
    );
  }
}

function parsePositiveCli(argv: string[]): CliOptions {
  const options = parseArgs(argv);
  if (!options.execute) {
    options.dryRun = true;
  }

  return options;
}

async function main(): Promise<void> {
  const options = parsePositiveCli(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const runtime = resolveRuntimeConfig(options);
  validateExecutionConfirmation(options, runtime);

  const pool = new Pool(runtime.database.poolConfig);
  const kafka = await KafkaJsAdminGateway.connect(runtime.kafka.config);

  try {
    const report = await runCleanup(
      {
        kafka,
        workerRepository: new PostgresWorkerStateRepository(pool),
      },
      options
    );

    console.log(
      JSON.stringify(
        {
          config: {
            kafka: {
              brokers: runtime.kafka.brokers,
            },
            database: runtime.database.safe,
          },
          ...report,
        },
        null,
        2
      )
    );

    if (options.execute && report.operations.failed.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await Promise.allSettled([kafka.disconnect(), pool.end()]);
  }
}

function helpText(): string {
  return `
Usage:
  pnpm kafka:dead-resources:dry-run
  pnpm kafka:dead-resources:delete -- --confirm ${DELETE_CONFIRMATION_TOKEN} --confirm-broker "<broker-list>" --confirm-database "<host:port/database>"

Options:
  --dry-run                    Default. Print JSON report and do not delete anything.
  --execute                    Delete only planned candidates.
  --confirm <token>            Required for --execute.
  --confirm-broker <brokers>   Required for --execute. Must match resolved brokers exactly.
  --confirm-database <db>      Required for --execute. Must match resolved host:port/database exactly.
  --broker <brokers>           Override KAFKA_*_BROKER.
  --database-url <url>         Override DB_*_DATABASE_URL and readonly host env.
  --limit <n>                  Limit number of dead workers processed.
  --batch-size <n>             Concurrent delete batch size. Default: 10.
  --worker-id <uuid[,uuid]>    Restrict to specific worker_id values.
  --account-id <uuid[,uuid]>   Restrict to specific account_id values.
  --topics-only                Only list/delete topics.
  --groups-only                Only list/delete consumer groups.
  --help                       Show this help.
`.trim();
}

function isDirectScriptRun(): boolean {
  const entrypoint = process.argv[1]
    ? path.normalize(path.resolve(process.argv[1]))
    : '';

  return (
    entrypoint.endsWith(
      path.normalize('scripts/kafka-clean-dead-resources.ts')
    ) ||
    entrypoint.endsWith(path.normalize('scripts/kafka-clean-dead-resources.js'))
  );
}

if (isDirectScriptRun()) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
