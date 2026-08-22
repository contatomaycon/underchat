import 'reflect-metadata';
import { OfficialWhatsappWebhookWindowRecorderService } from '@core/services/officialWhatsappWebhookWindowRecorder.service';
import { IMetaWhatsappWebhookEvent } from '@core/common/interfaces/IMetaWhatsappWebhookEvent';

function event(
  field = 'messages',
  timestamp: unknown = '1786901045'
): IMetaWhatsappWebhookEvent {
  return {
    received_at: '2026-08-16T17:24:05.100Z',
    raw_body_sha256: 'hash',
    signature_header: 'sha256=signature',
    payload: {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field,
              value: {
                metadata: { phone_number_id: 'phone-number-1' },
                messages: [
                  {
                    from: '55 (19) 98124-9337',
                    id: 'wamid.inbound-1',
                    timestamp,
                    type: 'text',
                    text: { body: 'Olá ?' },
                    context: { id: 'wamid.template-1' },
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

describe('OfficialWhatsappWebhookWindowRecorderService', () => {
  it('records the inbound window with Meta canonical time and identity', async () => {
    jest.useFakeTimers({
      now: new Date('2026-08-16T17:24:06.000Z'),
    });
    const connectionRepository = {
      findActiveByPhoneNumberIdWithWorker: jest.fn(async () => ({
        account_id: 'account-1',
        worker_id: 'worker-1',
      })),
    };
    const windowService = {
      recordInboundMessage: jest.fn(async () => undefined),
    };
    const service = new OfficialWhatsappWebhookWindowRecorderService(
      connectionRepository as never,
      windowService as never
    );

    try {
      await service.record(event());

      expect(windowService.recordInboundMessage).toHaveBeenCalledWith({
        accountId: 'account-1',
        workerId: 'worker-1',
        phone: '5519981249337@s.whatsapp.net',
        remoteJid: '5519981249337@s.whatsapp.net',
        messageId: 'wamid.inbound-1',
        replyToMessageId: 'wamid.template-1',
        syncChat: false,
        inboundAt: '2026-08-16T17:24:05.000Z',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not mutate the official window for missing, stale, or future provider clocks', async () => {
    jest.useFakeTimers({
      now: new Date('2026-08-17T22:45:50.000Z'),
    });
    const connectionRepository = {
      findActiveByPhoneNumberIdWithWorker: jest.fn(async () => ({
        account_id: 'account-1',
        worker_id: 'worker-1',
      })),
    };
    const windowService = {
      recordInboundMessage: jest.fn(async () => undefined),
    };
    const service = new OfficialWhatsappWebhookWindowRecorderService(
      connectionRepository as never,
      windowService as never
    );

    try {
      const now = Date.now();
      const invalidTimestamps = [
        null,
        String(Math.floor((now - 24 * 60 * 60 * 1000) / 1000)),
        String(Math.floor((now + 61 * 1000) / 1000)),
      ];
      for (const timestamp of invalidTimestamps) {
        await service.record(event('messages', timestamp));
      }

      expect(windowService.recordInboundMessage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('never opens a customer window for Meta message echoes', async () => {
    const connectionRepository = {
      findActiveByPhoneNumberIdWithWorker: jest.fn(),
    };
    const windowService = {
      recordInboundMessage: jest.fn(),
    };
    const service = new OfficialWhatsappWebhookWindowRecorderService(
      connectionRepository as never,
      windowService as never
    );

    await service.record(event('message_echoes'));

    expect(
      connectionRepository.findActiveByPhoneNumberIdWithWorker
    ).not.toHaveBeenCalled();
    expect(windowService.recordInboundMessage).not.toHaveBeenCalled();
  });
});
