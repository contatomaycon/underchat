import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type Redis from 'ioredis';
import { Kafka, logLevel, type Admin } from 'kafkajs';
import { kafkaEnvironment } from '@core/config/environments';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from './kafkaTopicConfig';
import { buildKafkaJsAdminConfig } from './kafkaAdminConfig';
import {
  SERVICE_API_WHATSAPP_CONSUMER_BINDINGS,
  type ServiceApiWhatsappConsumerBinding,
} from './serviceApiWhatsappConsumerBindings';
import {
  isServiceApiKafkaConsumerFromGeneration,
  serviceApiKafkaCutoverGenerationMarker,
} from './serviceApiKafkaCutoverIdentity';

export {
  resolveServiceApiWhatsappConsumerGroupId,
  SERVICE_API_WHATSAPP_CONSUMER_BINDINGS,
  SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS,
  SERVICE_API_WHATSAPP_CONSUMER_GROUPS,
} from './serviceApiWhatsappConsumerBindings';
export type { ServiceApiWhatsappConsumerBinding } from './serviceApiWhatsappConsumerBindings';
export {
  buildServiceApiKafkaConsumerClientId,
  isServiceApiKafkaBootstrapCutoverEnabled,
  isServiceApiKafkaConsumerFromGeneration,
  resolveServiceApiKafkaCutoverToken,
  serviceApiKafkaCutoverGenerationMarker,
} from './serviceApiKafkaCutoverIdentity';

const EXTEND_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])
`;

const RELEASE_BARRIER_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[1])
return 1
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('DEL', KEYS[1])
`;

interface KafkaGroupMemberLike {
  clientId?: unknown;
}

interface KafkaTopicPartitionOffsetLike {
  partition: number;
  offset: string;
}

interface KafkaAdminLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  createTopics(options: {
    waitForLeaders: true;
    timeout: number;
    topics: Array<{
      topic: string;
      numPartitions: number;
      replicationFactor: number;
    }>;
  }): Promise<boolean>;
  createPartitions(options: {
    timeout: number;
    topicPartitions: Array<{
      topic: string;
      count: number;
    }>;
  }): Promise<boolean>;
  fetchTopicMetadata(options: { topics: string[] }): Promise<{
    topics: Array<{
      name: string;
      partitions: unknown[];
    }>;
  }>;
  describeGroups(groupIds: string[]): Promise<{
    groups: Array<{
      groupId: string;
      members: KafkaGroupMemberLike[];
      state: string;
    }>;
  }>;
  fetchTopicOffsets(
    topic: string
  ): Promise<
    Array<KafkaTopicPartitionOffsetLike & { high: string; low: string }>
  >;
  setOffsets(options: {
    groupId: string;
    topic: string;
    partitions: KafkaTopicPartitionOffsetLike[];
  }): Promise<void>;
  fetchOffsets(options: {
    groupId: string;
    topics: string[];
    resolveOffsets: false;
  }): Promise<
    Array<{
      topic: string;
      partitions: Array<
        KafkaTopicPartitionOffsetLike & { metadata: string | null }
      >;
    }>
  >;
}

interface CutoverLogger {
  info(context: unknown, message: string): void;
  warn(context: unknown, message: string): void;
}

interface OccupiedConsumerGroup {
  group_id: string;
  members: number;
  state: string;
}

interface PositionedConsumerGroup {
  group_id: string;
  topic: string;
  partitions: number;
}

interface LeadershipLockWatchdog {
  assertOwned(): Promise<void>;
  stop(): Promise<void>;
}

