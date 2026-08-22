import 'reflect-metadata';
import dotenv from 'dotenv';
import { Kafka, logLevel, type Admin, type KafkaConfig } from 'kafkajs';
import { Pool, type PoolConfig } from 'pg';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Redis, { type RedisOptions } from 'ioredis';
import { WorkerDeletionProofService } from '../packages/services/workerDeletionProof.service';
import {
  buildKafkaJsAdminConfig,
  buildKafkaJsRuntimeConfig,
} from '../packages/common/functions/kafkaAdminConfig';
import { EWorkerStatus } from '../packages/common/enums/EWorkerStatus';

dotenv.config({ quiet: true });

export const DELETE_CONFIRMATION_TOKEN = 'DELETE_DEAD_KAFKA_RESOURCES';
export const PROTECTED_WORKER_KAFKA_CLEANUP_DISABLED =
  'protected_worker_kafka_cleanup_disabled_use_lifecycle_finalizer';
export const BLOCKED_ACCOUNT_STATUS_ID = '019a930d-c6f4-75ad-88ff-75403daff4e1';
export const DELETING_WORKER_STATUS_ID = '019a930d-c6f6-766d-9c84-437433031776';

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
  'webhook.integration.dlq',
  'send.message.dlq',
  'consumer.dlq',
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

export type DeadWorkerReason = 'worker_permanently_deleted';

export interface WorkerDatabaseRow {
  requested_worker_id: string;
  worker_id: string | null;
  worker_account_id: string | null;
  worker_deleted_at: Date | string | null;
  worker_status_id: string | null;
  worker_lifecycle_operation_id: string | null;
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
  workerDeletedAt: string | null;
  lifecycleOperationId: string | null;
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
  confirmedDatabaseFingerprint?: string;
  allowedDatabaseFingerprints?: string[];
  confirmationTimeoutMs?: number;
  confirmationPollIntervalMs?: number;
}

export interface KafkaAdminGateway {
  listTopics(): Promise<string[]>;
  listConsumerGroups(): Promise<string[]>;
  deleteTopic(topic: string): Promise<void>;
  deleteConsumerGroup(groupId: string): Promise<void>;
}

export interface WorkerStateRepository {
  findWorkers(workerIds: string[]): Promise<WorkerDatabaseRow[]>;
  assertAuthoritativePrimary(): Promise<DatabaseAuthority>;
  readAuthoritativeWorkerSnapshot(
    workerIds: string[]
  ): Promise<AuthoritativeWorkerSnapshot>;
}

export interface DatabaseAuthority {
  transaction_read_only: string;
  pg_is_in_recovery: boolean;
  database: string;
  server_address: string;
  server_port: number;
  user: string;
  database_oid: string;
  server_version_num: string;
  fingerprint: string;
}

export interface AuthoritativeWorkerSnapshot {
  authority: DatabaseAuthority;
  rows: WorkerDatabaseRow[];
}

export interface WorkerDeletionProofRepository {
  assert(candidate: CleanupCandidate): Promise<void>;
}

export interface CleanupCandidate {
  worker_id: string;
  account_id: string | null;
  reason: DeadWorkerReason;
  lifecycle_operation_id: string;
  deleted_at: string;
  topics: string[];
  consumer_groups: string[];
}

