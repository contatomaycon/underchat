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
  __isLatestAssignmentCutoverCommitted = jest.fn(() => true);
  __isAssignmentEpochActive = jest.fn(() => true);
}

const { setImmediate: scheduleRealImmediate } =
  jest.requireActual<typeof import('node:timers')>('node:timers');

async function waitForCommit(partition: number, offset: number): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    if (
      (commitOffset as jest.Mock).mock.calls.some(
        (call) => call[2] === partition && call[3] === offset
      )
    ) {
      return;
    }
    await new Promise<void>((resolve) => scheduleRealImmediate(resolve));
  }

  throw new Error(
    `Timed out waiting for Kafka commit for partition ${partition} offset ${offset}`
  );
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
    const kafka = {
      getBroker: jest.fn(() => 'broker-a:9092'),
    };

    const consumer = new ChatSummaryClearConsume(
      kafka as never,
      kafkaServiceQueueService as never,
      chatService as never,
      centrifugoService as never
    );

    await consumer.execute();
    kafkaConsumer.emit('data', {
      value: Buffer.from(
        JSON.stringify({
          account_id: 'acc-1',
          chat_id: 'chat-1',
          operation_id: 'clear-op-1',
          expected_summary_revision: 3,
          expected_last_message_id: null,
        })
      ),
      partition: 4,
      offset: 10,
      consumerAssignmentEpoch: 1,
    });
    await waitForCommit(4, 10);

    expect(chatService.clearChatSummary).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      kafkaConsumer,
      'clear.chat.summary',
      4,
      10
    );
  });

  it('forwards operation identity and the observed summary revision guard', async () => {
    const chatService = {
      clearChatSummary: jest.fn(async () => true),
      findChatByChatId: jest.fn(async () => ({
        account: { id: 'acc-1' },
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const consumer = new ChatSummaryClearConsume(
      {} as never,
      { clearChatSummary: jest.fn(() => 'clear.chat.summary') } as never,
      chatService as never,
      centrifugoService as never
    );

    await (consumer as any).handleMessage({
      account_id: 'acc-1',
      chat_id: 'chat-1',
      operation_id: 'clear-op-1',
      expected_summary_revision: 3,
      expected_last_message_id: 'message-1',
    });

    expect(chatService.clearChatSummary).toHaveBeenCalledWith(
      'chat-1',
      'acc-1',
      expect.objectContaining({
        operationId: 'clear-op-1',
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 3,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: 'message-1',
        assertActive: expect.any(Function),
      })
    );
  });

  it('does not republish a duplicate clear operation', async () => {
    const chatService = {
      clearChatSummary: jest.fn(async () => false),
      findChatByChatId: jest.fn(),
    };
    const centrifugoService = {
      publishSub: jest.fn(),
    };
    const consumer = new ChatSummaryClearConsume(
      {} as never,
      { clearChatSummary: jest.fn(() => 'clear.chat.summary') } as never,
      chatService as never,
      centrifugoService as never
    );

    await (consumer as any).handleMessage({
      account_id: 'acc-1',
      chat_id: 'chat-1',
      operation_id: 'clear-op-duplicate',
      expected_summary_revision: 3,
      expected_last_message_id: 'message-1',
    });

    expect(chatService.findChatByChatId).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('fails closed when a revision-aware operation omits its expected revision', async () => {
    const chatService = {
      clearChatSummary: jest.fn(),
      findChatByChatId: jest.fn(),
    };
    const centrifugoService = {
      publishSub: jest.fn(),
    };
    const consumer = new ChatSummaryClearConsume(
      {} as never,
      { clearChatSummary: jest.fn(() => 'clear.chat.summary') } as never,
      chatService as never,
      centrifugoService as never
    );

    await (consumer as any).handleMessage({
      account_id: 'acc-1',
      chat_id: 'chat-1',
      operation_id: 'new-producer-without-revision',
      expected_last_message_id: 'message-1',
    });

    expect(chatService.clearChatSummary).not.toHaveBeenCalled();
    expect(chatService.findChatByChatId).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('fails closed for an entirely unguarded legacy command', async () => {
    const chatService = {
      clearChatSummary: jest.fn(),
      findChatByChatId: jest.fn(),
    };
    const consumer = new ChatSummaryClearConsume(
      {} as never,
      { clearChatSummary: jest.fn(() => 'clear.chat.summary') } as never,
      chatService as never,
      { publishSub: jest.fn() } as never
    );

    await (consumer as any).handleMessage({
      account_id: 'acc-1',
      chat_id: 'chat-1',
    });

    expect(chatService.clearChatSummary).not.toHaveBeenCalled();
  });

  it('fails closed for a legacy command guarded only by last message', async () => {
    const chatService = {
      clearChatSummary: jest.fn(),
      findChatByChatId: jest.fn(),
    };
    const consumer = new ChatSummaryClearConsume(
      {} as never,
      { clearChatSummary: jest.fn(() => 'clear.chat.summary') } as never,
      chatService as never,
      { publishSub: jest.fn() } as never
    );

    await (consumer as any).handleMessage({
      account_id: 'acc-1',
      chat_id: 'chat-1',
      expected_last_message_id: 'message-1',
    });

    expect(chatService.clearChatSummary).not.toHaveBeenCalled();
  });

  it('fails closed when the operation identity is blank', async () => {
    const chatService = {
      clearChatSummary: jest.fn(),
      findChatByChatId: jest.fn(),
    };
    const consumer = new ChatSummaryClearConsume(
      {} as never,
      { clearChatSummary: jest.fn(() => 'clear.chat.summary') } as never,
      chatService as never,
      { publishSub: jest.fn() } as never
    );

    await (consumer as any).handleMessage({
      account_id: 'acc-1',
      chat_id: 'chat-1',
      operation_id: '   ',
      expected_summary_revision: 3,
      expected_last_message_id: 'message-1',
    });

    expect(chatService.clearChatSummary).not.toHaveBeenCalled();
  });

  it('fails closed when the last-message guard is malformed', async () => {
    const chatService = {
      clearChatSummary: jest.fn(),
      findChatByChatId: jest.fn(),
    };
    const consumer = new ChatSummaryClearConsume(
      {} as never,
      { clearChatSummary: jest.fn(() => 'clear.chat.summary') } as never,
      chatService as never,
      { publishSub: jest.fn() } as never
    );

    await (consumer as any).handleMessage({
      account_id: 'acc-1',
      chat_id: 'chat-1',
      operation_id: 'clear-op-1',
      expected_summary_revision: 3,
      expected_last_message_id: { invalid: true },
    });

    expect(chatService.clearChatSummary).not.toHaveBeenCalled();
  });
});