export interface ServiceApiKafkaCutoverBarrierOptions {
  token: string;
  redis: Pick<Redis, 'get' | 'set' | 'eval'>;
  logger: CutoverLogger;
  createAdmin?: () => KafkaAdminLike;
  bindings?: readonly ServiceApiWhatsappConsumerBinding[];
  pollIntervalMs?: number;
  emptyStabilityMs?: number;
  lockLeaseMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createKafkaAdmin(): Admin {
  const brokers = kafkaEnvironment.kafkaBroker
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
  const config = {
    ...buildKafkaJsAdminConfig(
      brokers,
      `underchat-service-cutover-${hostname()}`,
      'provisioner'
    ),
    logLevel: logLevel.NOTHING,
    connectionTimeout: 10_000,
    requestTimeout: 10_000,
    retry: {
      retries: 5,
      initialRetryTime: 300,
      maxRetryTime: 5_000,
    },
  };

  return new Kafka(config).admin();
}

function barrierKeySuffix(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class ServiceApiKafkaCutoverBarrier {
  private readonly generationMarker: string;
  private readonly redis: Pick<Redis, 'get' | 'set' | 'eval'>;
  private readonly logger: CutoverLogger;
  private readonly createAdmin: () => KafkaAdminLike;
  private readonly bindings: readonly ServiceApiWhatsappConsumerBinding[];
  private readonly groupIds: readonly string[];
  private readonly pollIntervalMs: number;
  private readonly emptyStabilityMs: number;
  private readonly lockLeaseMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isCancelled: () => boolean;
  private readonly lockKey: string;
  private readonly releaseKey: string;

  constructor(options: ServiceApiKafkaCutoverBarrierOptions) {
    const token = options.token.trim();
    this.generationMarker = serviceApiKafkaCutoverGenerationMarker(token);

    const keySuffix = barrierKeySuffix(token);
    this.redis = options.redis;
    this.logger = options.logger;
    this.createAdmin = options.createAdmin ?? createKafkaAdmin;
    this.bindings = this.validateBindings(
      options.bindings ?? SERVICE_API_WHATSAPP_CONSUMER_BINDINGS
    );
    this.groupIds = Object.freeze(
      this.bindings.map((binding) => binding.groupId)
    );
    this.pollIntervalMs =
      options.pollIntervalMs ??
      readPositiveIntegerEnv('SERVICE_API_KAFKA_CUTOVER_POLL_MS', 2_000);
    this.emptyStabilityMs =
      options.emptyStabilityMs ??
      readPositiveIntegerEnv(
        'SERVICE_API_KAFKA_CUTOVER_EMPTY_STABILITY_MS',
        15_000
      );
    this.lockLeaseMs =
      options.lockLeaseMs ??
      readPositiveIntegerEnv('SERVICE_API_KAFKA_CUTOVER_LOCK_LEASE_MS', 60_000);
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.isCancelled = options.isCancelled ?? (() => false);
    this.lockKey = `service-api:kafka-cutover:v2:${keySuffix}:lock`;
    this.releaseKey = `service-api:kafka-cutover:v2:${keySuffix}:released`;
  }

  async waitUntilReleased(): Promise<void> {
    const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
    let lastFollowerLogAt = 0;

    for (;;) {
      this.assertNotCancelled();
      try {
        const releaseMarker = await this.redis.get(this.releaseKey);
        if (releaseMarker === this.generationMarker) {
          if (await this.currentReleaseHasNoBlockingMembers()) {
            return;
          }

          await this.sleep(this.pollIntervalMs);
          continue;
        }

        const acquired = await this.redis.set(
          this.lockKey,
          owner,
          'PX',
          this.lockLeaseMs,
          'NX'
        );
        if (acquired === 'OK') {
          if (await this.runLeadershipAttempt(owner)) {
            return;
          }
        } else {
          const now = this.now();
          if (now - lastFollowerLogAt >= 15_000) {
            lastFollowerLogAt = now;
            this.logger.info(
              { cutover_generation: this.generationMarker },
              'Service API: aguardando o pod líder liberar a barreira Kafka'
            );
          }
        }
      } catch (error) {
        this.assertNotCancelled();
        this.logger.warn(
          {
            cutover_generation: this.generationMarker,
            err: error,
          },
          'Service API: tentativa da barreira Kafka falhou; consumers permanecem fechados e a validação será repetida'
        );
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  private validateBindings(
    bindings: readonly ServiceApiWhatsappConsumerBinding[]
  ): readonly ServiceApiWhatsappConsumerBinding[] {
    if (bindings.length === 0) {
      throw new Error(
        'Service API Kafka cutover requires at least one group/topic binding'
      );
    }

    const groupIds = new Set<string>();
    return Object.freeze(
      bindings.map((binding) => {
        const groupId = binding.groupId.trim();
        const topic = binding.topic.trim();
        if (!groupId || !topic) {
          throw new Error(
            'Service API Kafka cutover group/topic bindings must not be empty'
          );
        }
        if (groupIds.has(groupId)) {
          throw new Error(
            `Service API Kafka cutover contains duplicate group ${groupId}`
          );
        }
        groupIds.add(groupId);
        return Object.freeze({ groupId, topic });
      })
    );
  }

  private async ensureTopicsExist(admin: KafkaAdminLike): Promise<void> {
    const topics = Array.from(
      new Set(this.bindings.map((binding) => binding.topic))
    ).map((topic) => ({
      topic,
      numPartitions: KAFKA_GLOBAL_TOPIC_CONFIG.numPartitions,
      replicationFactor: KAFKA_GLOBAL_TOPIC_CONFIG.replicationFactor,
    }));

    await admin.createTopics({
      waitForLeaders: true,
      timeout: 30_000,
      topics,
    });

    const metadata = await admin.fetchTopicMetadata({
      topics: topics.map(({ topic }) => topic),
    });
    const partitionCountByTopic = new Map(
      metadata.topics.map((topic) => [topic.name, topic.partitions.length])
    );
    const undersizedTopics = topics.flatMap(({ topic, numPartitions }) => {
      const currentCount = partitionCountByTopic.get(topic);
      if (currentCount === undefined) {
        throw new Error(
          `Kafka topic ${topic} is missing after cutover topic creation`
        );
      }
      return currentCount < numPartitions
        ? [{ topic, count: numPartitions }]
        : [];
    });

    if (undersizedTopics.length > 0) {
      await admin.createPartitions({
        timeout: 30_000,
        topicPartitions: undersizedTopics,
      });
    }
  }

  private async positionAllGroupsAtHighWatermark(
    admin: KafkaAdminLike,
    lockWatchdog: LeadershipLockWatchdog
  ): Promise<PositionedConsumerGroup[] | null> {
    const positioned: PositionedConsumerGroup[] = [];

    for (const binding of this.bindings) {
      this.assertNotCancelled();
      await lockWatchdog.assertOwned();
      if (!(await this.allGroupsRemainEmpty(admin, binding, 'before_fetch'))) {
        return null;
      }

      const highWatermarks = this.normalizeHighWatermarks(
        binding.topic,
        await admin.fetchTopicOffsets(binding.topic)
      );

      await lockWatchdog.assertOwned();
      if (
        !(await this.allGroupsRemainEmpty(admin, binding, 'before_set_offsets'))
      ) {
        return null;
      }

      await admin.setOffsets({
        groupId: binding.groupId,
        topic: binding.topic,
        partitions: highWatermarks,
      });

      await lockWatchdog.assertOwned();
      await this.confirmExactOffsets(admin, binding, highWatermarks);

      if (!(await this.allGroupsRemainEmpty(admin, binding, 'after_confirm'))) {
        return null;
      }

      positioned.push({
        group_id: binding.groupId,
        topic: binding.topic,
        partitions: highWatermarks.length,
      });
    }

    await lockWatchdog.assertOwned();
    return (await this.allGroupsRemainEmpty(admin, null, 'after_all_groups'))
      ? positioned
      : null;
  }

  private async allGroupsRemainEmpty(
    admin: KafkaAdminLike,
    binding: ServiceApiWhatsappConsumerBinding | null,
    phase: string
  ): Promise<boolean> {
    const occupied = await this.describeNonEmptyGroups(admin);
    if (occupied.length === 0) {
      return true;
    }

    this.logger.warn(
      {
        cutover_generation: this.generationMarker,
        group_id: binding?.groupId,
        topic: binding?.topic,
        phase,
        occupied_groups: occupied,
      },
      'Service API: membro Kafka detectado durante o preposicionamento; tentativa descartada'
    );
    return false;
  }

  private normalizeHighWatermarks(
    topic: string,
    offsets: Array<
      KafkaTopicPartitionOffsetLike & { high: string; low: string }
    >
  ): KafkaTopicPartitionOffsetLike[] {
    if (offsets.length === 0) {
      throw new Error(
        `Kafka returned no partitions while positioning topic ${topic}`
      );
    }

    const partitions = new Set<number>();
    return offsets
      .map((entry) => {
        if (!Number.isSafeInteger(entry.partition) || entry.partition < 0) {
          throw new Error(
            `Kafka returned invalid partition ${String(
              entry.partition
            )} for topic ${topic}`
          );
        }
        if (partitions.has(entry.partition)) {
          throw new Error(
            `Kafka returned duplicate partition ${entry.partition} for topic ${topic}`
          );
        }
        partitions.add(entry.partition);

        return {
          partition: entry.partition,
          offset: this.normalizeKafkaOffset(
            entry.high,
            `${topic}[${entry.partition}] high watermark`
          ),
        };
      })
      .sort((left, right) => left.partition - right.partition);
  }

  private async confirmExactOffsets(
    admin: KafkaAdminLike,
    binding: ServiceApiWhatsappConsumerBinding,
    expected: KafkaTopicPartitionOffsetLike[]
  ): Promise<void> {
    const fetched = await admin.fetchOffsets({
      groupId: binding.groupId,
      topics: [binding.topic],
      resolveOffsets: false,
    });
    const topicOffsets = fetched.find(
      (candidate) => candidate.topic === binding.topic
    );
    if (!topicOffsets) {
      throw new Error(
        `Kafka did not return committed offsets for ${binding.groupId}/${binding.topic}`
      );
    }

    const confirmed = new Map<number, string>();
    for (const entry of topicOffsets.partitions) {
      if (!Number.isSafeInteger(entry.partition) || entry.partition < 0) {
        throw new Error(
          `Kafka returned invalid committed partition ${String(
            entry.partition
          )} for ${binding.groupId}/${binding.topic}`
        );
      }
      if (confirmed.has(entry.partition)) {
        throw new Error(
          `Kafka returned duplicate committed partition ${entry.partition} for ${binding.groupId}/${binding.topic}`
        );
      }
      confirmed.set(
        entry.partition,
        this.normalizeKafkaOffset(
          entry.offset,
          `${binding.groupId}/${binding.topic}[${entry.partition}] committed offset`
        )
      );
    }

    if (confirmed.size !== expected.length) {
      throw new Error(
        `Kafka cutover offset confirmation returned ${confirmed.size} partitions for ${binding.groupId}/${binding.topic}; expected ${expected.length}`
      );
    }

    for (const partition of expected) {
      const actual = confirmed.get(partition.partition);
      if (actual !== partition.offset) {
        throw new Error(
          `Kafka cutover offset confirmation failed for ${binding.groupId}/${binding.topic}[${partition.partition}]: expected ${partition.offset}, got ${String(
            actual
          )}`
        );
      }
    }
  }

  private normalizeKafkaOffset(value: string, context: string): string {
    try {
      const offset = BigInt(value);
      if (offset < 0n) {
        throw new Error('negative');
      }
      return offset.toString();
    } catch {
      throw new Error(
        `Kafka returned invalid offset ${String(value)} for ${context}`
      );
    }
  }

  private startLeadershipLockWatchdog(owner: string): LeadershipLockWatchdog {
    let stopped = false;
    let failure: unknown;
    let renewalInFlight: Promise<void> | null = null;

    const renew = async (): Promise<void> => {
      if (failure) {
        throw failure;
      }
      try {
        const extended = Number(
          await this.redis.eval(
            EXTEND_LOCK_SCRIPT,
            1,
            this.lockKey,
            owner,
            String(this.lockLeaseMs)
          )
        );
        if (extended !== 1) {
          throw new Error(
            'Service API Kafka cutover leadership lock is no longer owned'
          );
        }
      } catch (error) {
        failure = error;
        throw error;
      }
    };

    const startRenewal = (): void => {
      if (stopped || failure || renewalInFlight) {
        return;
      }
      renewalInFlight = renew()
        .catch(() => undefined)
        .finally(() => {
          renewalInFlight = null;
        });
    };

    const timer = setInterval(
      startRenewal,
      Math.max(10, Math.floor(this.lockLeaseMs / 3))
    );
    timer.unref();

    return {
      assertOwned: async () => {
        if (renewalInFlight) {
          await renewalInFlight;
        } else {
          await renew();
        }
        if (failure) {
          throw failure;
        }
      },
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await renewalInFlight;
      },
    };
  }

  private async runLeader(owner: string): Promise<boolean> {
    const admin = this.createAdmin();
    const lockWatchdog = this.startLeadershipLockWatchdog(owner);
    let emptySince: number | null = null;
    let lastOccupiedSignature = '';

    this.logger.warn(
      {
        cutover_generation: this.generationMarker,
        groups: this.groupIds,
        required_empty_ms: this.emptyStabilityMs,
      },
      'Service API: pod líder aguardando todos os consumer groups ficarem completamente vazios'
    );

    try {
      await admin.connect();
      await lockWatchdog.assertOwned();
      await this.ensureTopicsExist(admin);
      await lockWatchdog.assertOwned();

      for (;;) {
        this.assertNotCancelled();
        await lockWatchdog.assertOwned();

        let occupied: OccupiedConsumerGroup[];
        try {
          occupied = await this.describeNonEmptyGroups(admin);
        } catch (error) {
          emptySince = null;
          this.logger.warn(
            {
              cutover_generation: this.generationMarker,
              err: error,
            },
            'Service API: falha ao inspecionar consumer groups; barreira permanece fechada'
          );
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        if (occupied.length > 0) {
          emptySince = null;
          const signature = JSON.stringify(occupied);
          if (signature !== lastOccupiedSignature) {
            lastOccupiedSignature = signature;
            this.logger.warn(
              {
                cutover_generation: this.generationMarker,
                occupied_groups: occupied,
              },
              'Service API: consumer groups ainda possuem membros; offsets não serão alterados'
            );
          }
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        emptySince ??= this.now();
        const emptyForMs = this.now() - emptySince;
        if (emptyForMs >= this.emptyStabilityMs) {
          const positioned = await this.positionAllGroupsAtHighWatermark(
            admin,
            lockWatchdog
          );
          if (positioned === null) {
            emptySince = null;
            await this.sleep(this.pollIntervalMs);
            continue;
          }

          await lockWatchdog.assertOwned();
          const occupiedBeforeRelease =
            await this.describeNonEmptyGroups(admin);
          if (occupiedBeforeRelease.length > 0) {
            emptySince = null;
            this.logger.warn(
              {
                cutover_generation: this.generationMarker,
                occupied_groups: occupiedBeforeRelease,
              },
              'Service API: um consumer entrou antes do release; barreira será repetida'
            );
            await this.sleep(this.pollIntervalMs);
            continue;
          }

          const released = await this.release(owner, emptyForMs, positioned);
          return released;
        }

        await this.sleep(this.pollIntervalMs);
      }
    } finally {
      await lockWatchdog.stop();
      await admin.disconnect().catch(() => undefined);
    }
  }

  private async describeNonEmptyGroups(
    admin: KafkaAdminLike
  ): Promise<OccupiedConsumerGroup[]> {
    return this.describeOccupiedGroups(admin, () => true);
  }

  private async describeBlockingLegacyGroups(
    admin: KafkaAdminLike
  ): Promise<OccupiedConsumerGroup[]> {
    return this.describeOccupiedGroups(
      admin,
      (member) =>
        !isServiceApiKafkaConsumerFromGeneration(
          member?.clientId,
          this.generationMarker
        )
    );
  }

  private async describeOccupiedGroups(
    admin: KafkaAdminLike,
    isBlockingMember: (member: KafkaGroupMemberLike) => boolean
  ): Promise<OccupiedConsumerGroup[]> {
    const descriptions = await admin.describeGroups([...this.groupIds]);
    const byGroup = new Map(
      descriptions.groups.map((group) => [group.groupId, group])
    );

    const missingGroups = this.groupIds.filter(
      (groupId) => !byGroup.has(groupId)
    );
    if (missingGroups.length > 0) {
      throw new Error(
        `Kafka did not return descriptions for groups: ${missingGroups.join(', ')}`
      );
    }

    return this.groupIds.flatMap((groupId) => {
      const description = byGroup.get(groupId);
      const blockingMembers =
        description?.members.filter(isBlockingMember) ?? [];
      return blockingMembers.length > 0
        ? [
            {
              group_id: groupId,
              members: blockingMembers.length,
              state: description?.state ?? 'Unknown',
            },
          ]
        : [];
    });
  }

  private async release(
    owner: string,
    emptyForMs: number,
    positioned: PositionedConsumerGroup[]
  ): Promise<boolean> {
    this.assertNotCancelled();
    const released = Number(
      await this.redis.eval(
        RELEASE_BARRIER_SCRIPT,
        2,
        this.lockKey,
        this.releaseKey,
        owner,
        this.generationMarker
      )
    );
    if (released !== 1) {
      return false;
    }

    this.logger.warn(
      {
        cutover_generation: this.generationMarker,
        groups: this.groupIds,
        empty_for_ms: emptyForMs,
        positioned_groups: positioned,
      },
      'Service API: offsets confirmados no high watermark e barreira Kafka liberada para todos os pods desta versão'
    );
    return true;
  }

  private async currentReleaseHasNoBlockingMembers(): Promise<boolean> {
    const admin = this.createAdmin();
    try {
      await admin.connect();
      const occupied = await this.describeBlockingLegacyGroups(admin);
      if (occupied.length === 0) {
        return true;
      }

      this.logger.warn(
        {
          cutover_generation: this.generationMarker,
          occupied_groups: occupied,
        },
        'Service API: release Kafka existente não é seguro enquanto houver membros legados'
      );
      return false;
    } catch (error) {
      this.logger.warn(
        {
          cutover_generation: this.generationMarker,
          err: error,
        },
        'Service API: não foi possível validar o release Kafka; barreira permanece fechada'
      );
      return false;
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  private async releaseLeadershipLock(owner: string): Promise<void> {
    await this.redis
      .eval(RELEASE_LOCK_SCRIPT, 1, this.lockKey, owner)
      .catch((error) => {
        this.logger.warn(
          {
            cutover_generation: this.generationMarker,
            err: error,
          },
          'Service API: falha ao liberar lock da barreira Kafka; o lease continuará limitando a liderança'
        );
      });
  }

  private async runLeadershipAttempt(owner: string): Promise<boolean> {
    try {
      return await this.runLeader(owner);
    } finally {
      await this.releaseLeadershipLock(owner);
    }
  }

  private assertNotCancelled(): void {
    if (this.isCancelled()) {
      throw new Error('Service API Kafka cutover barrier was cancelled');
    }
  }
}
