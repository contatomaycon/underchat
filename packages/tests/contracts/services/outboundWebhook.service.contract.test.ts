import 'reflect-metadata';
import {
  generateOutboundWebhookSecret,
  hashOutboundWebhookSecret,
  OutboundWebhookService,
  OutboundWebhookServiceError,
  previewOutboundWebhookSecret,
} from '@core/services/outboundWebhook.service';
import type { OutboundWebhookRecord } from '@core/repositories/outboundWebhook/OutboundWebhook.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementDeniedError } from '@core/common/exceptions/PlanEntitlementError';

const accountId = '01900000-0000-7000-8000-000000000001';
const webhookId = '01900000-0000-7000-8000-000000000002';
const actorUserId = '01900000-0000-7000-8000-000000000003';
const eventId = '01900000-0000-7000-8000-000000000004';
const deliveryId = '01900000-0000-7000-8000-000000000005';
const channelId = '01900000-0000-7000-8000-000000000006';

const webhookRecord: OutboundWebhookRecord = {
  outbound_webhook_id: webhookId,
  channel_id: channelId,
  channel: {
    id: channelId,
    name: 'Support',
    number: '+5511999999999',
    available: true,
  },
  name: 'CRM',
  url: 'https://example.com/hooks/underchat',
  status: 'inactive',
  secret_preview: 'uc_whsec_...12345678',
  config_version: 3,
  event_types: ['chat.created'],
  verified_at: null,
  consecutive_dead_deliveries: 0,
  suspended_at: null,
  suspension_reason: null,
  created_at: '2026-07-10T12:00:00.000Z',
  updated_at: '2026-07-10T12:00:00.000Z',
};

