import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) =>
    jid.replace(/@c\.us$/, '@s.whatsapp.net')
  ),
}));

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-wwebjs',
    wwebjsWorkerId: 'worker-wwebjs',
  },
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

import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { MessageSendWwebjsConsume } from '@core/consumer/message/MessageSendWwebjs.consume';

function makeOfficialCtaMessage(): IChatMessage {
  return {
    message_id: 'internal-message-1',
    chat_id: 'chat-1',
    message_key: {
      remote_jid: '5511999999999@c.us',
      from_me: true,
      is_view_once: false,
    },
    type_user: ETypeUserChat.bot,
    account: { id: 'account-1', name: 'Account' },
    worker: { id: 'worker-wwebjs', name: 'WWebJS' },
    user: null,
    phone: '5511999999999',
    summary: {
      is_sent: false,
      is_delivered: false,
      is_seen: false,
      is_sent_to_internal: true,
    },
    date: '2026-07-02T13:46:09.000Z',
    content: {
      type: EMessageType.official_interactive,
      message: 'Clique no link para abrir',
      official: {
        provider: 'meta_whatsapp',
        type: 'interactive',
        display: {
          kind: 'cta_url',
          raw_type: 'cta_url',
          body: 'Clique no link para abrir',
          action_label: 'Underchat',
          actions: [
            {
              type: 'cta_url',
              title: 'Underchat',
              url: 'https://underchat.com.br/',
            },
          ],
        },
      },
    },
  };
}

function makeConsumer() {
  const sendResult = {
    key: {
      id: 'wwebjs-message-1',
      remote_jid: '5511999999999@c.us',
      from_me: true,
    },
  };
  const wwebjsMessageTextService = {
    sendText: jest.fn(async () => sendResult),
    sendTextQuoted: jest.fn(async () => sendResult),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const kafkaServiceQueueService = {
    updateMessage: jest.fn(() => 'update.message'),
  };
  const consumer = new MessageSendWwebjsConsume(
    {} as never,
    {} as never,
    wwebjsMessageTextService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    streamProducerService as never,
    kafkaServiceQueueService as never,
    {} as never,
    {} as never
  );

  return {
    consumer,
    kafkaServiceQueueService,
    sendResult,
    streamProducerService,
    wwebjsMessageTextService,
  };
}

describe('MessageSendWwebjsConsume', () => {
  it('sends official CTA URL as WWebJS text fallback while preserving official display metadata', async () => {
    const {
      consumer,
      sendResult,
      streamProducerService,
      wwebjsMessageTextService,
    } = makeConsumer();
    const message = makeOfficialCtaMessage();

    await (consumer as any).processMessage(message);

    expect(wwebjsMessageTextService.sendText).toHaveBeenCalledWith(
      '5511999999999@c.us',
      'Clique no link para abrir',
      { extra: undefined }
    );
    expect(wwebjsMessageTextService.sendTextQuoted).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith('update.message', {
      message: sendResult,
      data: expect.objectContaining({
        message_id: 'internal-message-1',
        content: expect.objectContaining({
          type: EMessageType.official_interactive,
          official: expect.objectContaining({
            display: expect.objectContaining({
              kind: 'cta_url',
              body: 'Clique no link para abrir',
              action_label: 'Underchat',
              actions: [
                expect.objectContaining({
                  title: 'Underchat',
                  url: 'https://underchat.com.br/',
                }),
              ],
            }),
          }),
        }),
      }),
    });
  });
});
