import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { OfficialWhatsappWebhookConsume } from '@core/consumer/webhook/OfficialWhatsappWebhook.consume';
import { IMetaWhatsappWebhookEvent } from '@core/common/interfaces/IMetaWhatsappWebhookEvent';

const connection = {
  worker_id: 'worker-1',
  account_id: 'account-1',
  worker_name: 'Official',
  business_id: 'business-1',
  waba_id: 'waba-1',
  phone_number_id: 'phone-number-1',
  access_token_encrypted: 'enc:token',
  api_version: 'v25.0',
};

function makeConsumer() {
  const redis = {
    exists: jest.fn(async () => 0),
    set: jest.fn(async () => 'OK'),
    get: jest.fn(async () => null),
  };
  const kafkaServiceQueueService = {
    upsertMessage: jest.fn(() => 'upsert.message'),
    updateMessageStatus: jest.fn(() => 'update.message.status'),
    officialWhatsappWebhookEvent: jest.fn(
      () => 'official.whatsapp.webhook.event'
    ),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const repository = {
    findActiveByPhoneNumberIdWithWorker: jest.fn(async () => connection),
    findActiveByWabaIdWithWorker: jest.fn(async () => [connection]),
    disconnectPreservingWorker: jest.fn(async () => true),
  };
  const consumer = new OfficialWhatsappWebhookConsume(
    {} as never,
    redis as never,
    kafkaServiceQueueService as never,
    streamProducerService as never,
    {
      getMediaUrl: jest.fn(),
      downloadMedia: jest.fn(),
    } as never,
    { decrypt: jest.fn((value: string) => value.replace('enc:', '')) } as never,
    repository as never,
    { uploadFromBuffer: jest.fn() } as never,
    { markMessageAsNotSentByWhatsAppId: jest.fn() } as never,
    { publish: jest.fn(async () => undefined) } as never,
    { parkConsumerMessage: jest.fn(async () => undefined) } as never
  );

  return {
    consumer,
    redis,
    kafkaServiceQueueService,
    streamProducerService,
    repository,
  };
}

function makeEvent(): IMetaWhatsappWebhookEvent {
  return {
    received_at: '2026-07-01T12:00:00.000Z',
    raw_body_sha256: 'hash',
    signature_header: 'sha256=signature',
    payload: {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  phone_number_id: 'phone-number-1',
                  display_phone_number: '5511000000000',
                },
                contacts: [
                  {
                    wa_id: '5511999999999',
                    profile: { name: 'Cliente' },
                  },
                ],
                messages: [
                  {
                    id: 'wamid.inbound-1',
                    from: '5511999999999',
                    timestamp: '1782921600',
                    type: 'text',
                    text: { body: 'Ola' },
                  },
                ],
                statuses: [
                  {
                    id: 'wamid.outbound-1',
                    recipient_id: '5511999999999',
                    status: 'delivered',
                    timestamp: '1782921601',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

function makeContactMessageEvent(): IMetaWhatsappWebhookEvent {
  return {
    received_at: '2026-07-01T14:50:38.577Z',
    raw_body_sha256: 'hash',
    signature_header: 'sha256=signature',
    payload: {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '556192037138',
                  phone_number_id: 'phone-number-1',
                },
                contacts: [
                  {
                    profile: { name: 'Maycon Douglas' },
                    wa_id: '556195999040',
                    user_id: 'BR.1020703283800263',
                  },
                ],
                messages: [
                  {
                    from: '556195999040',
                    from_user_id: 'BR.1020703283800263',
                    id: 'wamid.contact-1',
                    timestamp: '1782917437',
                    type: 'contacts',
                    contacts: [
                      {
                        name: {
                          first_name: 'Braian',
                          formatted_name: 'Braian',
                        },
                        phones: [
                          {
                            phone: '+55 61 99121-1783',
                            wa_id: '556191211783',
                            type: 'CELL',
                          },
                        ],
                        vcard:
                          'BEGIN:VCARD\nVERSION:3.0\nN:;Braian;;;\nFN:Braian\nTEL;type=CELL;type=VOICE;waid=556191211783:+55 61 99121-1783\nEND:VCARD',
                        origin: 'other',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

function makeUnsupportedMessageEvent(): IMetaWhatsappWebhookEvent {
  return {
    received_at: '2026-07-01T15:30:38.755Z',
    raw_body_sha256: 'hash',
    signature_header: 'sha256=signature',
    payload: {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '556192037138',
                  phone_number_id: 'phone-number-1',
                },
                contacts: [
                  {
                    profile: { name: 'Maycon Douglas' },
                    wa_id: '556195999040',
                    user_id: 'BR.1020703283800263',
                  },
                ],
                messages: [
                  {
                    from: '556195999040',
                    from_user_id: 'BR.1020703283800263',
                    id: 'wamid.unsupported-1',
                    timestamp: '1782919838',
                    errors: [
                      {
                        code: 131051,
                        title: 'Message type unknown',
                        message: 'Message type unknown',
                        error_data: {
                          details: 'Message type is currently not supported.',
                        },
                      },
                    ],
                    type: 'unsupported',
                    unsupported: { type: 'video_note' },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

describe('OfficialWhatsappWebhookConsume', () => {
  it('publishes official Meta messages and statuses into the existing chat pipeline', async () => {
    const { consumer, streamProducerService, repository, redis } =
      makeConsumer();
    const event = makeEvent();

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
    });

    expect(repository.findActiveByPhoneNumberIdWithWorker).toHaveBeenCalledWith(
      'phone-number-1'
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        type: EMessageType.text,
        content: expect.objectContaining({
          type: EMessageType.text,
          message: 'Ola',
          official: expect.objectContaining({
            provider: 'meta_whatsapp',
            type: 'text',
            webhook_field: 'messages',
            message_id: 'wamid.inbound-1',
          }),
        }),
      }),
      expect.any(String)
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        account_id: 'account-1',
        message_id: 'wamid.outbound-1',
        patch: { is_delivered: true },
        key: expect.objectContaining({
          id: 'wamid.outbound-1',
          fromMe: true,
        }),
      }),
      'account-1:wamid.outbound-1'
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(':message:wamid.inbound-1'),
      '1',
      'EX',
      expect.any(Number)
    );
  });

  it('keeps the official quoted message id from Meta context on text messages', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeEvent();
    const quotedMessageId =
      'wamid.HBgTQlIuMTAyMDcwMzI4MzgwMDI2MxUUABIYFDNBRUEyQTdEODVDRjk3QkMyREU2AA==';
    const firstChange = event.payload.entry?.[0]?.changes?.[0];
    if (!firstChange) {
      throw new Error('missing webhook change fixture');
    }
    const message = (firstChange.value as any).messages[0];
    message.id =
      'wamid.HBgMNTU2MTk1OTk5MDQwFQIAEhgUM0EzRkJEREE2OUIxNUMwNEJEMDMA';
    message.context = {
      from: '5511999999999',
      id: quotedMessageId,
    };

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        has_quoted: true,
        content: expect.objectContaining({
          type: EMessageType.text,
          message: 'Ola',
          message_quoted_id: quotedMessageId,
        }),
      }),
      expect.any(String)
    );
  });

  it('maps official Meta contact cards with normalized phone fields', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeContactMessageEvent();

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        type: EMessageType.contact_card,
        message: expect.objectContaining({
          message: expect.objectContaining({
            contactMessage: expect.objectContaining({
              displayName: 'Braian',
              vcard: expect.stringContaining('FN:Braian'),
            }),
          }),
        }),
        content: expect.objectContaining({
          type: EMessageType.contact_card,
          message: 'Braian',
          contact: expect.objectContaining({
            name: 'Braian',
            phone: '61991211783',
            phone_partial: '61991211783',
            phone_ddi: '55',
            email: null,
            email_partial: null,
            photo: null,
          }),
          contacts: null,
        }),
      }),
      expect.any(String)
    );
  });

  it('maps unsupported official Meta messages as inbound text messages', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeUnsupportedMessageEvent();
    const unsupportedMessage =
      'Mensagem não suportada. Para visualizar este conteúdo, abra a conversa diretamente no dispositivo do WhatsApp.';

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        type: EMessageType.text,
        message: expect.objectContaining({
          key: expect.objectContaining({
            id: 'wamid.unsupported-1',
            remoteJid: '556195999040@s.whatsapp.net',
            fromMe: false,
          }),
          message: { conversation: unsupportedMessage },
        }),
        content: expect.objectContaining({
          type: EMessageType.text,
          message: unsupportedMessage,
          official: expect.objectContaining({
            type: 'unsupported',
            unsupported: expect.objectContaining({
              type: 'video_note',
              reason: 'unsupported_meta_message_type',
            }),
          }),
        }),
      }),
      expect.any(String)
    );
  });
});
