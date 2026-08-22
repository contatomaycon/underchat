import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { OutboundWebhookEventType } from '@core/common/constants/outboundWebhookEvents';
import { MessageStatusService } from '@core/services/messageStatus.service';

describe('MessageStatusService outbound webhook contract', () => {
  it.each([
    [
      'sent',
      { is_sent: false, is_delivered: false, is_seen: false },
      { is_sent: true },
      ['message.delivery.sent'],
    ],
    [
      'delivered',
      { is_sent: true, is_delivered: false, is_seen: false },
      { is_sent: true, is_delivered: true },
      ['message.delivery.delivered'],
    ],
    [
      'read with missing lower acknowledgements',
      { is_sent: false, is_delivered: false, is_seen: false },
      { is_sent: true, is_delivered: true, is_seen: true },
      [
        'message.delivery.sent',
        'message.delivery.delivered',
        'message.delivery.read',
      ],
    ],
    [
      'repeated read',
      { is_sent: true, is_delivered: true, is_seen: true },
      { is_sent: true, is_delivered: true, is_seen: true },
      [],
    ],
  ] as const)(
    'emits only durable delivery transitions for %s',
    (_label, currentSummary, patch, expected) => {
      const service = new MessageStatusService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );
      const resolveDeliveryEventTypes = (
        service as unknown as {
          resolveDeliveryEventTypes(
            inputPatch: Record<string, boolean>,
            baseline: Record<string, boolean>
          ): OutboundWebhookEventType[];
        }
      ).resolveDeliveryEventTypes.bind(service);

      expect(resolveDeliveryEventTypes(patch, currentSummary)).toEqual(
        expected
      );
    }
  );

  it('updates inbound read state without emitting outbound delivery events', async () => {
    const prepareDeliveryWebhookEvents = jest.fn(async () => []);
    const message = {
      message_id: 'message-inbound',
      chat_id: 'chat-1',
      message_key: { id: 'provider-1', from_me: false },
      account: { id: 'account-1', name: 'Account' },
      worker: {
        id: '01900000-0000-7000-8000-000000000099',
        name: 'Worker',
      },
      type_user: 'client',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Inbound' },
      summary: { is_sent: false, is_delivered: false, is_seen: false },
    } as unknown as IChatMessage;
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    Object.assign(service, {
      prepareDeliveryWebhookEvents,
      updateSummaryAtomicallyWithLock: jest.fn(async () => 'updated'),
      invalidateMessageCache: jest.fn(async () => undefined),
      findMessageByMessageIdForWebhookConfirmation: jest.fn(async () => ({
        ...message,
        summary: { ...message.summary, is_seen: true },
      })),
      completeDeliveryWebhookEvents: jest.fn(async () => undefined),
      publishCentrifugoImmediate: jest.fn(async () => undefined),
    });

    const result = await (
      service as unknown as {
        applySummaryPatchToMessage(
          accountId: string,
          providerMessageId: string,
          inputMessage: IChatMessage,
          patch: { is_seen: boolean }
        ): Promise<IChatMessage | null>;
      }
    ).applySummaryPatchToMessage('account-1', 'provider-1', message, {
      is_seen: true,
    });

    expect(result?.summary.is_seen).toBe(true);
    expect(prepareDeliveryWebhookEvents).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      'message_status'
    );
  });

  it('persists the highest outbound delivery status with the summary patch', async () => {
    const prepareDeliveryWebhookEvents = jest.fn(async () => []);
    const updateSummaryAtomicallyWithLock = jest.fn(async () => 'updated');
    const message = {
      message_id: 'message-outbound-read',
      chat_id: 'chat-1',
      message_key: { id: 'provider-read', from_me: true },
      account: { id: 'account-1', name: 'Account' },
      worker: {
        id: '01900000-0000-7000-8000-000000000099',
        name: 'Worker',
      },
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Outbound' },
      delivery_status: 'queued',
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
    } as unknown as IChatMessage;
    const canonicalMessage = {
      ...message,
      delivery_status: 'read',
      summary: {
        ...message.summary,
        is_sent: true,
        is_delivered: true,
        is_seen: true,
      },
    } as IChatMessage;
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    Object.assign(service, {
      prepareDeliveryWebhookEvents,
      updateSummaryAtomicallyWithLock,
      invalidateMessageCache: jest.fn(async () => undefined),
      findMessageByMessageIdForWebhookConfirmation: jest.fn(
        async () => canonicalMessage
      ),
      completeDeliveryWebhookEvents: jest.fn(async () => undefined),
      publishCentrifugoImmediate: jest.fn(async () => undefined),
    });

    const result = await (
      service as unknown as {
        applySummaryPatchToMessage(
          accountId: string,
          providerMessageId: string,
          inputMessage: IChatMessage,
          patch: {
            is_sent: boolean;
            is_delivered: boolean;
            is_seen: boolean;
          }
        ): Promise<IChatMessage | null>;
      }
    ).applySummaryPatchToMessage('account-1', 'provider-read', message, {
      is_sent: true,
      is_delivered: true,
      is_seen: true,
    });

    expect(result?.delivery_status).toBe('read');
    expect(prepareDeliveryWebhookEvents).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_status: 'read' }),
      [
        'message.delivery.sent',
        'message.delivery.delivered',
        'message.delivery.read',
      ],
      'message_status'
    );
    expect(updateSummaryAtomicallyWithLock).toHaveBeenCalledWith(
      message.message_id,
      message.summary,
      { is_sent: true, is_delivered: true, is_seen: true },
      5,
      [],
      undefined,
      'read',
      undefined
    );
  });

  it('uses a monotonic delivery rank in the Elasticsearch mutation', () => {
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const script = (
      service as unknown as { buildMessageSummaryScriptSource(): string }
    ).buildMessageSummaryScriptSource();
    const params = (
      service as unknown as {
        buildMessageSummaryScriptParams(
          baseline: IChatMessage['summary'],
          patch: { is_seen: boolean },
          eventIds: string[],
          deliveryStatus: 'read'
        ): Record<string, unknown>;
      }
    ).buildMessageSummaryScriptParams(
      {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      { is_seen: true },
      [],
      'read'
    );

    expect(params.delivery_status).toBe('read');
    expect(script).toContain("'ambiguous': 1");
    expect(script).toContain("'sent': 2");
    expect(script).toContain("'failed': 3");
    expect(script).toContain("'delivered': 4");
    expect(script).toContain("'read': 5");
    expect(script).toContain('nextDeliveryRank < currentDeliveryRank');
  });

  it('does not backfill a repeated delivery callback after the first fact had no target', async () => {
    const prepareDeliveryWebhookEvents = jest.fn(async () => []);
    const message = {
      message_id: 'message-outbound-delivered',
      chat_id: 'chat-1',
      message_key: { id: 'provider-1', from_me: true },
      account: { id: 'account-1', name: 'Account' },
      worker: {
        id: '01900000-0000-7000-8000-000000000099',
        name: 'Worker',
      },
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Outbound' },
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: false,
        is_sent_to_internal: true,
      },
    } as unknown as IChatMessage;
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    Object.assign(service, {
      prepareDeliveryWebhookEvents,
      updateSummaryAtomicallyWithLock: jest.fn(async () => 'noop'),
      invalidateMessageCache: jest.fn(async () => undefined),
      findMessageByMessageIdForWebhookConfirmation: jest.fn(
        async () => message
      ),
      completeDeliveryWebhookEvents: jest.fn(async () => undefined),
      publishCentrifugoImmediate: jest.fn(async () => undefined),
    });

    await expect(
      (
        service as unknown as {
          applySummaryPatchToMessage(
            accountId: string,
            providerMessageId: string,
            inputMessage: IChatMessage,
            patch: { is_delivered: boolean }
          ): Promise<IChatMessage | null>;
        }
      ).applySummaryPatchToMessage('account-1', 'provider-1', message, {
        is_delivered: true,
      })
    ).resolves.toEqual(
      expect.objectContaining({ message_id: message.message_id })
    );

    expect(prepareDeliveryWebhookEvents).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      'message_status'
    );
    expect(
      (service as unknown as { publishCentrifugoImmediate: jest.Mock })
        .publishCentrifugoImmediate
    ).not.toHaveBeenCalled();
  });

  it('does not backfill a repeated terminal failure after the first fact had no target', async () => {
    const prepareDeliveryWebhookEvents = jest.fn(async () => []);
    const message = {
      message_id: 'message-outbound-failed',
      chat_id: 'chat-1',
      message_key: { id: 'provider-failed', from_me: true },
      account: { id: 'account-1', name: 'Account' },
      worker: {
        id: '01900000-0000-7000-8000-000000000099',
        name: 'Worker',
      },
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Outbound' },
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: false,
      },
    } as unknown as IChatMessage;
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    Object.assign(service, {
      findMessageByMessageIdWithRetry: jest.fn(async () => message),
      prepareDeliveryWebhookEvents,
      withStatusMutationLock: jest.fn(async () => 'noop'),
      findMessageByMessageIdForWebhookConfirmation: jest.fn(
        async () => message
      ),
      completeDeliveryWebhookEvents: jest.fn(async () => undefined),
      publishCentrifugoImmediate: jest.fn(async () => undefined),
    });

    await expect(
      service.markMessageAsNotSent('account-1', message.message_id)
    ).resolves.toEqual(
      expect.objectContaining({ message_id: message.message_id })
    );

    expect(prepareDeliveryWebhookEvents).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      'message_status'
    );
    expect(
      (service as unknown as { publishCentrifugoImmediate: jest.Mock })
        .publishCentrifugoImmediate
    ).not.toHaveBeenCalled();
  });

  it('lets a definitive failure override sent but protects delivered and seen', async () => {
    for (const summary of [
      { is_sent: true, is_delivered: false, is_seen: false },
      { is_sent: true, is_delivered: true, is_seen: false },
      { is_sent: true, is_delivered: true, is_seen: true },
    ]) {
      const message = {
        message_id: `message-monotonic-${JSON.stringify(summary)}`,
        account: { id: 'account-1' },
        summary,
      } as unknown as IChatMessage;
      const service = new MessageStatusService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );
      const prepareDeliveryWebhookEvents = jest.fn(async () => []);
      const withStatusMutationLock = jest.fn(async () => 'noop');
      const publishCentrifugoImmediate = jest.fn();
      const canonicalMessage = summary.is_delivered
        ? message
        : ({
            ...message,
            delivery_status: 'failed',
            summary: {
              is_sent: false,
              is_delivered: false,
              is_seen: false,
              is_sent_to_internal: false,
            },
          } as IChatMessage);
      Object.assign(service, {
        findMessageByMessageIdWithRetry: jest.fn(async () => message),
        prepareDeliveryWebhookEvents,
        withStatusMutationLock,
        publishCentrifugoImmediate,
        findMessageByMessageIdForWebhookConfirmation: jest.fn(
          async () => canonicalMessage
        ),
      });

      const result = await service.markMessageAsNotSent(
        'account-1',
        message.message_id
      );
      if (summary.is_delivered || summary.is_seen) {
        expect(result).toBe(message);
        expect(prepareDeliveryWebhookEvents).not.toHaveBeenCalled();
        expect(withStatusMutationLock).not.toHaveBeenCalled();
      } else {
        expect(result?.delivery_status).toBe('failed');
        expect(withStatusMutationLock).toHaveBeenCalledTimes(1);
      }
      expect(publishCentrifugoImmediate).not.toHaveBeenCalled();
    }
  });

  it('does not let an ambiguous local outcome override sent', async () => {
    const message = {
      message_id: 'message-sent-before-ambiguous',
      account: { id: 'account-1' },
      summary: {
        is_sent: true,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
    } as unknown as IChatMessage;
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const withStatusMutationLock = jest.fn();
    Object.assign(service, {
      findMessageByMessageIdWithRetry: jest.fn(async () => message),
      withStatusMutationLock,
    });

    await expect(
      service.markMessageAsNotSent(
        'account-1',
        message.message_id,
        undefined,
        'ambiguous'
      )
    ).resolves.toBe(message);
    expect(withStatusMutationLock).not.toHaveBeenCalled();
  });

  it('rejects an internal terminal failure whose message belongs to another account', async () => {
    const message = {
      message_id: 'message-other-account',
      account: { id: 'account-b', name: 'Other account' },
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
    } as unknown as IChatMessage;
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const prepareDeliveryWebhookEvents = jest.fn();
    const withStatusMutationLock = jest.fn();
    const publishCentrifugoImmediate = jest.fn();
    Object.assign(service, {
      findMessageByMessageIdWithRetry: jest.fn(async () => message),
      prepareDeliveryWebhookEvents,
      withStatusMutationLock,
      publishCentrifugoImmediate,
    });

    await expect(
      service.markMessageAsNotSent('account-a', message.message_id)
    ).resolves.toBeNull();

    expect(prepareDeliveryWebhookEvents).not.toHaveBeenCalled();
    expect(withStatusMutationLock).not.toHaveBeenCalled();
    expect(publishCentrifugoImmediate).not.toHaveBeenCalled();
  });

  it('keeps prepared and recovered delivery envelopes semantically identical', async () => {
    const prepareBestEffort = jest.fn(async () => null);
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { prepareBestEffort } as never
    );
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: {
        id: '01900000-0000-7000-8000-000000000099',
        name: 'Worker',
      },
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Hello' },
      summary: { is_sent: true },
    } as unknown as IChatMessage;
    const prepareDeliveryWebhookEvents = (
      service as unknown as {
        prepareDeliveryWebhookEvents(
          inputMessage: IChatMessage,
          eventTypes: readonly OutboundWebhookEventType[],
          source: string
        ): Promise<unknown>;
      }
    ).prepareDeliveryWebhookEvents.bind(service);

    await prepareDeliveryWebhookEvents(
      message,
      ['message.delivery.sent'],
      'message_status'
    );

    expect(prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'message.delivery.sent',
        previous: null,
      })
    );
  });

  it('falls back to the prepared envelope when rebuilding the canonical delivery payload fails', async () => {
    const completeBestEffort = jest.fn(async () => true);
    const service = new MessageStatusService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { completeBestEffort } as never
    );
    const eventId = '01900000-0000-7000-8000-000000000001';
    const preparedEnvelope = {
      id: eventId,
      type: 'message.delivery.sent' as const,
      api_version: '1' as const,
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: 'account-1',
      aggregate: { type: 'message' as const, id: 'message-1' },
      data: { delivery_status: 'sent' },
      previous: null,
      context: { source: 'message_status', actor: { type: 'system' as const } },
    };
    const oversizedContent = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `field_${index}`,
        'x'.repeat(300_000),
      ])
    );
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: {
        id: '01900000-0000-7000-8000-000000000099',
        name: 'Worker',
      },
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: oversizedContent,
      summary: { is_sent: true },
    } as unknown as IChatMessage;
    const completeDeliveryWebhookEvents = (
      service as unknown as {
        completeDeliveryWebhookEvents(
          inputMessage: IChatMessage,
          preparedEvents: unknown[],
          source: string
        ): Promise<void>;
      }
    ).completeDeliveryWebhookEvents.bind(service);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    try {
      await expect(
        completeDeliveryWebhookEvents(
          message,
          [
            {
              eventType: 'message.delivery.sent',
              prepared: {
                eventId,
                envelope: preparedEnvelope,
                created: true,
                state: 'preparing',
              },
            },
          ],
          'message_status'
        )
      ).resolves.toBeUndefined();
      expect(completeBestEffort).toHaveBeenCalledTimes(1);
      expect(completeBestEffort).toHaveBeenCalledWith({
        eventId,
        accountId: 'account-1',
        envelope: preparedEnvelope,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        '[OutboundWebhook] Delivery event finalization failed',
        expect.objectContaining({
          event_id: eventId,
          error: 'outbound_webhook_payload_too_large',
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
