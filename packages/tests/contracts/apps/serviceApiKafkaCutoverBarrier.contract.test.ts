import { createHash } from 'node:crypto';
import {
  buildServiceApiKafkaConsumerClientId,
  isServiceApiKafkaBootstrapCutoverEnabled,
  resolveServiceApiKafkaCutoverToken,
  resolveServiceApiWhatsappConsumerGroupId,
  SERVICE_API_WHATSAPP_CONSUMER_BINDINGS,
  SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS,
  SERVICE_API_WHATSAPP_CONSUMER_GROUPS,
  ServiceApiKafkaCutoverBarrier,
  serviceApiKafkaCutoverGenerationMarker,
} from '@core/common/functions/serviceApiKafkaCutoverBarrier';

function releaseKey(token: string): string {
  const suffix = createHash('sha256').update(token.trim()).digest('hex');
  return `service-api:kafka-cutover:v2:${suffix}:released`;
}

function kafkaOffsetAdminMethods(defaultHigh = '7') {
  const committed = new Map<
    string,
    Array<{ partition: number; offset: string }>
  >();
  const createTopics = jest.fn(async () => true);
  const createPartitions = jest.fn(async () => true);
  const fetchTopicMetadata = jest.fn(
    async ({ topics }: { topics: string[] }) => ({
      topics: topics.map((name) => ({
        name,
        partitions: Array.from({ length: 30 }, (_, partition) => ({
          partition,
        })),
      })),
    })
  );
  const fetchTopicOffsets = jest.fn(async () => [
    { partition: 0, offset: defaultHigh, high: defaultHigh, low: '0' },
    { partition: 1, offset: defaultHigh, high: defaultHigh, low: '0' },
  ]);
  const setOffsets = jest.fn(
    async (options: {
      groupId: string;
      topic: string;
      partitions: Array<{ partition: number; offset: string }>;
    }) => {
      committed.set(
        `${options.groupId}/${options.topic}`,
        options.partitions.map((partition) => ({ ...partition }))
      );
    }
  );
  const fetchOffsets = jest.fn(
    async (options: {
      groupId: string;
      topics: string[];
      resolveOffsets: false;
    }) =>
      options.topics.map((topic) => ({
        topic,
        partitions: (committed.get(`${options.groupId}/${topic}`) ?? []).map(
          (partition) => ({
            ...partition,
            metadata: null,
          })
        ),
      }))
  );

  return {
    createTopics,
    createPartitions,
    fetchTopicMetadata,
    fetchTopicOffsets,
    setOffsets,
    fetchOffsets,
  };
}

