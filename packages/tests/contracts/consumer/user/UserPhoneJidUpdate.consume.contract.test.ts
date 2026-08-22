import 'reflect-metadata';
import { EventEmitter } from 'node:events';

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn((_consumer, _topic, onConnected) => onConnected?.()),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/handleConsumerError', () => ({
  handleConsumerError: jest.fn(),
}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/user.service', () => ({
  UserService: class UserService {},
}));

import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { UserPhoneJidUpdateConsume } from '@core/consumer/user/UserPhoneJidUpdate.consume';
import { buildUserPhoneJidUpdateEventId } from '@core/common/functions/userPhoneJidUpdateIdentity';

class FakeConsumer extends EventEmitter {
  unsubscribe = jest.fn();
  disconnect = jest.fn((callback?: () => void) => callback?.());
  __isLatestAssignmentCutoverCommitted = jest.fn(() => true);
}

describe('UserPhoneJidUpdateConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts user.phone.jid.update without mutating Kafka topology', async () => {
    const kafka = {
      getBroker: jest.fn(() => 'broker-a:9092'),
    } as never;
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const kafkaServiceQueueService = {
      userPhoneJidUpdate: jest.fn(() => 'user.phone.jid.update'),
    };
    const userService = {
      updateUserPhoneJid: jest.fn(async () => undefined),
    };
    const runtimeFence = {
      isCurrent: jest.fn(async () => true),
    };
    const consumer = new UserPhoneJidUpdateConsume(
      kafka,
      kafkaServiceQueueService as never,
      userService as never,
      runtimeFence as never
    );

    await consumer.execute();

    expect(ensureKafkaTopic).not.toHaveBeenCalled();
    expect(kafkaServiceQueueService.userPhoneJidUpdate).toHaveBeenCalled();
    expect(createConsumer).toHaveBeenCalledWith(
      kafka,
      expect.any(String),
      expect.objectContaining({
        startPosition: 'committed',
      })
    );

    await consumer.close();
  });

  it('updates the JID only while the producer runtime fence is current', async () => {
    const userService = {
      updateUserPhoneJid: jest.fn(async () => true),
    };
    const runtimeFence = {
      isCurrent: jest.fn(async () => true),
    };
    const consumer = Object.create(UserPhoneJidUpdateConsume.prototype) as any;
    consumer.userService = userService;
    consumer.runtimeFence = runtimeFence;
    const event = {
      user_id: 'user-1',
      phone_jid: '5511999999999@s.whatsapp.net',
      account_id: 'account-1',
      worker_id: 'worker-1',
      operation_id: 'operation-1',
      event_id: 'event-1',
      source_provider: 'baileys',
      runtime_generation: 7,
      connection_epoch: 'epoch-1',
    };

    await consumer.processUpdate(event, jest.fn());

    expect(runtimeFence.isCurrent).toHaveBeenCalledWith(event);
    expect(userService.updateUserPhoneJid).toHaveBeenCalledWith(
      'user-1',
      '5511999999999@s.whatsapp.net',
      {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'baileys',
        runtime_generation: 7,
        connection_epoch: 'epoch-1',
      },
      expect.any(Function)
    );
  });

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'rebinds a durable %s phone-JID result to the active generation and preserves its operation identity',
    async (provider) => {
      const userService = {
        updateUserPhoneJid: jest.fn(async () => true),
      };
      const lease = {
        assertOwned: jest.fn(),
        release: jest.fn(async () => true),
      };
      const runtimeFence = {
        viewAdmissionState: jest.fn(async () => ({
          state: 'active' as const,
          fence: {
            worker_id: 'worker-1',
            source_provider: provider,
            runtime_generation: 12,
            connection_epoch: `${provider}-epoch-12`,
            connection_sequence: 3,
            activated_at: Date.now(),
            state: 'active' as const,
            activation_order: 3,
          },
        })),
        acquireEffectLease: jest.fn(async () => lease),
        isCurrent: jest.fn(async () => false),
      };
      const consumer = Object.create(
        UserPhoneJidUpdateConsume.prototype
      ) as any;
      consumer.userService = userService;
      consumer.runtimeFence = runtimeFence;
      const rotatedEvent = {
        user_id: 'user-1',
        phone_jid: '5511999999999@s.whatsapp.net',
        account_id: 'account-1',
        worker_id: 'worker-1',
        operation_id: 'notification-operation-1',
        source_provider: provider,
        runtime_generation: 7,
        connection_epoch: `${provider}-epoch-7`,
      };
      const eventId = buildUserPhoneJidUpdateEventId(rotatedEvent);
      Object.assign(rotatedEvent, { event_id: eventId });

      await expect(
        consumer.acquireRuntimeEffectLease(rotatedEvent)
      ).resolves.toBe(lease);
      await consumer.processUpdate(rotatedEvent, jest.fn(), true);

      expect(rotatedEvent).toMatchObject({
        event_id: eventId,
        account_id: 'account-1',
        worker_id: 'worker-1',
        operation_id: 'notification-operation-1',
        user_id: 'user-1',
        phone_jid: '5511999999999@s.whatsapp.net',
        source_provider: provider,
        runtime_generation: 12,
        connection_epoch: `${provider}-epoch-12`,
      });
      expect(runtimeFence.isCurrent).not.toHaveBeenCalled();
      expect(userService.updateUserPhoneJid).toHaveBeenCalledWith(
        'user-1',
        '5511999999999@s.whatsapp.net',
        expect.objectContaining({
          account_id: 'account-1',
          worker_id: 'worker-1',
          source_provider: provider,
          runtime_generation: 12,
          connection_epoch: `${provider}-epoch-12`,
        }),
        expect.any(Function)
      );
    }
  );

  it('fails closed for a cross-worker or forged phone-JID recovery', async () => {
    const runtimeFence = {
      viewAdmissionState: jest.fn(),
      acquireEffectLease: jest.fn(),
    };
    const consumer = Object.create(UserPhoneJidUpdateConsume.prototype) as any;
    consumer.runtimeFence = runtimeFence;
    const forged = {
      user_id: 'user-1',
      phone_jid: '5511999999999@s.whatsapp.net',
      account_id: 'account-1',
      worker_id: 'worker-1',
      operation_id: 'operation-1',
      event_id: 'forged-event',
      source_provider: 'baileys',
      runtime_generation: 7,
      connection_epoch: 'epoch-7',
    };

    await expect(
      consumer.acquireRuntimeEffectLease(forged)
    ).rejects.toMatchObject({
      name: 'UnrecoverableAuxiliaryRuntimeEventError',
    });
    expect(runtimeFence.viewAdmissionState).not.toHaveBeenCalled();
    expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
  });

  it('blocks persistence when the connection epoch changes after intake', async () => {
    const persisted = jest.fn();
    const userService = {
      updateUserPhoneJid: jest.fn(
        async (
          _userId: string,
          _phoneJid: string,
          _runtimeFence: unknown,
          assertActive: () => Promise<void>
        ) => {
          await assertActive();
          persisted();
          return true;
        }
      ),
    };
    const runtimeFence = {
      isCurrent: jest
        .fn<Promise<boolean>, any[]>()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const consumer = Object.create(UserPhoneJidUpdateConsume.prototype) as any;
    consumer.userService = userService;
    consumer.runtimeFence = runtimeFence;

    await expect(
      consumer.processUpdate(
        {
          user_id: 'user-1',
          phone_jid: '5511999999999@s.whatsapp.net',
          account_id: 'account-1',
          worker_id: 'worker-1',
          source_provider: 'baileys',
          runtime_generation: 8,
          connection_epoch: 'epoch-replaced',
        },
        jest.fn()
      )
    ).resolves.toBeUndefined();

    expect(userService.updateUserPhoneJid).toHaveBeenCalledTimes(1);
    expect(persisted).not.toHaveBeenCalled();
  });

  it('discards a JID update from an obsolete runtime', async () => {
    const userService = {
      updateUserPhoneJid: jest.fn(async () => true),
    };
    const runtimeFence = {
      isCurrent: jest.fn(async () => false),
    };
    const consumer = Object.create(UserPhoneJidUpdateConsume.prototype) as any;
    consumer.userService = userService;
    consumer.runtimeFence = runtimeFence;

    await consumer.processUpdate(
      {
        user_id: 'user-1',
        phone_jid: '5511999999999@s.whatsapp.net',
        worker_id: 'worker-1',
        source_provider: 'wwebjs',
        runtime_generation: 6,
        connection_epoch: 'obsolete-epoch',
      },
      jest.fn()
    );

    expect(userService.updateUserPhoneJid).not.toHaveBeenCalled();
  });
});
