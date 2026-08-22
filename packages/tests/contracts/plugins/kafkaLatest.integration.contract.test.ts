import 'reflect-metadata';
import type {
  IAdminClient,
  KafkaConsumer,
  Producer,
  TopicPartitionOffset,
} from 'node-rdkafka';
import { Kafka as KafkaJs, logLevel, type KafkaConfig } from 'kafkajs';

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { ServiceApiKafkaCutoverBarrier } from '@core/common/functions/serviceApiKafkaCutoverBarrier';
import { buildWorkerKafkaConsumerGroup } from '@core/common/functions/workerKafkaConsumerGroups';
import { rdkafka } from '@core/common/vendors/nodeRdkafka';
import { KafkaStreamsClient } from '@core/plugins/kafkaStreams';
import {
  normalizeKafkaSecurityProtocol,
  resolveKafkaSecurityConfig,
} from '@core/common/functions/kafkaSecurityConfig';
import { buildKafkaJsTlsConfig } from '@core/common/functions/kafkaAdminConfig';
import { KAFKA_GLOBAL_TOPIC_CONFIG } from '@core/common/functions/kafkaTopicConfig';

const broker = process.env.TEST_KAFKA_BROKER?.trim();
const integrationTest = broker ? it : it.skip;
const testKafkaProtocol = normalizeKafkaSecurityProtocol(
  process.env.TEST_KAFKA_SECURITY_PROTOCOL?.trim() || 'plaintext'
);
const testKafkaUsesSasl =
  testKafkaProtocol === 'sasl_plaintext' || testKafkaProtocol === 'sasl_ssl';
const testKafkaUsername = testKafkaUsesSasl
  ? process.env.TEST_KAFKA_USERNAME?.trim()
  : undefined;
const testKafkaPassword = testKafkaUsesSasl
  ? process.env.TEST_KAFKA_PASSWORD
  : undefined;
const testKafkaSaslMechanism = testKafkaUsesSasl
  ? process.env.TEST_KAFKA_SASL_MECHANISM?.trim() || 'PLAIN'
  : undefined;
const testKafkaCaLocation =
  process.env.TEST_KAFKA_SSL_CA_LOCATION?.trim() || undefined;

function testKafkaStreamsClient(
  brokerUrl: string,
  clientId: string
): KafkaStreamsClient {
  return new KafkaStreamsClient(
    brokerUrl,
    clientId,
    testKafkaUsername,
    testKafkaPassword,
    testKafkaProtocol,
    testKafkaSaslMechanism,
    1,
    1,
    100,
    1024
  );
}

function testKafkaJsConfig(brokerUrl: string, clientId: string): KafkaConfig {
  resolveKafkaSecurityConfig({
    protocol: testKafkaProtocol,
    username: testKafkaUsername,
    password: testKafkaPassword,
    saslMechanism: testKafkaSaslMechanism,
    caLocation: testKafkaCaLocation,
  });
  return {
    clientId,
    brokers: brokerUrl
      .split(',')
      .map((candidate) => candidate.trim())
      .filter(Boolean),
    logLevel: logLevel.NOTHING,
    ssl:
      testKafkaProtocol === 'ssl' || testKafkaProtocol === 'sasl_ssl'
        ? buildKafkaJsTlsConfig(testKafkaCaLocation)
        : undefined,
    sasl: testKafkaUsesSasl
      ? ({
          mechanism: testKafkaSaslMechanism?.toLowerCase(),
          username: testKafkaUsername,
          password: testKafkaPassword,
        } as KafkaConfig['sasl'])
      : undefined,
  };
}

class BarrierMemoryRedis {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _expiry: 'PX',
    _ttl: number,
    mode: 'NX'
  ): Promise<'OK' | null> {
    if (mode === 'NX' && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return 'OK';
  }

  async eval(
    script: string,
    _keyCount: number,
    ...args: Array<string | number>
  ): Promise<number> {
    if (script.includes("redis.call('PEXPIRE'")) {
      const [lockKey, owner] = args.map(String);
      return this.values.get(lockKey) === owner ? 1 : 0;
    }

    if (script.includes("return redis.call('DEL', KEYS[1])")) {
      const [lockKey, owner] = args.map(String);
      if (this.values.get(lockKey) !== owner) {
        return 0;
      }
      this.values.delete(lockKey);
      return 1;
    }

    const [lockKey, releaseKey, owner, generationMarker] = args.map(String);
    if (this.values.get(lockKey) !== owner) {
      return 0;
    }
    this.values.set(releaseKey, generationMarker);
    this.values.delete(lockKey);
    return 1;
  }
}

