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
  sendTextMessage?: jest.Mock;
  sendImageMessage?: jest.Mock;
  sendLocationMessage?: jest.Mock;
  sendContactsMessage?: jest.Mock;
  sendReactionMessage?: jest.Mock;
  sendAudioMessage?: jest.Mock;
  uploadMediaFromUrl?: jest.Mock;
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
    sendTextMessage:
      overrides?.sendTextMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.text',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendImageMessage:
      overrides?.sendImageMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.image',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendLocationMessage:
      overrides?.sendLocationMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.location',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendContactsMessage:
      overrides?.sendContactsMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.contacts',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendReactionMessage:
      overrides?.sendReactionMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.reaction',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    sendAudioMessage:
      overrides?.sendAudioMessage ??
      jest.fn(async () => ({
        message_id: 'wamid.audio',
        contact_wa_id: '5511999999999',
        message_status: 'accepted',
        raw: { messaging_product: 'whatsapp' },
      })),
    uploadMediaFromUrl:
      overrides?.uploadMediaFromUrl ?? jest.fn(async () => 'meta-media-1'),
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

  it('sends text messages with quote context when quoted message has a Meta id', async () => {
    const textMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.text,
        message: 'Resposta',
        quoted: {
          key: {
            id: 'wamid.quoted',
            remote_jid: '5511999999999@s.whatsapp.net',
            is_view_once: false,
          },
          message: 'Original',
          type: EMessageType.text,
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      textMessage,
      makeEnvelope(textMessage)
    );

    expect(metaWhatsappEmbeddedService.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Resposta',
        contextMessageId: 'wamid.quoted',
      })
    );
  });

  it('uploads image media before sending it to Meta', async () => {
    const imageMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.image,
        message: 'Legenda',
        image: {
          url: 'http://minio.local/file.jpg',
          mimetype: 'image/jpeg',
          caption: 'Legenda da imagem',
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      imageMessage,
      makeEnvelope(imageMessage)
    );

    expect(metaWhatsappEmbeddedService.uploadMediaFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://minio.local/file.jpg',
        mimetype: 'image/jpeg',
      })
    );
    expect(metaWhatsappEmbeddedService.sendImageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'meta-media-1',
        caption: 'Legenda da imagem',
      })
    );
  });

  it('sends locations through the official Meta payload', async () => {
    const locationMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.location,
        location: {
          latitude: -15.8,
          longitude: -47.9,
          name: 'Brasilia',
          address: 'DF',
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      locationMessage,
      makeEnvelope(locationMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendLocationMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: -15.8,
        longitude: -47.9,
        name: 'Brasilia',
        address: 'DF',
      })
    );
  });

  it('maps contact cards to Meta contacts with normalized DDI and phone', async () => {
    const contactMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.contact_card,
        contact: {
          contact_id: 'contact-1',
          name: 'Braian',
          last_name: 'Silva',
          phone_ddi: '55',
          phone: '(61) 99121-1783',
          email: 'braian@example.test',
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      contactMessage,
      makeEnvelope(contactMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendContactsMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        contacts: [
          expect.objectContaining({
            name: expect.objectContaining({
              formatted_name: 'Braian Silva',
              first_name: 'Braian',
              last_name: 'Silva',
            }),
            phones: [
              expect.objectContaining({
                phone: '+55 61991211783',
                wa_id: '5561991211783',
              }),
            ],
          }),
        ],
      })
    );
  });

  it('sends reactions to the target Meta message id', async () => {
    const reactionMessage: IChatMessage = {
      ...message,
      message_key: {
        remote_jid: '5511999999999@s.whatsapp.net',
        id: 'wamid.target',
        is_view_once: false,
      },
      content: {
        type: EMessageType.react,
        message: '👍',
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      reactionMessage,
      makeEnvelope(reactionMessage)
    );

    expect(
      metaWhatsappEmbeddedService.sendReactionMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'wamid.target',
        emoji: '👍',
      })
    );
  });

  it('sends official ptt audio as a Meta voice message', async () => {
    const audioMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.audio,
        audio: {
          url: 'http://minio.local/audio.ogg',
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService } = makeConsumer();

    await (consumer as any).processPayload(
      audioMessage,
      makeEnvelope(audioMessage)
    );

    expect(metaWhatsappEmbeddedService.uploadMediaFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://minio.local/audio.ogg',
        mimetype: 'audio/ogg; codecs=opus',
      })
    );
    expect(metaWhatsappEmbeddedService.sendAudioMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'meta-media-1',
        voice: true,
      })
    );
  });

  it('marks official audio view-once messages as not sent without uploading media', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const audioMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.audio,
        audio: {
          url: 'http://minio.local/audio.ogg',
          mimetype: 'audio/ogg',
          view_once: true,
        },
      },
    };
    const { consumer, metaWhatsappEmbeddedService, messageStatusService } =
      makeConsumer();

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        audioMessage,
        {
          partition: 0,
          offset: 11,
          kafkaKey: 'account-1:chat-1',
        }
      );

      expect(messageStatusService.markMessageAsNotSent).toHaveBeenCalledWith(
        'account-1',
        'internal-message-1'
      );
      expect(
        metaWhatsappEmbeddedService.uploadMediaFromUrl
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('marks unsupported official message types as not sent', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const unsupportedMessage: IChatMessage = {
      ...message,
      content: {
        type: EMessageType.video_note,
        message: 'video note',
      },
    };
    const { consumer, messageStatusService } = makeConsumer();

    try {
      await (consumer as any).processRunnerPayload(
        'official.whatsapp.send.message',
        unsupportedMessage,
        {
          partition: 0,
          offset: 11,
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
