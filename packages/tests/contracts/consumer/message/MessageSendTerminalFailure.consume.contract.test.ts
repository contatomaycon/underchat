import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (jid: string) => jid.replace(/@c\.us$/, '@s.whatsapp.net'),
  proto: {
    Message: {
      decode: jest.fn(),
      encode: jest.fn(() => ({ finish: () => Buffer.from('') })),
    },
    WebMessageInfo: {
      Status: {},
    },
  },
}));

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-baileys',
    baileysWorkerId: 'worker-baileys',
  },
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-wwebjs',
    wwebjsWorkerId: 'worker-wwebjs',
  },
}));

jest.mock('@core/services/baileys/methods/messageText.service', () => ({
  BaileysMessageTextService: class BaileysMessageTextService {},
}));

jest.mock('@core/services/baileys/methods/messageMedia.service', () => ({
  BaileysMessageMediaService: class BaileysMessageMediaService {},
}));

jest.mock(
  '@core/services/baileys/methods/messageReactionsInteractions.service',
  () => ({
    BaileysMessageReactionsInteractionsService: class BaileysMessageReactionsInteractionsService {},
  })
);

jest.mock('@core/services/baileys/methods/messageEditDelete.service', () => ({
  BaileysMessageEditDeleteService: class BaileysMessageEditDeleteService {},
}));

jest.mock(
  '@core/services/baileys/methods/messageLocationContact.service',
  () => ({
    BaileysMessageLocationContactService: class BaileysMessageLocationContactService {},
  })
);

jest.mock(
  '@core/services/baileys/methods/messageStatusStories.service',
  () => ({
    BaileysMessageStatusStoriesService: class BaileysMessageStatusStoriesService {},
  })
);

jest.mock('@core/services/baileys/methods/profile.service', () => ({
  BaileysProfileService: class BaileysProfileService {},
}));

jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class BaileysIncomingMessageService {},
}));

jest.mock('@core/services/wwebjs/methods/messageText.service', () => ({
  WwebjsMessageTextService: class WwebjsMessageTextService {},
}));

jest.mock('@core/services/wwebjs/methods/messageMedia.service', () => ({
  WwebjsMessageMediaService: class WwebjsMessageMediaService {},
}));

jest.mock(
  '@core/services/wwebjs/methods/messageReactionsInteractions.service',
  () => ({
    WwebjsMessageReactionsInteractionsService: class WwebjsMessageReactionsInteractionsService {},
  })
);

jest.mock('@core/services/wwebjs/methods/messageEditDelete.service', () => ({
  WwebjsMessageEditDeleteService: class WwebjsMessageEditDeleteService {},
}));

jest.mock(
  '@core/services/wwebjs/methods/messageLocationContact.service',
  () => ({
    WwebjsMessageLocationContactService: class WwebjsMessageLocationContactService {},
  })
);

jest.mock('@core/services/wwebjs/methods/messageStatusStories.service', () => ({
  WwebjsMessageStatusStoriesService: class WwebjsMessageStatusStoriesService {},
}));

jest.mock('@core/services/wwebjs/methods/profile.service', () => ({
  WwebjsProfileService: class WwebjsProfileService {},
}));

jest.mock('@core/services/wwebjs/util/buildForwardExtraOptions', () => ({
  buildForwardExtraOptions: jest.fn(() => ({})),
}));

import { MessageSendConsume } from '@core/consumer/message/MessageSend.consume';
import { MessageSendWwebjsConsume } from '@core/consumer/message/MessageSendWwebjs.consume';

function makeMessageStatusService() {
  return {
    isMessageAlreadySentByMessageId: jest.fn(async () => false),
    markMessageAsNotSent: jest.fn(async () => undefined),
  };
}

function makeEnvelope(payload: unknown = { message_id: 'message-1' }) {
  return {
    sourceTopic: 'worker.w1.send.message',
    partition: 2,
    offset: 41,
    kafkaKey: 'message-1',
    payload,
    queueKey: 'account-1:chat-1',
    chatId: 'chat-1',
  };
}

describe('message send terminal failures without Kafka redrive', () => {
  it('marks Baileys send failures as not sent and does not publish to Kafka', async () => {
    const streamProducerService = { send: jest.fn() };
    const messageStatusService = makeMessageStatusService();
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consumer = new MessageSendConsume(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      streamProducerService as never,
      {} as never,
      messageStatusService as never,
      {} as never
    );

    try {
      await (consumer as any).routeFailedMessage(
        makeEnvelope(),
        new Error('send failed'),
        'processing_failed'
      );

      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        expect.any(String),
        'message-1'
      );
      expect(streamProducerService.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageSend] Discarding terminal send failure:',
        expect.objectContaining({
          message_id: 'message-1',
          reason: 'processing_failed_terminal',
        })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('marks WWebJS send failures as not sent and does not publish to Kafka', async () => {
    const streamProducerService = { send: jest.fn() };
    const messageStatusService = makeMessageStatusService();
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consumer = new MessageSendWwebjsConsume(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      streamProducerService as never,
      {} as never,
      messageStatusService as never,
      {} as never
    );

    try {
      await (consumer as any).routeFailedMessage(
        makeEnvelope(),
        new Error('send failed'),
        'processing_failed'
      );

      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        expect.any(String),
        'message-1'
      );
      expect(streamProducerService.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MessageSendWwebjs] Discarding terminal send failure:',
        expect.objectContaining({
          message_id: 'message-1',
          reason: 'processing_failed_terminal',
        })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