function adminClient(brokerUrl: string): IAdminClient {
  return rdkafka.AdminClient.create({
    'metadata.broker.list': brokerUrl,
    ...resolveKafkaSecurityConfig({
      protocol: testKafkaProtocol,
      username: testKafkaUsername,
      password: testKafkaPassword,
      saslMechanism: testKafkaSaslMechanism,
      caLocation: testKafkaCaLocation,
    }),
  });
}

async function createTopic(
  admin: IAdminClient,
  topic: string,
  partitions: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    admin.createTopic(
      {
        topic,
        num_partitions: partitions,
        replication_factor: 1,
      },
      10_000,
      (error) => (error ? reject(error) : resolve())
    );
  });
}

async function createPartitions(
  admin: IAdminClient,
  topic: string,
  partitions: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    admin.createPartitions(topic, partitions, 10_000, (error) =>
      error ? reject(error) : resolve()
    );
  });
}

async function connectProducer(producer: Producer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    producer.connect({}, (error) => (error ? reject(error) : resolve()));
  });
  producer.setPollInterval(10);
}

async function waitForTopicPartitionCount(
  client: Pick<Producer, 'getMetadata'>,
  topic: string,
  expectedCount: number,
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await new Promise<number>((resolve, reject) => {
      client.getMetadata({ topic, timeout: 5_000 }, (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }
        const topicMetadata = metadata.topics.find(
          (candidate) => candidate.name === topic
        );
        resolve(topicMetadata?.partitions.length ?? 0);
      });
    });
    if (count >= expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for ${expectedCount} metadata partitions on ${topic}`
  );
}

async function seedConsumerGroupOffset(
  kafka: KafkaJs,
  groupId: string,
  topic: string,
  offset: string,
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const admin = kafka.admin();
    try {
      await admin.connect();
      await admin.setOffsets({
        groupId,
        topic,
        partitions: [{ partition: 0, offset }],
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out seeding consumer group offset for ${topic}`);
}