describe('OutboundWebhookService contract', () => {
  const originalAppEnvironment = process.env.APP_ENVIRONMENT;

  afterEach(() => {
    if (originalAppEnvironment === undefined) {
      delete process.env.APP_ENVIRONMENT;
    } else {
      process.env.APP_ENVIRONMENT = originalAppEnvironment;
    }
  });

  it('generates a 256-bit prefixed secret, SHA-256 hash and safe preview', () => {
    const secret = generateOutboundWebhookSecret();

    expect(secret).toMatch(/^uc_whsec_[A-Za-z0-9_-]{43}$/);
    expect(hashOutboundWebhookSecret(secret)).toMatch(/^[a-f0-9]{64}$/);
    expect(previewOutboundWebhookSecret(secret)).toBe(
      `uc_whsec_...${secret.slice(-8)}`
    );
    expect(previewOutboundWebhookSecret(secret)).not.toContain(secret);
  });

  it('returns the raw secret only while storing hash, preview and encrypted value', async () => {
    const uppercaseChannelId = '019ABCDE-ABCD-7ABC-8ABC-ABCDEFABCDEF';
    let createdInput: Record<string, unknown> | undefined;
    const repository = {
      create: jest.fn(async (input: Record<string, unknown>) => {
        createdInput = input;
        return 'created' as const;
      }),
      findById: jest.fn(async () => ({
        ...webhookRecord,
        outbound_webhook_id:
          (createdInput?.outbound_webhook_id as string) ?? webhookId,
        secret_preview:
          (createdInput?.secret_preview as string) ??
          webhookRecord.secret_preview,
        config_version: 1,
      })),
    };
    const encrypt = jest.fn((value: string) => `aes-gcm:${value.length}`);
    const service = new OutboundWebhookService(
      repository as never,
      { encrypt } as never,
      {} as never
    );

    const result = await service.create(accountId, {
      name: ' CRM ',
      url: 'https://example.com/webhook',
      channel_id: uppercaseChannelId,
      event_types: ['chat.created'],
    });

    expect(result.secret).toMatch(/^uc_whsec_/);
    expect(encrypt).toHaveBeenCalledWith(result.secret);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: accountId,
        channel_id: uppercaseChannelId.toLowerCase(),
        name: 'CRM',
        url: 'https://example.com/webhook',
        secret_hash: hashOutboundWebhookSecret(result.secret),
        secret_encrypted: `aes-gcm:${result.secret.length}`,
        secret_preview: previewOutboundWebhookSecret(result.secret),
        event_types: ['chat.created'],
      })
    );
    expect(createdInput).not.toHaveProperty('secret');
    expect(result.webhook).not.toHaveProperty('secret_hash');
    expect(result.webhook).not.toHaveProperty('secret_encrypted');
  });

  it('never decrypts or exposes a secret on list and view operations', async () => {
    const repository = {
      list: jest.fn(async () => [webhookRecord]),
      findById: jest.fn(async () => webhookRecord),
    };
    const decrypt = jest.fn();
    const service = new OutboundWebhookService(
      repository as never,
      { decrypt } as never,
      {} as never
    );

    const [listed, viewed] = await Promise.all([
      service.list(accountId),
      service.view(accountId, webhookId),
    ]);

    expect(decrypt).not.toHaveBeenCalled();
    expect(JSON.stringify([listed, viewed])).not.toContain('secret_encrypted');
    expect(JSON.stringify([listed, viewed])).not.toContain('secret_hash');
  });

  it('creates a targeted ready test delivery with the current config version', async () => {
    const repository = {
      findById: jest.fn(async () => webhookRecord),
      isAccountEligible: jest.fn(async () => true),
      findDeliveryForEvent: jest.fn(async () => ({
        outbound_webhook_delivery_id: deliveryId,
      })),
    };
    const recordReady = jest.fn(async () => ({ eventId }));
    const service = new OutboundWebhookService(
      repository as never,
      {} as never,
      { recordReady } as never
    );

    await expect(
      service.enqueueTest(accountId, webhookId, actorUserId)
    ).resolves.toEqual({
      outbound_webhook_event_id: eventId,
      outbound_webhook_delivery_id: deliveryId,
      status: 'pending',
    });
    expect(recordReady).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        eventType: 'webhook.test',
        aggregate: { type: 'webhook', id: webhookId },
        source: 'integration_test',
        isTest: true,
        targetWebhookId: webhookId,
        targetConfigVersion: webhookRecord.config_version,
        channelIds: [channelId],
        actor: { type: 'user', id: actorUserId },
        data: {
          verification: expect.objectContaining({
            webhook_id: webhookId,
            config_version: webhookRecord.config_version,
          }),
        },
      })
    );
  });

  it('maps a downgrade between capture and completion to the Integration 402 error', async () => {
    const findDeliveryForEvent = jest.fn();
    const assertEntitled = jest
      .fn()
      .mockResolvedValueOnce({ allowed: true, revision: '7' })
      .mockRejectedValueOnce(
        new PlanEntitlementDeniedError({
          accountId,
          planProductId: EPlanProduct.integration,
          allowed: false,
          revision: '8',
        })
      );
    const service = new OutboundWebhookService(
      {
        findById: jest.fn(async () => webhookRecord),
        findDeliveryForEvent,
      } as never,
      {} as never,
      {
        recordReady: jest.fn(async () => ({
          eventId,
          state: 'discarded',
        })),
      } as never,
      { assertEntitled } as never
    );

    await expect(
      service.enqueueTest(accountId, webhookId, actorUserId)
    ).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'integration_plan_required',
      })
    );
    expect(assertEntitled).toHaveBeenCalledTimes(2);
    expect(findDeliveryForEvent).not.toHaveBeenCalled();
  });

  it('maps a restored but changed entitlement epoch during test completion to 409', async () => {
    const findDeliveryForEvent = jest.fn();
    const assertEntitled = jest.fn(async () => ({
      allowed: true,
      revision: '9',
    }));
    const service = new OutboundWebhookService(
      {
        findById: jest.fn(async () => webhookRecord),
        findDeliveryForEvent,
      } as never,
      {} as never,
      {
        recordReady: jest.fn(async () => ({
          eventId,
          state: 'discarded',
        })),
      } as never,
      { assertEntitled } as never
    );

    await expect(
      service.enqueueTest(accountId, webhookId, actorUserId)
    ).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'entitlement_epoch_mismatch',
      })
    );
    expect(assertEntitled).toHaveBeenCalledTimes(2);
    expect(findDeliveryForEvent).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'deleted endpoint',
      captureError: 'outbound_webhook_target_not_found',
      currentWebhook: null,
      currentEligible: true,
      expectedCode: 'not_found',
    },
    {
      name: 'deleted channel',
      captureError: 'outbound_webhook_event_no_target',
      currentWebhook: {
        ...webhookRecord,
        channel: { ...webhookRecord.channel, available: false },
      },
      currentEligible: true,
      expectedCode: 'channel_unavailable',
    },
    {
      name: 'account or plan eligibility change',
      captureError: 'outbound_webhook_event_no_target',
      currentWebhook: webhookRecord,
      currentEligible: false,
      expectedCode: 'account_ineligible',
    },
    {
      name: 'concurrent endpoint update',
      captureError: 'outbound_webhook_target_not_found',
      currentWebhook: {
        ...webhookRecord,
        config_version: webhookRecord.config_version + 1,
      },
      currentEligible: true,
      expectedCode: 'concurrent_update',
    },
  ] as const)(
    'maps a $name during test target capture to $expectedCode',
    async ({ captureError, currentWebhook, currentEligible, expectedCode }) => {
      const findById = jest
        .fn()
        .mockResolvedValueOnce(webhookRecord)
        .mockResolvedValueOnce(currentWebhook);
      const isAccountEligible = jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(currentEligible);
      const service = new OutboundWebhookService(
        {
          findById,
          isAccountEligible,
        } as never,
        {} as never,
        {
          recordReady: jest.fn(async () => {
            throw new Error(captureError);
          }),
        } as never
      );

      await expect(
        service.enqueueTest(accountId, webhookId, actorUserId)
      ).rejects.toEqual(
        expect.objectContaining<Partial<OutboundWebhookServiceError>>({
          code: expectedCode,
        })
      );
      expect(findById).toHaveBeenCalledTimes(2);
      expect(isAccountEligible).toHaveBeenCalledTimes(
        currentWebhook?.channel.available ? 2 : 1
      );
    }
  );

  it('rejects a channel from another account during creation', async () => {
    const repository = {
      create: jest.fn(async () => 'invalid_channel' as const),
      findById: jest.fn(),
    };
    const service = new OutboundWebhookService(
      repository as never,
      { encrypt: jest.fn(() => 'encrypted') } as never,
      {} as never
    );

    await expect(
      service.create(accountId, {
        name: 'CRM',
        url: 'https://example.com/webhook',
        channel_id: channelId,
        event_types: ['chat.created'],
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'invalid_channel',
      })
    );
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('rejects creation after the per-account endpoint limit is reached', async () => {
    const repository = {
      create: jest.fn(async () => 'endpoint_limit' as const),
      findById: jest.fn(),
    };
    const service = new OutboundWebhookService(
      repository as never,
      { encrypt: jest.fn(() => 'encrypted') } as never,
      {} as never
    );

    await expect(
      service.create(accountId, {
        name: 'CRM',
        url: 'https://example.com/webhook',
        channel_id: channelId,
        event_types: ['chat.created'],
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'endpoint_limit',
      })
    );
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('never pairs a stale one-time secret with a newer concurrent rotation', async () => {
    const repository = {
      rotateSecret: jest.fn(async () => 4),
      findById: jest.fn(async () => ({
        ...webhookRecord,
        config_version: 5,
        secret_preview: 'uc_whsec_...newer999',
      })),
    };
    const service = new OutboundWebhookService(
      repository as never,
      { encrypt: jest.fn(() => 'encrypted') } as never,
      {} as never
    );

    await expect(service.rotateSecret(accountId, webhookId)).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'concurrent_update',
      })
    );
  });

  it('blocks activation before mutation when the account plan is ineligible', async () => {
    const setActive = jest.fn();
    const service = new OutboundWebhookService(
      {
        isAccountEligible: jest.fn(async () => false),
        setActive,
      } as never,
      {} as never,
      {} as never
    );

    await expect(service.setActive(accountId, webhookId, true)).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'account_ineligible',
      })
    );
    expect(setActive).not.toHaveBeenCalled();
  });

  it('blocks manual redelivery before mutation when the account plan is ineligible', async () => {
    const redeliver = jest.fn();
    const service = new OutboundWebhookService(
      {
        isAccountEligible: jest.fn(async () => false),
        redeliver,
      } as never,
      {} as never,
      {} as never
    );

    await expect(
      service.redeliver(accountId, webhookId, deliveryId, actorUserId)
    ).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'account_ineligible',
      })
    );
    expect(redeliver).not.toHaveBeenCalled();
  });

  const serviceForUnavailableChannel = new OutboundWebhookService(
    {
      isAccountEligible: jest.fn(async () => true),
      setActive: jest.fn(async () => 'channel_unavailable' as const),
      redeliver: jest.fn(async () => ({
        status: 'channel_unavailable' as const,
      })),
    } as never,
    {} as never,
    {} as never
  );

  it.each([
    [
      'setActive',
      () => serviceForUnavailableChannel.setActive(accountId, webhookId, true),
    ],
    [
      'redeliver',
      () =>
        serviceForUnavailableChannel.redeliver(
          accountId,
          webhookId,
          deliveryId,
          actorUserId
        ),
    ],
  ] as const)(
    'maps unavailable channel from %s to conflict',
    async (_name, run) => {
      await expect(run()).rejects.toEqual(
        expect.objectContaining<Partial<OutboundWebhookServiceError>>({
          code: 'channel_unavailable',
        })
      );
    }
  );

  it('treats staging and unknown deployments as production URL policy', async () => {
    process.env.APP_ENVIRONMENT = 'staging';
    const repository = { create: jest.fn() };
    const service = new OutboundWebhookService(
      repository as never,
      { encrypt: jest.fn() } as never,
      {} as never
    );

    await expect(
      service.create(accountId, {
        name: 'CRM',
        url: 'https://example.com:8443/webhook',
        channel_id: channelId,
        event_types: ['chat.created'],
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<OutboundWebhookServiceError>>({
        code: 'invalid_url',
      })
    );
    expect(repository.create).not.toHaveBeenCalled();
  });
});
