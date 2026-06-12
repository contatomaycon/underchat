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

jest.mock('@core/services/kafkaBaileysQueue.service', () => ({
  KafkaBaileysQueueService: class KafkaBaileysQueueService {},
}));

jest.mock('@core/services/user.service', () => ({
  UserService: class UserService {},
}));

import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { UserPhoneJidUpdateConsume } from '@core/consumer/user/UserPhoneJidUpdate.consume';

class FakeConsumer extends EventEmitter {
  unsubscribe = jest.fn();
  disconnect = jest.fn((callback?: () => void) => callback?.());
}

describe('UserPhoneJidUpdateConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ensures user.phone.jid.update with the global topic configuration', async () => {
    const kafka = {} as never;
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const kafkaBaileysQueueService = {
      userPhoneJidUpdate: jest.fn(() => 'user.phone.jid.update'),
      getNumPartitions: jest.fn(() => 1),
      getReplicationFactor: jest.fn(() => 2),
    };
    const userService = {
      updateUserPhoneJid: jest.fn(async () => undefined),
    };
    const consumer = new UserPhoneJidUpdateConsume(
      kafka,
      kafkaBaileysQueueService as never,
      userService as never
    );

    await consumer.execute();

    expect(ensureKafkaTopic).toHaveBeenCalledWith(
      kafka,
      'user.phone.jid.update',
      30,
      3
    );

    await consumer.close();
  });
});