class MemoryRedis {
  readonly values = new Map<string, string>();

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

describe('ServiceApiKafkaCutoverBarrier', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  it('covers every central group eligible for an explicit one-time bootstrap', () => {
    expect(SERVICE_API_WHATSAPP_CONSUMER_BINDINGS).toEqual([
      {
        groupId: 'group-underchat-message-update',
        topic: 'update.message',
      },
      {
        groupId: 'group-underchat-message-upsert',
        topic: 'upsert.message',
      },
      {
        groupId: 'group-underchat-message-history-sync',
        topic: 'upsert.message.history',
      },
      {
        groupId: 'group-underchat-message-status-update',
        topic: 'update.message.status',
      },
      {
        groupId: 'group-underchat-chat-summary-clear',
        topic: 'clear.chat.summary',
      },
      {
        groupId: 'group-underchat-notification-message',
        topic: 'notification.message',
      },
      {
        groupId: 'group-underchat-official-whatsapp-send',
        topic: 'official.whatsapp.send.message',
      },
      {
        groupId: 'group-underchat-official-whatsapp-webhook',
        topic: 'official.whatsapp.webhook.event',
      },
      {
        groupId: 'group-underchat-schedule-status-update',
        topic: 'schedule.status.update',
      },
      {
        groupId: 'group-underchat-user-phone-jid-update',
        topic: 'user.phone.jid.update',
      },
      {
        groupId: 'group-underchat-phone-validation-response',
        topic: 'phone.validation.response',
      },
      {
        groupId: 'group-underchat-contact-validation-update',
        topic: 'contact.validation.update',
      },
      {
        groupId: 'group-underchat-profile-status-external-id-update',
        topic: 'update.profile.status.external.id',
      },
    ]);
    expect(SERVICE_API_WHATSAPP_CONSUMER_GROUPS).toEqual([
      'group-underchat-message-update',
      'group-underchat-message-upsert',
      'group-underchat-message-history-sync',
      'group-underchat-message-status-update',
      'group-underchat-chat-summary-clear',
      'group-underchat-notification-message',
      'group-underchat-official-whatsapp-send',
      'group-underchat-official-whatsapp-webhook',
      'group-underchat-schedule-status-update',
      'group-underchat-user-phone-jid-update',
      'group-underchat-phone-validation-response',
      'group-underchat-contact-validation-update',
      'group-underchat-profile-status-external-id-update',
    ]);
    expect(Object.values(SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS)).toEqual(
      SERVICE_API_WHATSAPP_CONSUMER_GROUPS
    );
    for (const binding of SERVICE_API_WHATSAPP_CONSUMER_BINDINGS) {
      expect(resolveServiceApiWhatsappConsumerGroupId(binding.topic)).toBe(
        binding.groupId
      );
    }
    expect(() =>
      resolveServiceApiWhatsappConsumerGroupId('internal.chat.direct.message')
    ).toThrow('No Service API WhatsApp consumer group');
  });

  it('derives a non-secret generation marker for the Service API consumer client id', () => {
    const token = 'production-cutover-secret';
    const marker = serviceApiKafkaCutoverGenerationMarker(token);
    const clientId = buildServiceApiKafkaConsumerClientId(
      'client-service',
      token
    );

    expect(marker).toMatch(/^ucg-[a-f0-9]{24}$/);
    expect(clientId).toBe(`client-service--${marker}`);
    expect(clientId).not.toContain(token);
  });

  it('requires a token only when production explicitly enables bootstrap cutover', () => {
    expect(() =>
      resolveServiceApiKafkaCutoverToken({
        nodeEnvironment: 'production',
        bootstrapCutoverEnabled: true,
      })
    ).toThrow('SERVICE_API_KAFKA_CUTOVER_TOKEN is required');

    expect(() =>
      resolveServiceApiKafkaCutoverToken({
        token: 'DEVTRON_SECRET_REQUIRED',
        nodeEnvironment: 'production',
        bootstrapCutoverEnabled: true,
      })
    ).toThrow('SERVICE_API_KAFKA_CUTOVER_TOKEN is required');

    expect(
      resolveServiceApiKafkaCutoverToken({
        token: '  latest-v2  ',
        nodeEnvironment: 'production',
        bootstrapCutoverEnabled: true,
      })
    ).toBe('latest-v2');

    expect(
      resolveServiceApiKafkaCutoverToken({
        nodeEnvironment: 'production',
        bootstrapCutoverEnabled: false,
      })
    ).toBe('');
  });

  it('keeps the destructive bootstrap cutover disabled by default', () => {
    expect(isServiceApiKafkaBootstrapCutoverEnabled(undefined)).toBe(false);
    expect(isServiceApiKafkaBootstrapCutoverEnabled('false')).toBe(false);
    expect(isServiceApiKafkaBootstrapCutoverEnabled('true')).toBe(true);
    expect(isServiceApiKafkaBootstrapCutoverEnabled('1')).toBe(true);
  });

  it('creates topics, positions every empty group at the exact high watermark, and only then releases all pods', async () => {
    const redis = new MemoryRedis();
    let now = 1_000;
    const disconnect = jest.fn(async () => undefined);
    const offsetAdmin = kafkaOffsetAdminMethods();
    const describeGroups = jest.fn(async (groupIds: string[]) => ({
      groups: groupIds.map((groupId) => ({
        groupId,
        members: [],
        state: 'Empty',
      })),
    }));
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token: 'latest-v2',
      redis: redis as never,
      logger,
      createAdmin: () => ({
        ...offsetAdmin,
        connect: jest.fn(async () => undefined),
        disconnect,
        describeGroups,
      }),
      pollIntervalMs: 5,
      emptyStabilityMs: 10,
      lockLeaseMs: 100,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    });

    await barrier.waitUntilReleased();

    expect(offsetAdmin.createTopics).toHaveBeenCalledWith({
      waitForLeaders: true,
      timeout: 30_000,
      topics: SERVICE_API_WHATSAPP_CONSUMER_BINDINGS.map(({ topic }) => ({
        topic,
        numPartitions: 30,
        replicationFactor: 3,
      })),
    });
    expect(offsetAdmin.fetchTopicMetadata).toHaveBeenCalledWith({
      topics: SERVICE_API_WHATSAPP_CONSUMER_BINDINGS.map(({ topic }) => topic),
    });
    expect(offsetAdmin.createPartitions).not.toHaveBeenCalled();
    expect(offsetAdmin.fetchTopicOffsets).toHaveBeenCalledTimes(13);
    expect(offsetAdmin.setOffsets).toHaveBeenCalledTimes(13);
    expect(offsetAdmin.fetchOffsets).toHaveBeenCalledTimes(13);
    expect(offsetAdmin.createTopics.mock.invocationCallOrder[0]).toBeLessThan(
      offsetAdmin.fetchTopicOffsets.mock.invocationCallOrder[0]
    );
    expect(offsetAdmin.setOffsets).toHaveBeenNthCalledWith(1, {
      groupId: SERVICE_API_WHATSAPP_CONSUMER_BINDINGS[0].groupId,
      topic: SERVICE_API_WHATSAPP_CONSUMER_BINDINGS[0].topic,
      partitions: [
        { partition: 0, offset: '7' },
        { partition: 1, offset: '7' },
      ],
    });
    expect(describeGroups.mock.calls.length).toBeGreaterThan(3);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(
      Array.from(redis.values.keys()).some((key) => key.endsWith(':released'))
    ).toBe(true);
  });

  it('expands only cutover topics below the global partition floor', async () => {
    const redis = new MemoryRedis();
    const offsetAdmin = kafkaOffsetAdminMethods();
    offsetAdmin.fetchTopicMetadata.mockResolvedValue({
      topics: SERVICE_API_WHATSAPP_CONSUMER_BINDINGS.map(
        ({ topic }, index) => ({
          name: topic,
          partitions: Array.from(
            { length: index === 0 ? 1 : 30 },
            (_, partition) => ({ partition })
          ),
        })
      ),
    });
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token: 'latest-v2-partition-floor',
      redis: redis as never,
      logger,
      createAdmin: () => ({
        ...offsetAdmin,
        connect: jest.fn(async () => undefined),
        disconnect: jest.fn(async () => undefined),
        describeGroups: jest.fn(async (groupIds: string[]) => ({
          groups: groupIds.map((groupId) => ({
            groupId,
            members: [],
            state: 'Empty',
          })),
        })),
      }),
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await barrier.waitUntilReleased();

    expect(offsetAdmin.createPartitions).toHaveBeenCalledWith({
      timeout: 30_000,
      topicPartitions: [
        {
          topic: SERVICE_API_WHATSAPP_CONSUMER_BINDINGS[0].topic,
          count: 30,
        },
      ],
    });
  });

  it('does not trust an obsolete release while any legacy pod remains in a managed group', async () => {
    const redis = new MemoryRedis();
    const token = 'latest-v3';
    const generationMarker = serviceApiKafkaCutoverGenerationMarker(token);
    redis.values.set(releaseKey(token), 'obsolete-release-owner');
    let describeCount = 0;
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token,
      redis: redis as never,
      logger,
      createAdmin: () => ({
        ...kafkaOffsetAdminMethods(),
        connect: jest.fn(async () => undefined),
        disconnect: jest.fn(async () => undefined),
        describeGroups: jest.fn(async (groupIds: string[]) => {
          describeCount += 1;
          return {
            groups: groupIds.map((groupId, index) => ({
              groupId,
              members:
                index === 0
                  ? describeCount === 1
                    ? [{ clientId: 'legacy-service-client' }]
                    : []
                  : [],
              state: describeCount === 1 && index === 0 ? 'Stable' : 'Empty',
            })),
          };
        }),
      }),
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await barrier.waitUntilReleased();

    expect(describeCount).toBeGreaterThan(2);
    expect(redis.values.get(releaseKey(token))).toBe(generationMarker);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        occupied_groups: [
          expect.objectContaining({
            group_id: SERVICE_API_WHATSAPP_CONSUMER_GROUPS[0],
            members: 1,
          }),
        ],
      }),
      expect.stringContaining('ainda possuem membros')
    );
  });

  it('lets follower pods proceed when the release marker and all members match the current generation', async () => {
    const redis = new MemoryRedis();
    const token = 'latest-v4';
    const generationMarker = serviceApiKafkaCutoverGenerationMarker(token);
    redis.values.set(releaseKey(token), generationMarker);
    const disconnect = jest.fn(async () => undefined);
    const offsetAdmin = kafkaOffsetAdminMethods();
    const createAdmin = jest.fn(() => ({
      ...offsetAdmin,
      connect: jest.fn(async () => undefined),
      disconnect,
      describeGroups: jest.fn(async (groupIds: string[]) => ({
        groups: groupIds.map((groupId) => ({
          groupId,
          members: [
            {
              clientId: buildServiceApiKafkaConsumerClientId(
                'client-service',
                token
              ),
            },
          ],
          state: 'Stable',
        })),
      })),
    }));
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token,
      redis: redis as never,
      logger,
      createAdmin,
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await barrier.waitUntilReleased();

    expect(createAdmin).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(offsetAdmin.createTopics).not.toHaveBeenCalled();
    expect(offsetAdmin.setOffsets).not.toHaveBeenCalled();
    expect(
      Array.from(redis.values.keys()).some((key) => key.endsWith(':lock'))
    ).toBe(false);
  });

  it('keeps a current release closed while an unmarked rollback member is present', async () => {
    const redis = new MemoryRedis();
    const token = 'latest-v4-rollback';
    const generationMarker = serviceApiKafkaCutoverGenerationMarker(token);
    redis.values.set(releaseKey(token), generationMarker);
    let describeCount = 0;
    const currentClientId = buildServiceApiKafkaConsumerClientId(
      'client-service',
      token
    );
    const createAdmin = jest.fn(() => ({
      ...kafkaOffsetAdminMethods(),
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      describeGroups: jest.fn(async (groupIds: string[]) => {
        describeCount += 1;
        return {
          groups: groupIds.map((groupId, index) => ({
            groupId,
            members:
              index === 0
                ? describeCount === 1
                  ? [
                      { clientId: currentClientId },
                      { clientId: 'client-service' },
                    ]
                  : [{ clientId: currentClientId }]
                : [],
            state: 'Stable',
          })),
        };
      }),
    }));
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token,
      redis: redis as never,
      logger,
      createAdmin,
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await barrier.waitUntilReleased();

    expect(createAdmin).toHaveBeenCalledTimes(2);
    expect(describeCount).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        occupied_groups: [
          expect.objectContaining({
            group_id: SERVICE_API_WHATSAPP_CONSUMER_GROUPS[0],
            members: 1,
          }),
        ],
      }),
      expect.stringContaining('release Kafka existente não é seguro')
    );
  });

  it('stays closed and retries when a current release cannot be validated against Kafka', async () => {
    const redis = new MemoryRedis();
    const token = 'latest-v5';
    redis.values.set(
      releaseKey(token),
      serviceApiKafkaCutoverGenerationMarker(token)
    );
    let adminCount = 0;
    const createAdmin = jest.fn(() => {
      adminCount += 1;
      const unavailable = adminCount <= 2;
      return {
        ...kafkaOffsetAdminMethods(),
        connect: jest.fn(async () => {
          if (unavailable) {
            throw new Error('kafka unavailable');
          }
        }),
        disconnect: jest.fn(async () => undefined),
        describeGroups: jest.fn(async (groupIds: string[]) => ({
          groups: groupIds.map((groupId) => ({
            groupId,
            members: [],
            state: 'Empty',
          })),
        })),
      };
    });
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token,
      redis: redis as never,
      logger,
      createAdmin,
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await expect(barrier.waitUntilReleased()).resolves.toBeUndefined();
    expect(createAdmin).toHaveBeenCalledTimes(3);
    expect(redis.values.get(releaseKey(token))).toBe(
      serviceApiKafkaCutoverGenerationMarker(token)
    );
    expect(
      Array.from(redis.values.keys()).some((key) => key.endsWith(':lock'))
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'kafka unavailable' }),
      }),
      expect.stringContaining('não foi possível validar o release Kafka')
    );
  });

  it('stays closed and retries after a transient Redis error', async () => {
    const redis = new MemoryRedis();
    const originalGet = redis.get.bind(redis);
    redis.get = jest
      .fn<ReturnType<MemoryRedis['get']>, Parameters<MemoryRedis['get']>>()
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockImplementation(originalGet);
    const createAdmin = jest.fn(() => ({
      ...kafkaOffsetAdminMethods(),
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      describeGroups: jest.fn(async (groupIds: string[]) => ({
        groups: groupIds.map((groupId) => ({
          groupId,
          members: [],
          state: 'Empty',
        })),
      })),
    }));
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token: 'latest-v5-redis',
      redis: redis as never,
      logger,
      createAdmin,
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await expect(barrier.waitUntilReleased()).resolves.toBeUndefined();
    expect(createAdmin).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'redis unavailable' }),
      }),
      expect.stringContaining('validação será repetida')
    );
  });

  it('fails closed and repeats the entire cutover when Kafka does not confirm an exact committed offset', async () => {
    const redis = new MemoryRedis();
    const offsetAdmin = kafkaOffsetAdminMethods();
    let confirmation = 0;
    offsetAdmin.fetchOffsets.mockImplementation(
      async (options: {
        groupId: string;
        topics: string[];
        resolveOffsets: false;
      }) => {
        confirmation += 1;
        const offset = confirmation === 1 ? '6' : '7';
        return options.topics.map((topic) => ({
          topic,
          partitions: [
            { partition: 0, offset, metadata: null },
            { partition: 1, offset, metadata: null },
          ],
        }));
      }
    );
    const createAdmin = jest.fn(() => ({
      ...offsetAdmin,
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      describeGroups: jest.fn(async (groupIds: string[]) => ({
        groups: groupIds.map((groupId) => ({
          groupId,
          members: [],
          state: 'Empty',
        })),
      })),
    }));
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token: 'latest-v5-offset-confirmation',
      redis: redis as never,
      logger,
      createAdmin,
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await barrier.waitUntilReleased();

    expect(createAdmin).toHaveBeenCalledTimes(2);
    expect(offsetAdmin.setOffsets).toHaveBeenCalledTimes(14);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: expect.stringContaining(
            'Kafka cutover offset confirmation failed'
          ),
        }),
      }),
      expect.stringContaining('validação será repetida')
    );
  });

  it('repeats positioning when any member enters after an offset is confirmed', async () => {
    const redis = new MemoryRedis();
    const offsetAdmin = kafkaOffsetAdminMethods();
    let describeCount = 0;
    const binding = {
      groupId: 'group-underchat-cutover-race-test',
      topic: 'cutover.race.test',
    };
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token: 'latest-v5-member-race',
      redis: redis as never,
      logger,
      bindings: [binding],
      createAdmin: () => ({
        ...offsetAdmin,
        connect: jest.fn(async () => undefined),
        disconnect: jest.fn(async () => undefined),
        describeGroups: jest.fn(async (groupIds: string[]) => {
          describeCount += 1;
          return {
            groups: groupIds.map((groupId) => ({
              groupId,
              members:
                describeCount === 4
                  ? [{ clientId: 'legacy-service-client' }]
                  : [],
              state: describeCount === 4 ? 'Stable' : 'Empty',
            })),
          };
        }),
      }),
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 100,
      sleep: async () => undefined,
    });

    await barrier.waitUntilReleased();

    expect(offsetAdmin.setOffsets).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        group_id: binding.groupId,
        phase: 'after_confirm',
        occupied_groups: [
          expect.objectContaining({
            group_id: binding.groupId,
            members: 1,
          }),
        ],
      }),
      expect.stringContaining('tentativa descartada')
    );
  });

  it('never releases from a leader that loses the Redis lease while offsets are being positioned', async () => {
    const redis = new MemoryRedis();
    const originalEval = redis.eval.bind(redis);
    let extensionCount = 0;
    redis.eval = jest.fn(
      async (
        script: string,
        keyCount: number,
        ...args: Array<string | number>
      ) => {
        if (script.includes("redis.call('PEXPIRE'")) {
          extensionCount += 1;
          if (extensionCount === 6) {
            redis.values.delete(String(args[0]));
            return 0;
          }
        }
        return originalEval(script, keyCount, ...args);
      }
    );
    const offsetAdmin = kafkaOffsetAdminMethods();
    const binding = {
      groupId: 'group-underchat-cutover-lock-test',
      topic: 'cutover.lock.test',
    };
    const createAdmin = jest.fn(() => ({
      ...offsetAdmin,
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      describeGroups: jest.fn(async (groupIds: string[]) => ({
        groups: groupIds.map((groupId) => ({
          groupId,
          members: [],
          state: 'Empty',
        })),
      })),
    }));
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token: 'latest-v5-lock-loss',
      redis: redis as never,
      logger,
      bindings: [binding],
      createAdmin,
      pollIntervalMs: 1,
      emptyStabilityMs: 0,
      lockLeaseMs: 1_000,
      sleep: async () => undefined,
    });

    await barrier.waitUntilReleased();

    expect(createAdmin).toHaveBeenCalledTimes(2);
    expect(offsetAdmin.setOffsets).toHaveBeenCalledTimes(2);
    expect(offsetAdmin.fetchOffsets).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message:
            'Service API Kafka cutover leadership lock is no longer owned',
        }),
      }),
      expect.stringContaining('validação será repetida')
    );
  });

  it('requires a valid mapping with unique consumer groups', () => {
    const redis = new MemoryRedis();
    expect(
      () =>
        new ServiceApiKafkaCutoverBarrier({
          token: 'latest-invalid-bindings',
          redis: redis as never,
          logger,
          bindings: [
            { groupId: 'duplicate-group', topic: 'topic.one' },
            { groupId: 'duplicate-group', topic: 'topic.two' },
          ],
        })
    ).toThrow('duplicate group');
  });

  it('fails closed when shutdown cancels a pending cutover', async () => {
    const redis = new MemoryRedis();
    const createAdmin = jest.fn();
    const barrier = new ServiceApiKafkaCutoverBarrier({
      token: 'latest-v6',
      redis: redis as never,
      logger,
      createAdmin,
      isCancelled: () => true,
    });

    await expect(barrier.waitUntilReleased()).rejects.toThrow('cancelled');
    expect(createAdmin).not.toHaveBeenCalled();
  });
});
