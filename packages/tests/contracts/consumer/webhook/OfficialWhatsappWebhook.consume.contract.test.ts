import 'reflect-metadata';
import { performance } from 'node:perf_hooks';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { OfficialWhatsappWebhookConsume } from '@core/consumer/webhook/OfficialWhatsappWebhook.consume';
import { IMetaWhatsappWebhookEvent } from '@core/common/interfaces/IMetaWhatsappWebhookEvent';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';

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

function makeConsumer(overrides?: {
  markAsRead?: boolean;
  markMessageAsRead?: jest.Mock;
  officialWindowService?: {
    recordInboundMessage: jest.Mock<Promise<void>, any[]>;
    markClosedByMetaReengagementForIdentity: jest.Mock<Promise<void>, any[]>;
  };
}) {
  const redis = {
    exists: jest.fn(async () => 0),
    set: jest.fn<Promise<'OK' | null>, any[]>(async () => 'OK'),
    get: jest.fn<Promise<string | null>, [string]>(async () => null),
    eval: jest.fn<Promise<string | number>, any[]>(async (script: string) =>
      script.includes("return 'acquired'") ? 'acquired' : 1
    ),
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
  const markMessageAsRead =
    overrides?.markMessageAsRead ?? jest.fn(async () => true);
  const workerConfigService = {
    viewWorkerConfig: jest.fn(async () => ({
      mark_as_read: overrides?.markAsRead ?? false,
    })),
  };
  const officialWindowService = overrides?.officialWindowService ?? {
    recordInboundMessage: jest.fn(async () => undefined),
    markClosedByMetaReengagementForIdentity: jest.fn(async () => undefined),
  };
  const metaWhatsappEmbeddedService = {
    getMediaUrl: jest.fn(),
    downloadMedia: jest.fn(),
    markMessageAsRead,
  };
  const storageService = { uploadFromBuffer: jest.fn() };
  const inboundMessageSpoolService = {
    parkConsumerMessage: jest.fn(async () => undefined),
  };
  const consumer = new OfficialWhatsappWebhookConsume(
    {} as never,
    redis as never,
    kafkaServiceQueueService as never,
    streamProducerService as never,
    metaWhatsappEmbeddedService as never,
    { decrypt: jest.fn((value: string) => value.replace('enc:', '')) } as never,
    repository as never,
    storageService as never,
    workerConfigService as never,
    { publish: jest.fn(async () => undefined) } as never,
    inboundMessageSpoolService as never,
    officialWindowService as never
  );

  return {
    consumer,
    redis,
    kafkaServiceQueueService,
    streamProducerService,
    repository,
    markMessageAsRead,
    workerConfigService,
    officialWindowService,
    metaWhatsappEmbeddedService,
    storageService,
    inboundMessageSpoolService,
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

function makeFreshMessageEvent(): IMetaWhatsappWebhookEvent {
  const event = makeEvent();
  const message = (event.payload as any).entry[0].changes[0].value
    .messages[0] as Record<string, unknown>;
  message.timestamp = String(Math.floor(Date.now() / 1000));
  return event;
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
  it('scopes the shared processed ledger by account and worker', () => {
    const { consumer } = makeConsumer();

    const firstWorkerKey = (consumer as any).processedKey(
      'account-1',
      'worker-1',
      'status',
      'wamid.shared:delivered'
    );
    const secondWorkerKey = (consumer as any).processedKey(
      'account-1',
      'worker-2',
      'status',
      'wamid.shared:delivered'
    );

    expect(firstWorkerKey).toBe(
      'official-whatsapp:webhook:processed:v1:account-1:worker-1:status:wamid.shared:delivered'
    );
    expect(secondWorkerKey).toBe(
      'official-whatsapp:webhook:processed:v1:account-1:worker-2:status:wamid.shared:delivered'
    );
    expect(firstWorkerKey).not.toBe(secondWorkerKey);
  });

  it('treats a live reservation as retryable busy instead of completed', async () => {
    const { consumer, redis } = makeConsumer();
    const effect = jest.fn(async () => undefined);
    redis.eval.mockResolvedValueOnce('busy');

    let busyError: unknown;
    try {
      await (consumer as any).runProcessedOnce(
        'official-whatsapp:webhook:processed:v1:account-1:worker-1:status:wamid.busy:sent',
        jest.fn(),
        effect
      );
    } catch (error) {
      busyError = error;
    }

    expect(busyError).toMatchObject({
      name: 'OfficialWhatsappProcessedBusyError',
      message: 'official_whatsapp_processed_busy',
    });
    expect((consumer as any).shouldContinueProcessedRetry(busyError)).toBe(
      true
    );
    expect(
      (consumer as any).shouldContinueProcessedRetry(new Error('other'))
    ).toBe(false);
    expect(effect).not.toHaveBeenCalled();
  });

  it('takes over an expired reservation and completes with the same CAS owner', async () => {
    const { consumer, redis } = makeConsumer();
    const effect = jest.fn(async () => undefined);

    await expect(
      (consumer as any).runProcessedOnce(
        'official-whatsapp:webhook:processed:v1:account-1:worker-1:message:wamid.expired',
        jest.fn(),
        effect
      )
    ).resolves.toBe(true);

    const claimCall = redis.eval.mock.calls[0] as unknown[];
    const completeCall = redis.eval.mock.calls[1] as unknown[];
    expect(claimCall[0]).toEqual(expect.stringContaining("return 'acquired'"));
    expect(claimCall[3]).toEqual(expect.stringMatching(/^reserved:/u));
    expect(completeCall[0]).toEqual(
      expect.stringContaining("redis.call('SET', KEYS[1], 'done'")
    );
    expect(completeCall[3]).toBe(claimCall[3]);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('cannot complete or release a reservation owned by another pod', async () => {
    const { consumer, redis } = makeConsumer();
    redis.eval
      .mockResolvedValueOnce('acquired')
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(
      (consumer as any).runProcessedOnce(
        'official-whatsapp:webhook:processed:v1:account-1:worker-1:message:wamid.stolen',
        jest.fn(),
        jest.fn(async () => undefined)
      )
    ).rejects.toMatchObject({
      name: 'OfficialWhatsappProcessedLeaseLostError',
    });

    const claimOwner = (redis.eval.mock.calls[0] as unknown[])[3];
    const completeOwner = (redis.eval.mock.calls[1] as unknown[])[3];
    const releaseOwner = (redis.eval.mock.calls[2] as unknown[])[3];
    expect(completeOwner).toBe(claimOwner);
    expect(releaseOwner).toBe(claimOwner);
  });

  it('stops downstream effects after the heartbeat loses the reservation', async () => {
    jest.useFakeTimers();
    const { consumer, redis } = makeConsumer();
    const downstream = jest.fn();
    redis.eval
      .mockResolvedValueOnce('acquired')
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    try {
      const processing = (consumer as any).runProcessedOnce(
        'official-whatsapp:webhook:processed:v1:account-1:worker-1:message:wamid.heartbeat-lost',
        jest.fn(),
        async (assertProcessedActive: () => void) => {
          await new Promise((resolve) => setTimeout(resolve, 30_001));
          assertProcessedActive();
          downstream();
        }
      );
      const rejection = expect(processing).rejects.toMatchObject({
        name: 'OfficialWhatsappProcessedLeaseLostError',
      });

      await jest.advanceTimersByTimeAsync(30_001);
      await rejection;
      expect(downstream).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops downstream effects when the local reservation deadline expires before a delayed heartbeat', async () => {
    const { consumer, redis } = makeConsumer();
    const downstream = jest.fn();
    (consumer as any).processedReservationTtlSeconds = 1;
    (consumer as any).processedReservationHeartbeatMs = 5_000;
    const now = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValue(1_101);
    redis.eval.mockResolvedValueOnce('acquired').mockResolvedValueOnce(1);

    try {
      await expect(
        (consumer as any).runProcessedOnce(
          'official-whatsapp:webhook:processed:v1:account-1:worker-1:message:wamid.local-deadline',
          jest.fn(),
          async (assertProcessedActive: () => void) => {
            assertProcessedActive();
            downstream();
          }
        )
      ).rejects.toMatchObject({
        name: 'OfficialWhatsappProcessedLeaseLostError',
      });
      expect(downstream).not.toHaveBeenCalled();
      expect(redis.eval).toHaveBeenCalledTimes(2);
      expect(redis.eval.mock.calls[1]?.[0]).toEqual(
        expect.stringContaining("redis.call('DEL', KEYS[1])")
      );
    } finally {
      now.mockRestore();
    }
  });

  it('fails closed before downstream effects when the processed ledger cannot be claimed', async () => {
    const { consumer, redis, streamProducerService, officialWindowService } =
      makeConsumer();
    const event = makeEvent();
    const ledgerError = new Error('redis processed ledger unavailable');
    redis.eval.mockRejectedValueOnce(ledgerError);

    await expect(
      (consumer as any).processWebhookEvent(event, {
        sourceTopic: 'official.whatsapp.webhook.event',
        partition: 0,
        offset: 1,
        kafkaKey: 'phone-number-1',
        payload: event,
        queueKey: 'phone-number-1',
        assertActive: jest.fn(),
      })
    ).rejects.toBe(ledgerError);

    expect(officialWindowService.recordInboundMessage).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('releases a failed reservation so the physical event can be retried', async () => {
    const { consumer, redis, streamProducerService } = makeConsumer();
    const event = makeFreshMessageEvent();
    const publicationError = new Error('Kafka publication failed');
    streamProducerService.send.mockRejectedValueOnce(publicationError);
    const context = {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    };

    await expect(
      (consumer as any).processWebhookEvent(event, context)
    ).rejects.toBe(publicationError);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("return 'busy'"),
      1,
      expect.stringContaining(':account-1:worker-1:message:wamid.inbound-1'),
      expect.stringMatching(/^reserved:/u),
      expect.any(String)
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      expect.stringContaining(':account-1:worker-1:message:wamid.inbound-1'),
      expect.any(String)
    );
    expect(redis.eval.mock.invocationCallOrder[0]).toBeLessThan(
      streamProducerService.send.mock.invocationCallOrder[0]
    );

    await expect(
      (consumer as any).processWebhookEvent(event, context)
    ).resolves.toBeUndefined();

    expect(
      (streamProducerService.send.mock.calls as unknown as unknown[][]).filter(
        (call) => call[0] === 'upsert.message'
      )
    ).toHaveLength(2);
  });

  it('skips a webhook physical event already completed by another pod', async () => {
    const { consumer, redis, streamProducerService, officialWindowService } =
      makeConsumer();
    const event = makeEvent();
    const value = event.payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      throw new Error('missing webhook value fixture');
    }
    value.statuses = [];
    redis.eval.mockResolvedValueOnce('done');

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(redis.eval).toHaveBeenCalled();
    expect(officialWindowService.recordInboundMessage).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('does not publish webhook events after assignment authorization is revoked', async () => {
    const { consumer, streamProducerService, officialWindowService } =
      makeConsumer();
    const event = makeEvent();
    const assertActive = jest.fn(() => {
      throw new KafkaConsumerDispatchRevokedError();
    });

    await expect(
      (consumer as any).processWebhookEvent(event, {
        sourceTopic: 'official.whatsapp.webhook.event',
        partition: 0,
        offset: 1,
        kafkaKey: 'phone-number-1',
        payload: event,
        queueKey: 'phone-number-1',
        assertActive,
      })
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(assertActive).toHaveBeenCalled();
    expect(officialWindowService.recordInboundMessage).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('publishes official Meta messages and statuses into the existing chat pipeline', async () => {
    const { consumer, streamProducerService, repository, redis } =
      makeConsumer();
    const event = makeFreshMessageEvent();

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
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
        event_id: expect.stringMatching(/^waevt_v1_[a-f0-9]{64}$/u),
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
      expect.any(String),
      undefined,
      expect.any(Function)
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        event_id: expect.stringMatching(/^message_status_v1_[a-f0-9]{64}$/u),
        message_id: 'wamid.outbound-1',
        patch: { is_delivered: true },
        key: expect.objectContaining({
          id: 'wamid.outbound-1',
          fromMe: true,
        }),
      }),
      'account-1:worker-1:wamid.outbound-1',
      undefined,
      expect.any(Function)
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("return 'busy'"),
      1,
      expect.stringContaining(':account-1:worker-1:message:wamid.inbound-1'),
      expect.stringMatching(/^reserved:/u),
      expect.any(String)
    );
  });

  it('does not manufacture a current message timestamp when Meta omits it', async () => {
    const {
      consumer,
      streamProducerService,
      officialWindowService,
      markMessageAsRead,
      inboundMessageSpoolService,
    } = makeConsumer({ markAsRead: true });
    const event = makeEvent();
    const message = (event.payload as any).entry[0].changes[0].value
      .messages[0] as Record<string, unknown>;
    delete message.timestamp;

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect((consumer as any).toTimestampSeconds(undefined)).toBeUndefined();
    expect(streamProducerService.send).not.toHaveBeenCalledWith(
      'upsert.message',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(inboundMessageSpoolService.parkConsumerMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'official_message_timestamp_missing',
        stage: 'message_upsert.discard.terminal',
        dedupe_key: expect.any(String),
      })
    );
    expect(officialWindowService.recordInboundMessage).not.toHaveBeenCalled();
    expect(markMessageAsRead).not.toHaveBeenCalled();
  });

  it.each([
    ['stale', '1782921600', 'official_stale_webhook_replay'],
    [
      'future',
      String(Math.floor(Date.parse('2026-08-17T22:47:51.000Z') / 1000)),
      'official_message_timestamp_future',
    ],
  ])(
    'does not apply inbound window or read effects for a %s provider timestamp',
    async (_caseName, timestamp, expectedReason) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-17T22:45:50.000Z'));
      try {
        const {
          consumer,
          streamProducerService,
          officialWindowService,
          markMessageAsRead,
          inboundMessageSpoolService,
        } = makeConsumer({ markAsRead: true });
        const event = makeEvent();
        const message = (event.payload as any).entry[0].changes[0].value
          .messages[0] as Record<string, unknown>;
        message.timestamp = timestamp;

        await (consumer as any).processWebhookEvent(event, {
          sourceTopic: 'official.whatsapp.webhook.event',
          partition: 0,
          offset: 1,
          kafkaKey: 'phone-number-1',
          payload: event,
          queueKey: 'phone-number-1',
          assertActive: jest.fn(),
        });

        expect(streamProducerService.send).not.toHaveBeenCalledWith(
          'upsert.message',
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
        expect(
          inboundMessageSpoolService.parkConsumerMessage
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: expectedReason,
            stage: 'message_upsert.discard.terminal',
          })
        );
        expect(
          officialWindowService.recordInboundMessage
        ).not.toHaveBeenCalled();
        expect(markMessageAsRead).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it('quarantines stale media before any Graph download or storage upload', async () => {
    const {
      consumer,
      metaWhatsappEmbeddedService,
      storageService,
      inboundMessageSpoolService,
      streamProducerService,
    } = makeConsumer();
    const event = makeEvent();
    const message = (event.payload as any).entry[0].changes[0].value
      .messages[0] as Record<string, unknown>;
    message.type = 'image';
    message.image = { id: 'stale-media-id', mime_type: 'image/jpeg' };
    delete message.text;

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(metaWhatsappEmbeddedService.getMediaUrl).not.toHaveBeenCalled();
    expect(metaWhatsappEmbeddedService.downloadMedia).not.toHaveBeenCalled();
    expect(storageService.uploadFromBuffer).not.toHaveBeenCalled();
    expect(inboundMessageSpoolService.parkConsumerMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'official_stale_webhook_replay',
        stage: 'message_upsert.discard.terminal',
      })
    );
    expect(streamProducerService.send).not.toHaveBeenCalledWith(
      'upsert.message',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('routes official failed receipts through the durable scoped status pipeline', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeEvent();
    const value = event.payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      throw new Error('missing webhook value fixture');
    }
    value.messages = [];
    value.statuses = [
      {
        id: 'wamid.failed-1',
        recipient_id: '5511999999999',
        status: 'failed',
        timestamp: '1782921601',
      },
    ];

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        event_id: expect.stringMatching(/^message_status_v1_[a-f0-9]{64}$/u),
        message_id: 'wamid.failed-1',
        patch: {},
        failed: true,
      }),
      'account-1:worker-1:wamid.failed-1',
      undefined,
      expect.any(Function)
    );
  });

  it('closes and publishes the window only for Meta re-engagement error 131047', async () => {
    const { consumer, streamProducerService, officialWindowService } =
      makeConsumer();
    const providerStatusTimestamp = String(Math.floor(Date.now() / 1000));
    const providerStatusAt = new Date(
      Number(providerStatusTimestamp) * 1000
    ).toISOString();
    const event = makeEvent();
    const value = event.payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      throw new Error('missing webhook value fixture');
    }
    value.messages = [];
    value.statuses = [
      {
        id: 'wamid.reengagement-failed-1',
        recipient_id: '5511999999999',
        status: 'failed',
        timestamp: providerStatusTimestamp,
        errors: [
          {
            code: 131047,
            title: 'Re-engagement message',
            message:
              'More than 24 hours have passed since the recipient last replied.',
          },
        ],
      },
    ];

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(
      officialWindowService.markClosedByMetaReengagementForIdentity
    ).toHaveBeenCalledWith(
      {
        accountId: 'account-1',
        workerId: 'worker-1',
        phone: '5511999999999@s.whatsapp.net',
        remoteJid: '5511999999999@s.whatsapp.net',
      },
      131047
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        message_id: 'wamid.reengagement-failed-1',
        failed: true,
        provider_error_code: 131047,
        provider_status_at: providerStatusAt,
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('publishes but does not let a stale 131047 receipt close a current window', async () => {
    const { consumer, streamProducerService, officialWindowService } =
      makeConsumer();
    const event = makeEvent();
    const value = event.payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      throw new Error('missing webhook value fixture');
    }
    value.messages = [];
    value.statuses = [
      {
        id: 'wamid.stale-reengagement-failed-1',
        recipient_id: '5511999999999',
        status: 'failed',
        timestamp: '1782921601',
        errors: [{ code: 131047, title: 'Re-engagement message' }],
      },
    ];

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(
      officialWindowService.markClosedByMetaReengagementForIdentity
    ).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        message_id: 'wamid.stale-reengagement-failed-1',
        failed: true,
        provider_error_code: 131047,
        provider_status_at: '2026-07-01T16:00:01.000Z',
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('does not close the service window for unrelated Meta delivery errors', async () => {
    const { consumer, streamProducerService, officialWindowService } =
      makeConsumer();
    const event = makeEvent();
    const value = event.payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      throw new Error('missing webhook value fixture');
    }
    value.messages = [];
    value.statuses = [
      {
        id: 'wamid.template-parameter-failed-1',
        recipient_id: '5511999999999',
        status: 'failed',
        timestamp: '1782921601',
        errors: [{ code: 132000, title: 'Template parameter mismatch' }],
      },
    ];

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(
      officialWindowService.markClosedByMetaReengagementForIdentity
    ).not.toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        message_id: 'wamid.template-parameter-failed-1',
        failed: true,
        provider_error_code: 132000,
        provider_status_at: '2026-07-01T16:00:01.000Z',
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('opens the official service window for real inbound messages', async () => {
    const officialWindowService = {
      recordInboundMessage: jest.fn(async () => undefined),
      markClosedByMetaReengagementForIdentity: jest.fn(async () => undefined),
    };
    const { consumer, streamProducerService } = makeConsumer({
      officialWindowService,
    });
    const event = makeEvent();
    const providerTimestamp = Math.floor(Date.now() / 1000);
    const inboundMessage = (event.payload as any).entry[0].changes[0].value
      .messages[0] as Record<string, unknown>;
    inboundMessage.timestamp = String(providerTimestamp);

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(officialWindowService.recordInboundMessage).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
      phone: '5511999999999@s.whatsapp.net',
      remoteJid: '5511999999999@s.whatsapp.net',
      messageId: 'wamid.inbound-1',
      replyToMessageId: null,
      inboundAt: new Date(providerTimestamp * 1000).toISOString(),
    });
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        source_provider: 'official_whatsapp',
        source_received_at: event.received_at,
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('does not open or unlock the official service window for message echoes', async () => {
    const officialWindowService = {
      recordInboundMessage: jest.fn(async () => undefined),
      markClosedByMetaReengagementForIdentity: jest.fn(async () => undefined),
    };
    const { consumer } = makeConsumer({ officialWindowService });
    const event = makeEvent();
    const change = event.payload.entry?.[0]?.changes?.[0];
    if (!change) {
      throw new Error('missing webhook change fixture');
    }
    change.field = 'message_echoes';
    const message = (change.value as any).messages[0];
    message.from = '5511000000000';
    message.to = '5511999999999';

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(officialWindowService.recordInboundMessage).not.toHaveBeenCalled();
  });

  it('marks incoming official Meta messages as read when worker config enables it', async () => {
    const { consumer, streamProducerService, markMessageAsRead } = makeConsumer(
      { markAsRead: true }
    );
    const event = makeFreshMessageEvent();

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(markMessageAsRead).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'token',
      phoneNumberId: 'phone-number-1',
      messageId: 'wamid.inbound-1',
    });
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'update.message.status',
      expect.objectContaining({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        event_id: expect.stringMatching(/^message_status_v1_[a-f0-9]{64}$/u),
        message_id: 'wamid.inbound-1',
        patch: { is_seen: true },
        key: expect.objectContaining({
          id: 'wamid.inbound-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        }),
      }),
      'account-1:worker-1:wamid.inbound-1',
      undefined,
      expect.any(Function)
    );
  });

  it('propagates a provider mark-read failure and releases the physical event reservation', async () => {
    const markReadError = new Error('Meta mark read unavailable');
    const markMessageAsRead = jest.fn(async () => {
      throw markReadError;
    });
    const { consumer, redis } = makeConsumer({
      markAsRead: true,
      markMessageAsRead,
    });
    const event = makeFreshMessageEvent();
    const value = event.payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      throw new Error('missing webhook value fixture');
    }
    value.statuses = [];
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        (consumer as any).processWebhookEvent(event, {
          sourceTopic: 'official.whatsapp.webhook.event',
          partition: 0,
          offset: 1,
          kafkaKey: 'phone-number-1',
          payload: event,
          queueKey: 'phone-number-1',
          assertActive: jest.fn(),
        })
      ).rejects.toBe(markReadError);
    } finally {
      consoleError.mockRestore();
    }

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      expect.stringContaining(':account-1:worker-1:message:wamid.inbound-1'),
      expect.stringMatching(/^reserved:/u)
    );
  });

  it('propagates a mark-read status publication failure for physical-event retry', async () => {
    const statusPublishError = new Error('status Kafka unavailable');
    const { consumer, redis, streamProducerService } = makeConsumer({
      markAsRead: true,
    });
    const event = makeFreshMessageEvent();
    const value = event.payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      throw new Error('missing webhook value fixture');
    }
    value.statuses = [];
    (streamProducerService.send as jest.Mock).mockImplementation(
      async (topic: string) => {
        if (topic === 'update.message.status') {
          throw statusPublishError;
        }
      }
    );
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        (consumer as any).processWebhookEvent(event, {
          sourceTopic: 'official.whatsapp.webhook.event',
          partition: 0,
          offset: 1,
          kafkaKey: 'phone-number-1',
          payload: event,
          queueKey: 'phone-number-1',
          assertActive: jest.fn(),
        })
      ).rejects.toBe(statusPublishError);
    } finally {
      consoleError.mockRestore();
    }

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      expect.stringContaining(':account-1:worker-1:message:wamid.inbound-1'),
      expect.stringMatching(/^reserved:/u)
    );
  });

  it('keeps the official quoted message id from Meta context on text messages', async () => {
    const { consumer, streamProducerService, officialWindowService } =
      makeConsumer();
    const event = makeFreshMessageEvent();
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
      assertActive: jest.fn(),
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
      expect.any(String),
      undefined,
      expect.any(Function)
    );
    expect(officialWindowService.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId:
          'wamid.HBgMNTU2MTk1OTk5MDQwFQIAEhgUM0EzRkJEREE2OUIxNUMwNEJEMDMA',
        replyToMessageId: quotedMessageId,
      })
    );
  });

  it('enriches official interactive button replies with display metadata', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeFreshMessageEvent();
    const firstChange = event.payload.entry?.[0]?.changes?.[0];
    if (!firstChange) {
      throw new Error('missing webhook change fixture');
    }
    const message = (firstChange.value as any).messages[0];
    message.id = 'wamid.button-reply-1';
    message.type = 'interactive';
    delete message.text;
    message.interactive = {
      type: 'button_reply',
      button_reply: {
        id: 'yes',
        title: 'Sim',
      },
    };

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        type: EMessageType.text,
        content: expect.objectContaining({
          message: 'Sim',
          official: expect.objectContaining({
            type: 'interactive',
            display: expect.objectContaining({
              kind: 'reply',
              raw_type: 'button_reply',
              title: 'Sim',
              actions: [
                expect.objectContaining({
                  id: 'yes',
                  title: 'Sim',
                }),
              ],
            }),
          }),
        }),
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('enriches official interactive list replies with display metadata', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeFreshMessageEvent();
    const firstChange = event.payload.entry?.[0]?.changes?.[0];
    if (!firstChange) {
      throw new Error('missing webhook change fixture');
    }
    const message = (firstChange.value as any).messages[0];
    message.id = 'wamid.list-reply-1';
    message.type = 'interactive';
    delete message.text;
    message.interactive = {
      type: 'list_reply',
      list_reply: {
        id: 'support',
        title: 'Suporte',
        description: 'Falar com atendimento',
      },
    };

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        type: EMessageType.text,
        content: expect.objectContaining({
          message: 'Suporte',
          official: expect.objectContaining({
            display: expect.objectContaining({
              kind: 'reply',
              raw_type: 'list_reply',
              title: 'Suporte',
              body: 'Falar com atendimento',
            }),
          }),
        }),
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('enriches official WhatsApp Flow replies with submitted data', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeFreshMessageEvent();
    const firstChange = event.payload.entry?.[0]?.changes?.[0];
    if (!firstChange) {
      throw new Error('missing webhook change fixture');
    }
    const message = (firstChange.value as any).messages[0];
    message.id = 'wamid.nfm-reply-1';
    message.type = 'interactive';
    delete message.text;
    message.interactive = {
      type: 'nfm_reply',
      nfm_reply: {
        name: 'flow',
        body: 'Fluxo concluído',
        response_json: JSON.stringify({
          cpf: '00000000000',
          accepted_terms: true,
        }),
      },
    };

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        type: EMessageType.text,
        content: expect.objectContaining({
          official: expect.objectContaining({
            display: expect.objectContaining({
              kind: 'reply',
              raw_type: 'nfm_reply',
              title: 'flow',
              body: 'Fluxo concluído',
              submitted_data: {
                cpf: '00000000000',
                accepted_terms: true,
              },
            }),
          }),
        }),
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('enriches official order messages with product display metadata', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeFreshMessageEvent();
    const firstChange = event.payload.entry?.[0]?.changes?.[0];
    if (!firstChange) {
      throw new Error('missing webhook change fixture');
    }
    const message = (firstChange.value as any).messages[0];
    message.id = 'wamid.order-1';
    message.type = 'order';
    delete message.text;
    message.order = {
      catalog_id: 'catalog-1',
      text: 'Pedido recebido',
      product_items: [
        {
          product_retailer_id: 'sku-1',
          quantity: 2,
          item_price: 199,
          currency: 'BRL',
        },
      ],
    };

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
    });

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'upsert.message',
      expect.objectContaining({
        type: EMessageType.text,
        content: expect.objectContaining({
          message: 'Pedido recebido',
          official: expect.objectContaining({
            order: expect.objectContaining({
              catalog_id: 'catalog-1',
            }),
            display: expect.objectContaining({
              kind: 'order',
              title: 'Pedido',
              body: 'Pedido recebido',
              items: [
                expect.objectContaining({
                  id: 'sku-1',
                  title: 'sku-1',
                }),
              ],
            }),
          }),
        }),
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('maps official Meta contact cards with normalized phone fields', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeContactMessageEvent();
    const message = (event.payload as any).entry[0].changes[0].value
      .messages[0] as Record<string, unknown>;
    message.timestamp = String(Math.floor(Date.now() / 1000));

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
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
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });

  it('maps unsupported official Meta messages as inbound text messages', async () => {
    const { consumer, streamProducerService } = makeConsumer();
    const event = makeUnsupportedMessageEvent();
    const message = (event.payload as any).entry[0].changes[0].value
      .messages[0] as Record<string, unknown>;
    message.timestamp = String(Math.floor(Date.now() / 1000));
    const unsupportedMessage =
      'Mensagem não suportada. Para visualizar este conteúdo, abra a conversa diretamente no dispositivo do WhatsApp.';

    await (consumer as any).processWebhookEvent(event, {
      sourceTopic: 'official.whatsapp.webhook.event',
      partition: 0,
      offset: 1,
      kafkaKey: 'phone-number-1',
      payload: event,
      queueKey: 'phone-number-1',
      assertActive: jest.fn(),
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
            display: expect.objectContaining({
              kind: 'unsupported',
              raw_type: 'video_note',
              title: 'Mensagem não suportada',
              body: unsupportedMessage,
            }),
            unsupported: expect.objectContaining({
              type: 'video_note',
              reason: 'unsupported_meta_message_type',
            }),
          }),
        }),
      }),
      expect.any(String),
      undefined,
      expect.any(Function)
    );
  });
});