async function disconnectProducerSafely(producer: Producer): Promise<void> {
  if (!producer.isConnected()) {
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      producer.disconnect(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function connectConsumerSafely(consumer: KafkaConsumer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      consumer.removeListener('ready', readyHandler);
      consumer.removeListener('event.error', errorHandler);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const readyHandler = (): void => finish();
    const errorHandler = (error: unknown): void => finish(error);
    consumer.once('ready', readyHandler);
    consumer.once('event.error', errorHandler);
    consumer.connect({}, (error) => {
      if (error) {
        finish(error);
      }
    });
  });
}

async function disconnectConsumerSafely(
  consumer: KafkaConsumer | null
): Promise<void> {
  if (!consumer) {
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      consumer.unsubscribe();
    } catch {}
    try {
      consumer.disconnect(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function readCommittedOffsets(
  consumer: KafkaConsumer,
  assignments: Array<{ topic: string; partition: number }>
): Promise<TopicPartitionOffset[]> {
  return new Promise((resolve, reject) => {
    consumer.committed(assignments, 5_000, (error, offsets) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(offsets ?? []);
    });
  });
}

async function publishPartitionValues(
  producer: Producer,
  topic: string,
  prefix: string,
  partitions: number
): Promise<void> {
  for (let partition = 0; partition < partitions; partition += 1) {
    producer.produce(
      topic,
      partition,
      Buffer.from(`${prefix}${partition}`),
      `key-${partition}`,
      Date.now()
    );
  }
  await new Promise<void>((resolve, reject) => {
    producer.flush(10_000, (error) => (error ? reject(error) : resolve()));
  });
}

async function publishTopicPartitionValues(
  producer: Producer,
  topics: string[],
  prefix: string,
  partitions: number
): Promise<void> {
  for (const topic of topics) {
    for (let partition = 0; partition < partitions; partition += 1) {
      producer.produce(
        topic,
        partition,
        Buffer.from(`${prefix}${partition}`),
        `key-${partition}`,
        Date.now()
      );
    }
  }
  await new Promise<void>((resolve, reject) => {
    producer.flush(10_000, (error) => (error ? reject(error) : resolve()));
  });
}

async function receiveExactly(
  received: string[],
  expected: string[],
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (received.length >= expected.length) {
      expect([...received].sort()).toEqual([...expected].sort());
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for ${expected.join(',')}; received ${received.join(',')}`
  );
}

async function waitForAssignmentCount(
  runner: KafkaConsumerRunner<string>,
  expectedCount: number,
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const managedConsumer = runner.consumer as
    | (NonNullable<typeof runner.consumer> & {
        __health?: () => {
          assignments?: unknown[];
          assignments_ready?: boolean;
        };
      })
    | null;

  while (Date.now() < deadline) {
    const health = managedConsumer?.__health?.();
    if (
      health?.assignments_ready === true &&
      health.assignments?.length === expectedCount
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(
    `Timed out waiting for ${expectedCount} ready Kafka assignments`
  );
}

async function waitForReadyAssignmentDistribution(
  runners: KafkaConsumerRunner<string>[],
  expectedCounts: number[],
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const expected = [...expectedCounts].sort((left, right) => left - right);

  while (Date.now() < deadline) {
    const health = runners.map((runner) => {
      const consumer = runner.consumer as
        | (NonNullable<typeof runner.consumer> & {
            __health?: () => {
              assignments?: unknown[];
              assignments_ready?: boolean;
            };
          })
        | null;
      return consumer?.__health?.();
    });
    const assignmentCounts = health
      .map((snapshot) => snapshot?.assignments?.length ?? -1)
      .sort((left, right) => left - right);

    if (
      health.every((snapshot) => snapshot?.assignments_ready === true) &&
      assignmentCounts.length === expected.length &&
      assignmentCounts.every((count, index) => count === expected[index])
    ) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(
    `Timed out waiting for ready Kafka assignment distribution ${expected.join(
      ','
    )}`
  );
}

describe('node-rdkafka committed-offset durability integration', () => {
  integrationTest(
    'preserves initial and disconnected backlog on all assigned partitions',
    async () => {
      if (!broker) {
        throw new Error(
          'TEST_KAFKA_BROKER is required for Kafka integration test'
        );
      }

      const topic = `codex.typescript.latest.${Date.now()}.${Math.random()
        .toString(16)
        .slice(2)}`;
      const groupId = `group-underchat-send-integration-${Date.now()}`;
      const partitions = 3;
      const admin = adminClient(broker);
      const kafka = testKafkaStreamsClient(
        broker,
        `codex-typescript-${Date.now()}`
      );
      const producer = kafka.createProducer();
      const received: string[] = [];
      const runner = new KafkaConsumerRunner<string>({
        kafka,
        topic,
        groupId,
        startPosition: 'committed',
        parse: (message) => message.value?.toString('utf8') ?? null,
        handle: async (value) => {
          received.push(value);
        },
        maxInFlightTotal: partitions,
        maxInFlightPerPartition: 1,
      });

      try {
        await createTopic(admin, topic, partitions);
        await connectProducer(producer);
        await publishPartitionValues(producer, topic, 'A', partitions);
        await publishPartitionValues(producer, topic, 'B', partitions);

        await runner.start();
        await receiveExactly(received, ['A0', 'A1', 'A2', 'B0', 'B1', 'B2']);
        received.length = 0;
        await publishPartitionValues(producer, topic, 'C', partitions);
        await receiveExactly(received, ['C0', 'C1', 'C2']);
        await runner.close();

        received.length = 0;
        await publishPartitionValues(producer, topic, 'D', partitions);
        await runner.start();
        await receiveExactly(received, ['D0', 'D1', 'D2']);
        received.length = 0;
        await publishPartitionValues(producer, topic, 'E', partitions);
        await receiveExactly(received, ['E0', 'E1', 'E2']);
      } finally {
        await runner.close().catch(() => undefined);
        await disconnectProducerSafely(producer);
        await new Promise<void>((resolve) => {
          admin.deleteTopic(topic, 5_000, () => resolve());
        });
        admin.disconnect();
      }
    },
    45_000
  );

  integrationTest(
    'commits processed backlog so a replacement consumer resumes without replay',
    async () => {
      if (!broker) {
        throw new Error(
          'TEST_KAFKA_BROKER is required for Kafka integration test'
        );
      }

      const topic = `codex.typescript.latest.committed.${Date.now()}.${Math.random()
        .toString(16)
        .slice(2)}`;
      const groupId = `group-underchat-committed-integration-${Date.now()}`;
      const admin = adminClient(broker);
      const kafka = testKafkaStreamsClient(
        broker,
        `codex-typescript-committed-${Date.now()}`
      );
      const producer = kafka.createProducer();
      const latestReceived: string[] = [];
      const legacyReceived: string[] = [];
      const runner = new KafkaConsumerRunner<string>({
        kafka,
        topic,
        groupId,
        startPosition: 'committed',
        parse: (message) => message.value?.toString('utf8') ?? null,
        handle: async (value) => {
          latestReceived.push(value);
        },
        maxInFlightTotal: 1,
        maxInFlightPerPartition: 1,
      });
      let legacyConsumer: KafkaConsumer | null = null;

      try {
        await createTopic(admin, topic, 1);
        await connectProducer(producer);
        await publishPartitionValues(producer, topic, 'A', 1);
        await publishPartitionValues(producer, topic, 'B', 1);

        await runner.start();
        await receiveExactly(latestReceived, ['A0', 'B0']);
        await runner.close();

        legacyConsumer = kafka.createConsumer(groupId);
        await connectConsumerSafely(legacyConsumer);
        await expect(
          readCommittedOffsets(legacyConsumer, [{ topic, partition: 0 }])
        ).resolves.toEqual([
          expect.objectContaining({
            topic,
            partition: 0,
            offset: 2,
          }),
        ]);

        legacyConsumer.on('data', (message) => {
          if (message.value) {
            legacyReceived.push(message.value.toString('utf8'));
          }
        });
        legacyConsumer.subscribe([topic]);
        legacyConsumer.consume();

        await new Promise((resolve) => setTimeout(resolve, 1_500));
        expect(legacyReceived).toEqual([]);

        await publishPartitionValues(producer, topic, 'C', 1);
        await receiveExactly(legacyReceived, ['C0']);
      } finally {
        await runner.close().catch(() => undefined);
        await disconnectConsumerSafely(legacyConsumer);
        await disconnectProducerSafely(producer);
        await new Promise<void>((resolve) => {
          admin.deleteTopic(topic, 5_000, () => resolve());
        });
        admin.disconnect();
      }
    },
    60_000
  );

  integrationTest(
    'prepositions an empty Service API group at the broker high watermark before release',
    async () => {
      if (!broker) {
        throw new Error(
          'TEST_KAFKA_BROKER is required for Kafka integration test'
        );
      }

      const suffix = `${Date.now()}.${Math.random().toString(16).slice(2)}`;
      const topic = `codex.service.cutover.${suffix}`;
      const groupId = `group-underchat-service-cutover-${suffix}`;
      const nativeAdmin = adminClient(broker);
      const kafka = testKafkaStreamsClient(
        broker,
        `codex-service-cutover-native-${Date.now()}`
      );
      const kafkaJs = new KafkaJs(
        testKafkaJsConfig(broker, `codex-service-cutover-admin-${Date.now()}`)
      );
      const producer = kafka.createProducer();
      const legacyReceived: string[] = [];
      let legacyConsumer: KafkaConsumer | null = null;

      try {
        await createTopic(nativeAdmin, topic, 1);
        await connectProducer(producer);
        await publishPartitionValues(producer, topic, 'A', 1);
        await publishPartitionValues(producer, topic, 'B', 1);

        await seedConsumerGroupOffset(kafkaJs, groupId, topic, '0');

        await new ServiceApiKafkaCutoverBarrier({
          token: `integration-${suffix}`,
          redis: new BarrierMemoryRedis() as never,
          logger: {
            info: jest.fn(),
            warn: jest.fn(),
          },
          bindings: [{ groupId, topic }],
          createAdmin: () => kafkaJs.admin(),
          pollIntervalMs: 10,
          emptyStabilityMs: 0,
          lockLeaseMs: 5_000,
        }).waitUntilReleased();

        const verifyAdmin = kafkaJs.admin();
        await verifyAdmin.connect();
        try {
          const positionedOffsets = await verifyAdmin.fetchOffsets({
            groupId,
            topics: [topic],
            resolveOffsets: false,
          });
          expect(positionedOffsets).toHaveLength(1);
          expect(positionedOffsets[0]?.topic).toBe(topic);
          expect(positionedOffsets[0]?.partitions).toHaveLength(
            KAFKA_GLOBAL_TOPIC_CONFIG.numPartitions
          );
          const offsetByPartition = new Map(
            positionedOffsets[0]?.partitions.map((partition) => [
              partition.partition,
              partition.offset,
            ])
          );
          for (
            let partition = 0;
            partition < KAFKA_GLOBAL_TOPIC_CONFIG.numPartitions;
            partition += 1
          ) {
            expect(offsetByPartition.get(partition)).toBe(
              partition === 0 ? '2' : '0'
            );
          }
        } finally {
          await verifyAdmin.disconnect();
        }

        legacyConsumer = kafka.createConsumer(groupId);
        await connectConsumerSafely(legacyConsumer);
        legacyConsumer.on('data', (message) => {
          if (message.value) {
            legacyReceived.push(message.value.toString('utf8'));
          }
        });
        legacyConsumer.subscribe([topic]);
        legacyConsumer.consume();

        await new Promise((resolve) => setTimeout(resolve, 1_500));
        expect(legacyReceived).toEqual([]);

        await publishPartitionValues(producer, topic, 'C', 1);
        await receiveExactly(legacyReceived, ['C0']);
      } finally {
        await disconnectConsumerSafely(legacyConsumer);
        await disconnectProducerSafely(producer);
        await new Promise<void>((resolve) => {
          nativeAdmin.deleteTopic(topic, 5_000, () => resolve());
        });
        nativeAdmin.disconnect();
      }
    },
    75_000
  );

  integrationTest(
    'preserves backlog that predates a real partition-expansion reassignment',
    async () => {
      if (!broker) {
        throw new Error(
          'TEST_KAFKA_BROKER is required for Kafka integration test'
        );
      }

      const topic = `codex.typescript.latest.rebalance.${Date.now()}.${Math.random()
        .toString(16)
        .slice(2)}`;
      const groupId = `group-underchat-rebalance-integration-${Date.now()}`;
      const admin = adminClient(broker);
      const kafka = testKafkaStreamsClient(
        broker,
        `codex-typescript-rebalance-${Date.now()}`
      );
      const producer = kafka.createProducer();
      const received: string[] = [];
      const runner = new KafkaConsumerRunner<string>({
        kafka,
        topic,
        groupId,
        startPosition: 'committed',
        parse: (message) => message.value?.toString('utf8') ?? null,
        handle: async (value) => {
          received.push(value);
        },
        maxInFlightTotal: 2,
        maxInFlightPerPartition: 1,
      });

      try {
        await createTopic(admin, topic, 1);
        await connectProducer(producer);
        await publishPartitionValues(producer, topic, 'A', 1);

        await runner.start();
        await receiveExactly(received, ['A0']);
        received.length = 0;
        await publishPartitionValues(producer, topic, 'B', 1);
        await receiveExactly(received, ['B0']);

        await createPartitions(admin, topic, 2);
        await waitForTopicPartitionCount(producer, topic, 2);
        producer.produce(topic, 1, Buffer.from('C1'), 'key-1', Date.now());
        await new Promise<void>((resolve, reject) => {
          producer.flush(10_000, (error) =>
            error ? reject(error) : resolve()
          );
        });
        await waitForAssignmentCount(runner, 2);

        producer.produce(topic, 1, Buffer.from('D1'), 'key-1', Date.now());
        await new Promise<void>((resolve, reject) => {
          producer.flush(10_000, (error) =>
            error ? reject(error) : resolve()
          );
        });
        await receiveExactly(received, ['B0', 'C1', 'D1']);
      } finally {
        await runner.close().catch(() => undefined);
        await disconnectProducerSafely(producer);
        await new Promise<void>((resolve) => {
          admin.deleteTopic(topic, 5_000, () => resolve());
        });
        admin.disconnect();
      }
    },
    60_000
  );

  integrationTest(
    'keeps an excess group member ready as standby and promotes it after owner exit',
    async () => {
      if (!broker) {
        throw new Error(
          'TEST_KAFKA_BROKER is required for Kafka integration test'
        );
      }

      const topic = `codex.typescript.latest.standby.${Date.now()}.${Math.random()
        .toString(16)
        .slice(2)}`;
      const groupId = `group-underchat-standby-integration-${Date.now()}`;
      const admin = adminClient(broker);
      const kafkaClients = [0, 1].map((index) =>
        testKafkaStreamsClient(
          broker,
          `codex-typescript-standby-${index}-${Date.now()}`
        )
      );
      const producer = kafkaClients[0].createProducer();
      const receivedByRunner: string[][] = [[], []];
      const runners = kafkaClients.map(
        (kafka, index) =>
          new KafkaConsumerRunner<string>({
            kafka,
            topic,
            groupId,
            startPosition: 'committed',
            parse: (message) => message.value?.toString('utf8') ?? null,
            handle: async (value) => {
              receivedByRunner[index].push(value);
            },
            maxInFlightTotal: 1,
            maxInFlightPerPartition: 1,
          })
      );

      try {
        await createTopic(admin, topic, 1);
        await connectProducer(producer);

        await Promise.all(runners.map((runner) => runner.start()));
        await waitForReadyAssignmentDistribution(runners, [0, 1]);

        const ownerIndex =
          (
            runners[0].consumer as
              | (NonNullable<(typeof runners)[0]['consumer']> & {
                  __health?: () => { assignments?: unknown[] };
                })
              | null
          )?.__health?.().assignments?.length === 1
            ? 0
            : 1;
        const standbyIndex = ownerIndex === 0 ? 1 : 0;

        await publishPartitionValues(producer, topic, 'B', 1);
        await receiveExactly(receivedByRunner[ownerIndex], ['B0']);
        expect(receivedByRunner[standbyIndex]).toEqual([]);

        await runners[ownerIndex].close();
        await publishPartitionValues(producer, topic, 'R', 1);
        await waitForAssignmentCount(runners[standbyIndex], 1);
        await receiveExactly(receivedByRunner[standbyIndex], ['R0']);
        receivedByRunner[standbyIndex].length = 0;
        await publishPartitionValues(producer, topic, 'C', 1);
        await receiveExactly(receivedByRunner[standbyIndex], ['C0']);
      } finally {
        await Promise.all(
          runners.map((runner) => runner.close().catch(() => undefined))
        );
        await disconnectProducerSafely(producer);
        await new Promise<void>((resolve) => {
          admin.deleteTopic(topic, 5_000, () => resolve());
        });
        admin.disconnect();
      }
    },
    75_000
  );

  integrationTest(
    'preserves disconnected backlog for all seven canonical worker flows',
    async () => {
      if (!broker) {
        throw new Error(
          'TEST_KAFKA_BROKER is required for Kafka integration test'
        );
      }

      const suffix = `${Date.now()}.${Math.random().toString(16).slice(2)}`;
      const workerId = `integration-${suffix}`;
      const flows = [
        'send',
        'schedule-message',
        'validate-phone',
        'notification-send',
        'webhook-integration',
        'mark-read',
        'worker-config-update',
      ] as const;
      const topics = flows.map(
        (flow) => `codex.typescript.latest.${flow}.${suffix}`
      );
      const partitions = 3;
      const admin = adminClient(broker);
      const kafka = testKafkaStreamsClient(
        broker,
        `codex-typescript-seven-${Date.now()}`
      );
      const producer = kafka.createProducer();
      const received: string[] = [];
      const runners = flows.map(
        (flow, index) =>
          new KafkaConsumerRunner<string>({
            kafka,
            topic: topics[index],
            groupId: buildWorkerKafkaConsumerGroup(flow, workerId),
            startPosition: 'committed',
            parse: (message) => message.value?.toString('utf8') ?? null,
            handle: async (value) => {
              received.push(`${flow}:${value}`);
            },
            maxInFlightTotal: partitions,
            maxInFlightPerPartition: 1,
          })
      );
      const expected = (prefix: string) =>
        flows.flatMap((flow) =>
          Array.from(
            { length: partitions },
            (_, partition) => `${flow}:${prefix}${partition}`
          )
        );

      try {
        for (const topic of topics) {
          await createTopic(admin, topic, partitions);
        }
        await connectProducer(producer);
        await publishTopicPartitionValues(producer, topics, 'A', partitions);
        await publishTopicPartitionValues(producer, topics, 'B', partitions);

        await Promise.all(runners.map((runner) => runner.start()));
        await receiveExactly(
          received,
          [...expected('A'), ...expected('B')],
          20_000
        );
        received.length = 0;
        await publishTopicPartitionValues(producer, topics, 'C', partitions);
        await receiveExactly(received, expected('C'), 20_000);
        await Promise.all(runners.map((runner) => runner.close()));

        received.length = 0;
        await publishTopicPartitionValues(producer, topics, 'D', partitions);
        await Promise.all(runners.map((runner) => runner.start()));
        await receiveExactly(received, expected('D'), 20_000);
        received.length = 0;
        await publishTopicPartitionValues(producer, topics, 'E', partitions);
        await receiveExactly(received, expected('E'), 20_000);
      } finally {
        await Promise.all(
          runners.map((runner) => runner.close().catch(() => undefined))
        );
        await disconnectProducerSafely(producer);
        await Promise.all(
          topics.map(
            (topic) =>
              new Promise<void>((resolve) => {
                admin.deleteTopic(topic, 5_000, () => resolve());
              })
          )
        );
        admin.disconnect();
      }
    },
    90_000
  );
});
