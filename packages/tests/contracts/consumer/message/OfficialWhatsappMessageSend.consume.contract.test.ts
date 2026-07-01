import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('uuid', () => ({ v7: jest.fn(() => 'annotation-1') }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { OfficialWhatsappMessageSendConsume } from '@core/consumer/message/OfficialWhatsappMessageSend.consume';

const message: IChatMessage = {
  message_id: 'internal-message-1',
  chat_id: 'chat-1',
  message_key: {
    remote_jid: '5511999999999@s.whatsapp.net',
    is_view_once: false,
  },
  type_user: ETypeUserChat.operator,
  account: { id: 'account-1', name: 'Account' },
  worker: { id: 'worker-1', name: 'Official' },
  user: { id: 'user-1', name: 'Agent', photo: null },
  phone: '5511999999999',
  summary: {
    is_sent: false,
    is_delivered: false,
    is_seen: false,
    is_sent_to_internal: true,
  },
  date: '2026-06-01T10:00:00.000Z',
  content: {
    type: EMessageType.official_template,
    message: 'Ola Maycon',
    official_template: {
      name: 'hello_world',
      language: 'pt_BR',
      variables: [
        {
          key: 'BODY:1',
          component_type: 'BODY',
          index: 1,
          value: 'Maycon',
        },
      ],
    },
  },
};

function makeEnvelope(payload: unknown = message) {
  return {
    sourceTopic: 'official.whatsapp.send.message',
    partition: 0,
    offset: 10,
    kafkaKey: 'account-1:chat-1',
    payload,
    queueKey: 'account-1:chat-1',
    chatId: 'chat-1',
  };
}

function makeConsumer(overrides?: {
  sendTemplateMessage?: jest.Mock;
  claimSend?: jest.Mock;
}) {
  const kafkaServiceQueueService = {
    officialWhatsappSendMessage: jest.fn(
      () => 'official.whatsapp.send.message'
    ),
    updateMessage: jest.fn(() => 'update.message'),
    updateMessageStatus: jest.fn(() => 'update.message.status'),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const metaWhatsappEmbeddedService = {
    sendTemplateMessage:
      overrides?.sendTemplateMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.123',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendTextMessage: jest.fn(),
  };
  const messageStatusService = {
    markMessageAsNotSent: jest.fn(async () => undefined),
  };
  const consumer = new OfficialWhatsappMessageSendConsume(
    {} as never,
    kafkaServiceQueueService as never,
    streamProducerService as never,
    metaWhatsappEmbeddedService as never,
    { decrypt: jest.fn(() => 'plain-token') } as never,
    {
      findActiveByWorkerId: jest.fn(async () => ({
        worker_id: 'worker-1',
        waba_id: 'waba-1',
        phone_number_id: 'phone-number-1',
        access_token_encrypted: 'encrypted-token',
        api_version: 'v24.0',
      })),
    } as never,
    {
      claimSend:
        overrides?.claimSend ?? jest.fn(async () => 'acquired' as const),
    } as never,
    messageStatusService as never,
    { publishPreparedMessage: jest.fn(async () => true) } as never,
    {
      buildMetaComponents: jest.fn(() => [
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Maycon' }],
        },
      ]),
    } as never
  );

  return {
    consumer,
    kafkaServiceQueueService,
    metaWhatsappEmbeddedService,
    messageStatusService,
    streamProducerService,
  };
}

describe('OfficialWhatsappMessageSendConsume', () => {
  it('sends official template messages to Meta and publishes update/status events', async () => {
    const { consumer, metaWhatsappEmbeddedService, streamProducerService } =
      makeConsumer();

    await (consumer as any).processPayload(message, makeEnvelope());

    expect(
      metaWhatsappEmbeddedService.sendTemplateMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: 'v24.0',
        accessToken: 'plain-token',
        phoneNumberId: 'phone-number-1',
        to: '5511999999999',
        templateName: 'hello_world',
        language: 'pt_BR',
      })
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message',
      expect.objectContaining({
        data: expect.objectContaining({ message_id: 'internal-message-1' }),
        message: expect.objectContaining({
          key: expect.objectContaining({ id: 'wamid.123', fromMe: true }),
        }),
      }),
      'chat:account-1:chat-1'
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        account_id: 'account-1',
        message_id: 'wamid.123',
        patch: { is_sent: true },
      }),
      'account-1:wamid.123'
    );
  });

  it('marks official messages as not sent when Graph delivery fails', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const sendTemplateMessage = jest.fn(async () => {
      throw new Error('Graph error');
    });
    const { consumer, messageStatusService } = makeConsumer({
      sendTemplateMessage,
    });

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        message,
        {
          partition: 0,
          offset: 10,
          kafkaKey: 'account-1:chat-1',
        }
      );

      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        'account-1',
        'internal-message-1'
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