export interface ResourceOperationResult {
  type: 'topic' | 'consumer_group';
  name: string;
  worker_id: string;
  account_id: string;
  lifecycle_operation_id: string;
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
    proof_unavailable_worker_ids: string[];
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
  redis?: {
    config: RedisOptions;
    safe: {
      host: string;
      port: number;
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
  _now = new Date()
): WorkerClassification {
  void _now;
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
    workerDeletedAt: normalizeDate(row.worker_deleted_at),
    lifecycleOperationId: row.worker_lifecycle_operation_id,
    workerExists: row.worker_id !== null,
    accountExists: row.account_id !== null,
  };

  // Kafka resources are durable message queues. Entitlement transitions,
  // account status, a missing plan and even a missing worker lookup are not
  // proof that their backlog may be destroyed. Only an existing worker
  // tombstone carrying the lifecycle operation that permanently deleted it is
  // authoritative.
  if (
    row.worker_id &&
    row.worker_account_id &&
    row.worker_deleted_at &&
    row.worker_lifecycle_operation_id &&
    row.worker_status_id === DELETING_WORKER_STATUS_ID
  ) {
    return dead(base, 'worker_permanently_deleted');
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
    deletionProofRepository?: WorkerDeletionProofRepository;
  },
  options: KafkaCleanupOptions
): Promise<CleanupReport> {
  if (options.execute && options.workerIds.length === 0) {
    throw new Error('execute_requires_explicit_worker_ids');
  }
  if (options.execute && options.accountIds.length === 0) {
    throw new Error('execute_requires_explicit_account_ids');
  }
  if (options.execute && !deps.deletionProofRepository) {
    throw new Error('execute_requires_immutable_deletion_proof_repository');
  }

  if (options.execute) {
    /*
     * Worker topics and consumer groups are lifecycle-protected resources.
     * This offline cleaner has neither the renewable worker lease nor the
     * joint topic/group quiet-window proof required by the runtime finalizer,
     * so mutation is intentionally impossible here. Keep dry-run discovery
     * for diagnostics and route every real deletion through the worker
     * lifecycle boundary.
     */
    throw new Error(PROTECTED_WORKER_KAFKA_CLEANUP_DISABLED);
  }

  const startedAt = new Date();
  const now = options.now ?? startedAt;
  // Even in --groups-only execute mode we must inspect the complete protected
  // topic set. Consumer groups may never be deleted while one of the eight
  // durable worker topics still exists.
  const topics =
    options.groupsOnly && !options.execute ? [] : await deps.kafka.listTopics();
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
  const proofUnavailableWorkerIds: string[] = [];
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

    const discoveredTopicsForWorker = (
      topicsByWorkerId.get(classification.workerId) ?? []
    ).map((parsed) => parsed.topic);
    const groupsForWorker = options.topicsOnly
      ? []
      : buildWorkerConsumerGroupNames(classification.workerId).filter(
          (groupId) =>
            consumerGroupsByWorkerId
              .get(classification.workerId)
              ?.some((parsed) => parsed.groupId === groupId) ?? false
        );

    const hasSelectedResources = options.groupsOnly
      ? groupsForWorker.length > 0
      : options.topicsOnly
        ? discoveredTopicsForWorker.length > 0
        : discoveredTopicsForWorker.length > 0 || groupsForWorker.length > 0;
    if (!hasSelectedResources) {
      deadWorkersWithoutResources.push(classification);
      continue;
    }

    candidates.push({
      worker_id: classification.workerId,
      account_id: classification.accountId,
      reason: classification.reason as DeadWorkerReason,
      lifecycle_operation_id: classification.lifecycleOperationId as string,
      deleted_at: classification.workerDeletedAt as string,
      // Delete and subsequently confirm the complete durable topic set rather
      // than trusting a potentially stale initial Kafka metadata snapshot.
      topics: options.groupsOnly
        ? []
        : buildWorkerTopicNames(classification.workerId),
      consumer_groups: groupsForWorker.sort(),
    });
  }

  const candidatesWithProof: CleanupCandidate[] = [];
  if (!options.execute) {
    for (const candidate of candidates) {
      if (!deps.deletionProofRepository) {
        proofUnavailableWorkerIds.push(candidate.worker_id);
        continue;
      }
      try {
        await deps.deletionProofRepository.assert(candidate);
        candidatesWithProof.push(candidate);
      } catch {
        proofUnavailableWorkerIds.push(candidate.worker_id);
      }
    }
  } else {
    candidatesWithProof.push(...candidates);
  }

  let selectedCandidates = candidatesWithProof;
  if (options.limit !== undefined) {
    selectedCandidates = candidatesWithProof.slice(0, options.limit);
    limitedWorkerIds.push(
      ...candidatesWithProof
        .slice(options.limit)
        .map((candidate) => candidate.worker_id)
    );
  }

  const planned = buildPlannedOperations(selectedCandidates);
  const succeeded: ResourceOperationResult[] = [];
  const failed: ResourceOperationResult[] = [];

