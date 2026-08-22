import 'reflect-metadata';
import { createHmac } from 'node:crypto';

import {
  WhatsappEmbeddedWebhookAuthError,
  WhatsappEmbeddedWebhookUseCase,
} from '@core/useCases/webhook/WhatsappEmbeddedWebhook.useCase';

const t = ((key: string) => key) as never;

function makeUseCase(overrides?: {
  viewWebhookSecurityConfig?: jest.Mock;
  send?: jest.Mock;
  recordOfficialWindow?: jest.Mock;
}) {
  const whatsappEmbeddedService = {
    viewWebhookSecurityConfig:
      overrides?.viewWebhookSecurityConfig ??
      jest.fn(async () => ({
        app_secret: 'app-secret',
        webhook_verify_token: 'verify-token',
      })),
  };
  const streamProducerService = {
    send: overrides?.send ?? jest.fn(async () => undefined),
  };
  const kafkaServiceQueueService = {
    officialWhatsappWebhookEvent: jest.fn(
      () => 'official.whatsapp.webhook.event'
    ),
  };
  const officialWindowRecorder = {
    record: overrides?.recordOfficialWindow ?? jest.fn(async () => undefined),
  };

  const useCase = new WhatsappEmbeddedWebhookUseCase(
    whatsappEmbeddedService as never,
    streamProducerService as never,
    kafkaServiceQueueService as never,
    officialWindowRecorder as never
  );

  return {
    useCase,
    whatsappEmbeddedService,
    streamProducerService,
    kafkaServiceQueueService,
    officialWindowRecorder,
  };
}

describe('WhatsappEmbeddedWebhookUseCase', () => {
  it('returns the challenge only when mode and verify token match', async () => {
    const { useCase } = makeUseCase();

    await expect(
      useCase.verify(t, {
        mode: 'subscribe',
        verifyToken: 'verify-token',
        challenge: 'challenge-123',
      })
    ).resolves.toBe('challenge-123');

    await expect(
      useCase.verify(t, {
        mode: 'subscribe',
        verifyToken: 'wrong-token',
        challenge: 'challenge-123',
      })
    ).resolves.toBeNull();
  });

  it('validates HMAC signature and publishes WhatsApp payload with phone key', async () => {
    const { useCase, streamProducerService, officialWindowRecorder } =
      makeUseCase();
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-number-1' },
                messages: [{ id: 'wamid.1', type: 'text' }],
              },
            },
          ],
        },
      ],
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', 'app-secret')
      .update(rawBody)
      .digest('hex')}`;

    await expect(
      useCase.receive(t, {
        body,
        rawBody,
        signatureHeader: signature,
      })
    ).resolves.toEqual({});

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'official.whatsapp.webhook.event',
      expect.objectContaining({
        payload: body,
        raw_body_sha256: expect.any(String),
        signature_header: signature,
        received_at: expect.any(String),
      }),
      'phone-number-1'
    );
    expect(officialWindowRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: body,
        received_at: expect.any(String),
      })
    );
    expect(
      officialWindowRecorder.record.mock.invocationCallOrder[0]
    ).toBeLessThan(streamProducerService.send.mock.invocationCallOrder[0]);
  });

  it('rejects missing or invalid signatures before publishing', async () => {
    const { useCase, streamProducerService } = makeUseCase();

    await expect(
      useCase.receive(t, {
        body: { object: 'whatsapp_business_account' },
        rawBody: Buffer.from('{}'),
        signatureHeader: 'sha256=invalid',
      })
    ).rejects.toBeInstanceOf(WhatsappEmbeddedWebhookAuthError);

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('acknowledges non WhatsApp objects without publishing', async () => {
    const { useCase, streamProducerService } = makeUseCase();
    const body = { object: 'page' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', 'app-secret')
      .update(rawBody)
      .digest('hex')}`;

    await expect(
      useCase.receive(t, {
        body,
        rawBody,
        signatureHeader: signature,
      })
    ).resolves.toEqual({ ignored: true });

    expect(streamProducerService.send).not.toHaveBeenCalled();
  });
});
