import 'reflect-metadata';
import { EventEmitter } from 'node:events';

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

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

import { createConsumer } from '@core/common/functions/createConsumer';
import { commitOffset } from '@core/common/functions/commitOffset';

const { ChatSummaryClearConsume } =
  require('@core/consumer/message/ChatSummaryClear.consume') as typeof import('@core/consumer/message/ChatSummaryClear.consume');

class FakeConsumer extends EventEmitter {
  commit = jest.fn();
}

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

describe('ChatSummaryClearConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits the offset when processing fails in the runner handler', async () => {
    const kafkaConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);

    const chatService = {
      clearChatSummary: jest.fn(async () => {
        throw new Error('database timeout');
      }),
      findChatByChatId: jest.fn(),
    };
    const centrifugoService = {
      publishSub: jest.fn(),
    };
    const kafkaServiceQueueService = {
      clearChatSummary: jest.fn(() => 'clear.chat.summary'),
      getNumPartitions: jest.fn(() => 30),
      getReplicationFactor: jest.fn(() => 3),
    };

    const consumer = new ChatSummaryClearConsume(
      {} as never,
      kafkaServiceQueueService as never,
      chatService as never,
      centrifugoService as never
    );

    await consumer.execute();
    kafkaConsumer.emit('data', {
      value: Buffer.from(
        JSON.stringify({ account_id: 'acc-1', chat_id: 'chat-1' })
      ),
      partition: 4,
      offset: 10,
    });
    await flushPromises();

    expect(commitOffset).toHaveBeenCalledWith(
      kafkaConsumer,
      'clear.chat.summary',
      4,
      10
    );
  });
});