  if (options.execute) {
    const deletionProofRepository = deps.deletionProofRepository;
    if (!deletionProofRepository) {
      throw new Error('execute_requires_immutable_deletion_proof_repository');
    }

    for (const candidate of selectedCandidates) {
      const topicOperations = planned.filter(
        (operation) =>
          operation.worker_id === candidate.worker_id &&
          operation.type === 'topic'
      );
      const groupOperations = planned.filter(
        (operation) =>
          operation.worker_id === candidate.worker_id &&
          operation.type === 'consumer_group'
      );

      for (const operation of topicOperations) {
        await assertCandidateDeletionAuthority(
          deps.workerRepository,
          deletionProofRepository,
          candidate,
          options,
          now
        );
        await deleteTopicOperation(deps.kafka, operation, succeeded, failed);
      }

      const remainingTopics = await waitForWorkerTopicsAbsent(
        deps.kafka,
        candidate.worker_id,
        options
      );
      if (remainingTopics.length > 0) {
        markTopicConfirmationFailures(
          candidate,
          remainingTopics,
          succeeded,
          failed
        );
        for (const operation of groupOperations) {
          failed.push({
            ...operation,
            status: 'failed',
            error: `worker_topics_still_present:${remainingTopics.join(',')}`,
          });
        }
        continue;
      }

      for (const operation of groupOperations) {
        await assertCandidateDeletionAuthority(
          deps.workerRepository,
          deletionProofRepository,
          candidate,
          options,
          now
        );
        await deleteConsumerGroupOperation(
          deps.kafka,
          operation,
          succeeded,
          failed
        );
      }

      if (groupOperations.length > 0) {
        const remainingGroups = await waitForConsumerGroupsAbsent(
          deps.kafka,
          groupOperations.map((operation) => operation.name),
          options
        );
        markConsumerGroupConfirmationFailures(
          candidate,
          remainingGroups,
          succeeded,
          failed
        );
      }
    }
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
      proof_unavailable_worker_ids: proofUnavailableWorkerIds.sort(),
    },
    candidates: selectedCandidates,
    operations: {
      planned,
      succeeded,
      failed,
    },
  };
}

async function deleteTopicOperation(
  kafka: KafkaAdminGateway,
  operation: ResourceOperationResult,
  succeeded: ResourceOperationResult[],
  failed: ResourceOperationResult[]
): Promise<void> {
  try {
    await kafka.deleteTopic(operation.name);
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

async function deleteConsumerGroupOperation(
  kafka: KafkaAdminGateway,
  operation: ResourceOperationResult,
  succeeded: ResourceOperationResult[],
  failed: ResourceOperationResult[]
): Promise<void> {
  try {
    await kafka.deleteConsumerGroup(operation.name);
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
      case '--confirm-database-fingerprint':
        options.confirmedDatabaseFingerprint = readValue();
        break;
      case '--broker':
        options.broker = readValue();
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

export class PostgresWorkerStateRepository implements WorkerStateRepository {
  constructor(private readonly pool: Pool) {}

  async assertAuthoritativePrimary(): Promise<DatabaseAuthority> {
    const result = await this.pool.query<{
      transaction_read_only: string;
      pg_is_in_recovery: boolean;
      database: string;
      server_address: string | null;
      server_port: number | null;
      user: string;
      database_oid: string;
      server_version_num: string;
    }>(`
      SELECT
        current_setting('transaction_read_only') AS transaction_read_only,
        pg_is_in_recovery() AS pg_is_in_recovery,
        current_database() AS database,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port,
        current_user AS user,
        (
          SELECT oid::text
          FROM pg_database
          WHERE datname = current_database()
        ) AS database_oid,
        current_setting('server_version_num') AS server_version_num
    `);
    const row = result.rows[0];
    if (
      !row ||
      row.transaction_read_only !== 'off' ||
      row.pg_is_in_recovery !== false
    ) {
      throw new Error('database_is_not_authoritative_read_write_primary');
    }
    const identity = {
      transaction_read_only: row.transaction_read_only,
      pg_is_in_recovery: row.pg_is_in_recovery,
      database: row.database,
      server_address: row.server_address ?? 'local-socket',
      server_port: row.server_port ?? 5432,
      user: row.user,
      database_oid: row.database_oid,
      server_version_num: row.server_version_num,
    };
    return {
      ...identity,
      fingerprint: databaseAuthorityFingerprint(identity),
    };
  }

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
          w.worker_status_id::text AS worker_status_id,
          w.lifecycle_operation_id::text AS worker_lifecycle_operation_id,
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

  async readAuthoritativeWorkerSnapshot(
    workerIds: string[]
  ): Promise<AuthoritativeWorkerSnapshot> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      transactionStarted = true;

      const authorityResult = await client.query<{
        transaction_read_only: string;
        pg_is_in_recovery: boolean;
        database: string;
        server_address: string | null;
        server_port: number | null;
        user: string;
        database_oid: string;
        server_version_num: string;
      }>(`
        SELECT
          current_setting('transaction_read_only') AS transaction_read_only,
          pg_is_in_recovery() AS pg_is_in_recovery,
          current_database() AS database,
          inet_server_addr()::text AS server_address,
          inet_server_port() AS server_port,
          current_user AS user,
          (
            SELECT oid::text
            FROM pg_database
            WHERE datname = current_database()
          ) AS database_oid,
          current_setting('server_version_num') AS server_version_num
      `);
      const authorityRow = authorityResult.rows[0];
      if (
        !authorityRow ||
        authorityRow.transaction_read_only !== 'off' ||
        authorityRow.pg_is_in_recovery !== false
      ) {
        throw new Error('database_is_not_authoritative_read_write_primary');
      }
      const authorityIdentity = {
        transaction_read_only: authorityRow.transaction_read_only,
        pg_is_in_recovery: authorityRow.pg_is_in_recovery,
        database: authorityRow.database,
        server_address: authorityRow.server_address ?? 'local-socket',
        server_port: authorityRow.server_port ?? 5432,
        user: authorityRow.user,
        database_oid: authorityRow.database_oid,
        server_version_num: authorityRow.server_version_num,
      };

      const workerResult =
        workerIds.length === 0
          ? { rows: [] as WorkerDatabaseRow[] }
          : await client.query<WorkerDatabaseRow>(
              `
                SELECT
                  requested.worker_id::text AS requested_worker_id,
                  w.worker_id::text AS worker_id,
                  w.account_id::text AS worker_account_id,
                  w.deleted_at AS worker_deleted_at,
                  w.worker_status_id::text AS worker_status_id,
                  w.lifecycle_operation_id::text AS worker_lifecycle_operation_id,
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

      await client.query('COMMIT');
      transactionStarted = false;
      return {
        authority: {
          ...authorityIdentity,
          fingerprint: databaseAuthorityFingerprint(authorityIdentity),
        },
        rows: workerResult.rows,
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            '[kafka-cleaner] database snapshot rollback failed',
            formatError(rollbackError)
          );
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

class RedisWorkerDeletionProofRepository implements WorkerDeletionProofRepository {
  constructor(private readonly proofService: WorkerDeletionProofService) {}

  async assert(candidate: CleanupCandidate): Promise<void> {
    const payload = await this.proofService.load(
      candidate.worker_id,
      candidate.lifecycle_operation_id
    );
    if (!payload) {
      throw new Error(
        `worker_deletion_immutable_proof_missing:${candidate.worker_id}`
      );
    }
    if (
      payload.action !== 'delete' ||
      payload.worker_id !== candidate.worker_id ||
      payload.account_id !== candidate.account_id ||
      payload.operation_id !== candidate.lifecycle_operation_id ||
      payload.worker_status_id !== EWorkerStatus.deleting
    ) {
      throw new Error(
        `worker_deletion_immutable_proof_mismatch:${candidate.worker_id}`
      );
    }
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
    worker_status_id: null,
    worker_lifecycle_operation_id: null,
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
      account_id: candidate.account_id as string,
      lifecycle_operation_id: candidate.lifecycle_operation_id,
      status: 'planned',
    })),
    ...candidate.consumer_groups.map<ResourceOperationResult>((groupId) => ({
      type: 'consumer_group',
      name: groupId,
      worker_id: candidate.worker_id,
      account_id: candidate.account_id as string,
      lifecycle_operation_id: candidate.lifecycle_operation_id,
      status: 'planned',
    })),
  ]);
}

export function databaseAuthorityFingerprint(
  authority: Omit<DatabaseAuthority, 'fingerprint'>
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        transaction_read_only: authority.transaction_read_only,
        pg_is_in_recovery: authority.pg_is_in_recovery,
        database: authority.database,
        server_address: authority.server_address,
        server_port: authority.server_port,
        user: authority.user,
        database_oid: authority.database_oid,
        server_version_num: authority.server_version_num,
      }),
      'utf8'
    )
    .digest('hex');
}

function assertDatabaseAuthorityMatchesExecution(
  authority: DatabaseAuthority,
  options: KafkaCleanupOptions
): void {
  const confirmedFingerprint = normalizeDatabaseFingerprint(
    options.confirmedDatabaseFingerprint,
    'confirmed_database_fingerprint'
  );
  const allowedFingerprints = new Set(
    (options.allowedDatabaseFingerprints ?? []).map((fingerprint) =>
      normalizeDatabaseFingerprint(fingerprint, 'allowed_database_fingerprint')
    )
  );
  if (allowedFingerprints.size === 0) {
    throw new Error('database_fingerprint_allowlist_is_empty');
  }

  if (
    authority.transaction_read_only !== 'off' ||
    authority.pg_is_in_recovery !== false
  ) {
    throw new Error('database_is_not_authoritative_read_write_primary');
  }
  const calculatedFingerprint = databaseAuthorityFingerprint({
    transaction_read_only: authority.transaction_read_only,
    pg_is_in_recovery: authority.pg_is_in_recovery,
    database: authority.database,
    server_address: authority.server_address,
    server_port: authority.server_port,
    user: authority.user,
    database_oid: authority.database_oid,
    server_version_num: authority.server_version_num,
  });
  if (authority.fingerprint.toLowerCase() !== calculatedFingerprint) {
    throw new Error('database_authority_fingerprint_integrity_mismatch');
  }
  if (calculatedFingerprint !== confirmedFingerprint) {
    throw new Error(
      `database_fingerprint_confirmation_mismatch:${calculatedFingerprint}`
    );
  }
  if (!allowedFingerprints.has(calculatedFingerprint)) {
    throw new Error(
      `database_fingerprint_not_allowlisted:${calculatedFingerprint}`
    );
  }
}

async function assertCandidateDeletionAuthority(
  repository: WorkerStateRepository,
  proofRepository: WorkerDeletionProofRepository,
  candidate: CleanupCandidate,
  options: KafkaCleanupOptions,
  now: Date
): Promise<void> {
  const snapshot = await repository.readAuthoritativeWorkerSnapshot([
    candidate.worker_id,
  ]);
  assertDatabaseAuthorityMatchesExecution(snapshot.authority, options);
  const freshRows = snapshot.rows;
  const fresh = classifyWorkerDatabaseRow(
    freshRows.find((row) => row.requested_worker_id === candidate.worker_id) ??
      missingWorkerRow(candidate.worker_id),
    now
  );
  const tombstoneStillMatches =
    fresh.isDead &&
    fresh.reason === 'worker_permanently_deleted' &&
    fresh.accountId === candidate.account_id &&
    fresh.lifecycleOperationId === candidate.lifecycle_operation_id &&
    fresh.workerDeletedAt === candidate.deleted_at;
  if (!tombstoneStillMatches) {
    throw new Error(
      `worker_deletion_tombstone_revalidation_failed:${candidate.worker_id}`
    );
  }

  await proofRepository.assert(candidate);
}

function normalizeDatabaseFingerprint(
  fingerprint: string | undefined,
  source: string
): string {
  const normalized = fingerprint?.trim().toLowerCase();
  if (!normalized || !/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${source}_must_be_sha256`);
  }
  return normalized;
}

async function waitForWorkerTopicsAbsent(
  kafka: KafkaAdminGateway,
  workerId: string,
  options: KafkaCleanupOptions
): Promise<string[]> {
  const expected = new Set(buildWorkerTopicNames(workerId));
  return waitForResourcesAbsent(() => kafka.listTopics(), expected, options);
}

async function waitForConsumerGroupsAbsent(
  kafka: KafkaAdminGateway,
  groupIds: string[],
  options: KafkaCleanupOptions
): Promise<string[]> {
  return waitForResourcesAbsent(
    () => kafka.listConsumerGroups(),
    new Set(groupIds),
    options
  );
}

async function waitForResourcesAbsent(
  list: () => Promise<string[]>,
  expected: ReadonlySet<string>,
  options: KafkaCleanupOptions
): Promise<string[]> {
  if (expected.size === 0) {
    return [];
  }
  const timeoutMs = positiveIntegerOrFallback(
    options.confirmationTimeoutMs ??
      Number(process.env.KAFKA_RESOURCE_DELETION_CONFIRM_TIMEOUT_MS),
    15_000
  );
  const pollIntervalMs = positiveIntegerOrFallback(
    options.confirmationPollIntervalMs ??
      Number(process.env.KAFKA_RESOURCE_DELETION_CONFIRM_POLL_MS),
    100
  );
  const deadline = Date.now() + timeoutMs;
  do {
    const remaining = (await list())
      .filter((resource) => expected.has(resource))
      .sort();
    if (remaining.length === 0 || Date.now() >= deadline) {
      return remaining;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (true);
}

function positiveIntegerOrFallback(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function markTopicConfirmationFailures(
  candidate: CleanupCandidate,
  remainingTopics: string[],
  succeeded: ResourceOperationResult[],
  failed: ResourceOperationResult[]
): void {
  for (const topic of remainingTopics) {
    removeOperationResult(succeeded, 'topic', topic, candidate.worker_id);
    if (
      failed.some(
        (operation) =>
          operation.type === 'topic' &&
          operation.name === topic &&
          operation.worker_id === candidate.worker_id
      )
    ) {
      continue;
    }
    failed.push({
      type: 'topic',
      name: topic,
      worker_id: candidate.worker_id,
      account_id: candidate.account_id as string,
      lifecycle_operation_id: candidate.lifecycle_operation_id,
      status: 'failed',
      error: 'topic_deletion_not_confirmed',
    });
  }
}

function markConsumerGroupConfirmationFailures(
  candidate: CleanupCandidate,
  remainingGroups: string[],
  succeeded: ResourceOperationResult[],
  failed: ResourceOperationResult[]
): void {
  for (const groupId of remainingGroups) {
    removeOperationResult(
      succeeded,
      'consumer_group',
      groupId,
      candidate.worker_id
    );
    if (
      failed.some(
        (operation) =>
          operation.type === 'consumer_group' &&
          operation.name === groupId &&
          operation.worker_id === candidate.worker_id
      )
    ) {
      continue;
    }
    failed.push({
      type: 'consumer_group',
      name: groupId,
      worker_id: candidate.worker_id,
      account_id: candidate.account_id as string,
      lifecycle_operation_id: candidate.lifecycle_operation_id,
      status: 'failed',
      error: 'consumer_group_deletion_not_confirmed',
    });
  }
}

function removeOperationResult(
  results: ResourceOperationResult[],
  type: ResourceOperationResult['type'],
  name: string,
  workerId: string
): void {
  const index = results.findIndex(
    (operation) =>
      operation.type === type &&
      operation.name === name &&
      operation.worker_id === workerId
  );
  if (index >= 0) {
    results.splice(index, 1);
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

  const baseKafkaConfig: KafkaConfig = {
    clientId: 'underchat-kafka-dead-resource-cleaner',
    brokers,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    retry: {
      retries: 2,
    },
    logLevel: logLevel.NOTHING,
  };
  const kafkaConfig = options.execute
    ? {
        ...baseKafkaConfig,
        ...buildKafkaJsAdminConfig(
          brokers,
          'underchat-kafka-dead-resource-finalizer',
          'finalizer'
        ),
      }
    : {
        ...baseKafkaConfig,
        ...buildKafkaJsRuntimeReadConfig(brokers),
      };

  const database = resolveDatabaseConfig(options);
  const redis = resolveRedisConfig(options.execute);

  return {
    kafka: {
      brokers,
      identity: brokers.join(','),
      config: kafkaConfig,
    },
    database,
    redis,
  };
}

function buildKafkaJsRuntimeReadConfig(brokers: string[]): KafkaConfig {
  return buildKafkaJsRuntimeConfig(
    brokers,
    'underchat-kafka-dead-resource-reader'
  );
}

function resolveRedisConfig(
  required: boolean
): RuntimeConfig['redis'] | undefined {
  const host = readScopedEnv({
    publicKey: 'DB_CACHE_PUBLIC_HOST',
    privateKey: 'DB_CACHE_PRIVATE_HOST',
    legacyKey: 'DB_CACHE_HOST',
  });
  const rawPort = readScopedEnv({
    publicKey: 'DB_CACHE_PUBLIC_PORT',
    privateKey: 'DB_CACHE_PRIVATE_PORT',
    legacyKey: 'DB_CACHE_PORT',
  });
  if (!host || !rawPort) {
    if (required) {
      throw new Error(
        'Redis deletion-proof store is missing. Set scoped DB_CACHE_HOST/PORT.'
      );
    }
    return undefined;
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`DB_CACHE_PORT is invalid: ${rawPort}.`);
  }
  return {
    config: {
      host,
      port,
      password: process.env.DB_CACHE_PASSWORD || undefined,
      lazyConnect: true,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 10_000,
    },
    safe: {
      host,
      port,
      source: 'scoped cache env',
    },
  };
}

export function resolveDatabaseConfig(options: {
  execute: boolean;
}): RuntimeConfig['database'] {
  const databaseHost = readScopedEnv({
    publicKey: options.execute ? 'DB_PUBLIC_HOST_RW' : 'DB_PUBLIC_HOST_RO',
    privateKey: options.execute ? 'DB_PRIVATE_HOST_RW' : 'DB_PRIVATE_HOST_RO',
    legacyKey: options.execute ? 'DB_HOST_RW' : 'DB_HOST_RO',
  });
  const databasePort = readScopedEnv({
    publicKey: options.execute ? 'DB_PUBLIC_PORT_RW' : 'DB_PUBLIC_PORT_RO',
    privateKey: options.execute ? 'DB_PRIVATE_PORT_RW' : 'DB_PRIVATE_PORT_RO',
    legacyKey: options.execute ? 'DB_PORT_RW' : 'DB_PORT_RO',
  });
  const user = readNonEmptyEnv('DB_USER');
  const password = readNonEmptyEnv('DB_PASSWORD');
  const database = readNonEmptyEnv('DB_DATABASE');
  const sslMode = readNonEmptyEnv('DB_SSLMODE');

  if (
    !databaseHost ||
    !databasePort ||
    !user ||
    !password ||
    !database ||
    !sslMode
  ) {
    throw new Error(
      `Database config is missing. Set ${
        options.execute ? 'DB_HOST_RW/DB_PORT_RW' : 'DB_HOST_RO/DB_PORT_RO'
      }/DB_USER/DB_PASSWORD/DB_DATABASE/DB_SSLMODE.`
    );
  }

  const port = Number(databasePort);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `${options.execute ? 'DB_PORT_RW' : 'DB_PORT_RO'} is invalid: ${databasePort}.`
    );
  }

  const poolConfig: PoolConfig = {
    host: databaseHost,
    port,
    user,
    password,
    database,
    ssl: resolvePgSsl(sslMode),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };

  return {
    identity: `${databaseHost}:${port}/${database}`,
    poolConfig,
    safe: {
      host: databaseHost,
      port,
      database,
      user,
      source: options.execute
        ? 'authoritative read-write host env'
        : 'readonly host env',
    },
  };
}

function resolvePgSsl(rawMode: string): PoolConfig['ssl'] {
  const sslMode = rawMode.trim().toLowerCase();
  if (['disable', 'false', '0', 'no'].includes(sslMode)) {
    return false;
  }

  if (['no-verify', 'require', 'true', '1', 'yes'].includes(sslMode)) {
    return { rejectUnauthorized: false };
  }

  if (['allow', 'prefer', 'verify-ca', 'verify-full'].includes(sslMode)) {
    return true;
  }

  throw new Error(`DB_SSLMODE is invalid: ${rawMode}.`);
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

  try {
    normalizeDatabaseFingerprint(
      options.confirmedDatabaseFingerprint,
      '--confirm-database-fingerprint'
    );
  } catch {
    failures.push(
      '--confirm-database-fingerprint must be the exact 64-character SHA-256 fingerprint of the authoritative primary.'
    );
  }

  if ((options.allowedDatabaseFingerprints ?? []).length === 0) {
    failures.push(
      'KAFKA_CLEANER_ALLOWED_DATABASE_FINGERPRINTS must contain the confirmed primary fingerprint.'
    );
  }

  if (options.workerIds.length === 0) {
    failures.push(
      '--worker-id is required for --execute; unscoped bulk deletion is forbidden.'
    );
  }

  if (options.accountIds.length === 0) {
    failures.push(
      '--account-id is required for --execute; account scope must be explicit.'
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
  options.allowedDatabaseFingerprints = parseDatabaseFingerprintAllowlist(
    process.env.KAFKA_CLEANER_ALLOWED_DATABASE_FINGERPRINTS
  );
  if (!options.execute) {
    options.dryRun = true;
  }

  return options;
}

function parseDatabaseFingerprintAllowlist(
  rawValue: string | undefined
): string[] {
  if (!rawValue?.trim()) {
    return [];
  }
  return Array.from(
    new Set(
      rawValue
        .split(',')
        .map((entry) =>
          normalizeDatabaseFingerprint(
            entry,
            'KAFKA_CLEANER_ALLOWED_DATABASE_FINGERPRINTS'
          )
        )
    )
  ).sort();
}

async function main(): Promise<void> {
  const options = parsePositiveCli(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  if (options.execute) {
    throw new Error(PROTECTED_WORKER_KAFKA_CLEANUP_DISABLED);
  }

  const runtime = resolveRuntimeConfig(options);
  validateExecutionConfirmation(options, runtime);

  const pool = new Pool(runtime.database.poolConfig);
  let kafka: KafkaJsAdminGateway | undefined;
  let redis: Redis | undefined;

  try {
    if (runtime.redis) {
      redis = new Redis(runtime.redis.config);
      await redis.connect();
    }
    kafka = await KafkaJsAdminGateway.connect(runtime.kafka.config);
    const report = await runCleanup(
      {
        kafka,
        workerRepository: new PostgresWorkerStateRepository(pool),
        deletionProofRepository: redis
          ? new RedisWorkerDeletionProofRepository(
              new WorkerDeletionProofService(redis)
            )
          : undefined,
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
            redis: runtime.redis?.safe ?? null,
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
    await Promise.allSettled([kafka?.disconnect(), pool.end(), redis?.quit()]);
  }
}

function helpText(): string {
  return `
Usage:
  pnpm kafka:dead-resources:dry-run

Options:
  --dry-run                    Default. Print JSON report and do not delete anything.
  --execute                    Disabled for protected worker resources. Use the
                               renewable worker lifecycle finalizer.
  --confirm <token>            Required for --execute.
  --confirm-broker <brokers>   Required for --execute. Must match resolved brokers exactly.
  --confirm-database <db>      Required for --execute. Must match resolved host:port/database exactly.
  --confirm-database-fingerprint <sha256>
                               Required for --execute. Must match the live RW primary and
                               KAFKA_CLEANER_ALLOWED_DATABASE_FINGERPRINTS.
  --broker <brokers>           Override KAFKA_*_BROKER.
  --limit <n>                  Limit number of dead workers processed.
  --batch-size <n>             Report compatibility setting; deletion is always sequential.
  --worker-id <uuid[,uuid]>    Required for --execute; exact worker scope.
  --account-id <uuid[,uuid]>   Required for --execute; exact account scope.
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
