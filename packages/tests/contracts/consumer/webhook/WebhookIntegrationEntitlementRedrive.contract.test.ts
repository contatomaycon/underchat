import 'reflect-metadata';

const originalWorkerId = process.env.WORKER_ID;
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));
jest.mock('@core/services/baileys', () => ({
  BaileysService: class BaileysService {},
}));
jest.mock('@core/services/wwebjs', () => ({
  WwebjsService: class WwebjsService {},
}));
jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class BaileysIncomingMessageService {},
}));
jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class WwebjsIncomingMessageService {},
}));

import { WebhookIntegrationConsume } from '@core/consumer/webhook/WebhookIntegration.consume';
import { WebhookIntegrationWwebjsConsume } from '@core/consumer/webhook/WebhookIntegrationWwebjs.consume';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
} from '@core/common/exceptions/PlanEntitlementError';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import type { IWebhookIntegrationRequest } from '@core/common/interfaces/IWebhookIntegrationRequest';

afterAll(() => {
  if (originalWorkerId === undefined) {
    delete process.env.WORKER_ID;
  } else {
    process.env.WORKER_ID = originalWorkerId;
  }
});

const request: IWebhookIntegrationRequest = {
  operation_id: 'webhook-operation-1',
  integration_entitlement_revision: '7',
  account_id: 'account-1',
  worker_id: 'worker-1',
  contact_id: 'contact-1',
  contact_is_valided: false,
  mapped_data: { message: 'hello', message_type: 'message' },
  mapping: {},
  body: {},
  phone: '11999999999',
  phone_ddi: '55',
};

type ConsumerHarness = {
  hasCurrentIntegrationEntitlement(
    data: IWebhookIntegrationRequest,
    stage: 'received' | 'publish'
  ): Promise<boolean>;
  publishContactValidationUpdate(
    data: IWebhookIntegrationRequest,
    phoneWithDdi: string,
    isValidated: boolean,
    assertActive?: () => void,
    connectionScope?: {
      worker_id: string;
      source_provider: 'baileys' | 'wwebjs';
      runtime_generation: number;
      connection_epoch: string;
      activated_at: number;
    }
  ): Promise<boolean>;
  processWebhookIntegration(
    data: IWebhookIntegrationRequest,
    assertActive?: () => void
  ): Promise<void>;
  buildUpsertMessage(
    data: IWebhookIntegrationRequest,
    resolvedJids: { remoteJid: string; remoteJidAlt?: string }
  ): {
    event_id?: string;
    message: { key: { id?: string } };
  } | null;
};

function makeHarness(kind: 'baileys' | 'wwebjs') {
  const planEntitlementService = { assertEntitled: jest.fn() };
  const streamProducerService = { send: jest.fn(async () => undefined) };
  const providerService = {
    validatePhone: jest.fn(async () => ({
      valid: true,
      jid: '5511999999999@s.whatsapp.net',
      phone: '5511999999999',
    })),
  };
  const kafkaServiceQueueService = {
    contactValidationUpdate: jest.fn(() => 'contact.validation.update'),
    upsertMessage: jest.fn(() => 'upsert.message'),
  };
  const connectionScope = {
    worker_id: 'worker-1',
    source_provider: kind,
    runtime_generation: 17,
    connection_epoch: `connection-${kind}-17`,
    activated_at: Date.now(),
  };
  const incomingMessageService = {
    captureActiveConnectionScope: jest.fn(async () => connectionScope),
  };
  const consumer =
    kind === 'baileys'
      ? new WebhookIntegrationConsume(
          providerService as never,
          incomingMessageService as never,
          streamProducerService as never,
          kafkaServiceQueueService as never,
          planEntitlementService as never
        )
      : new WebhookIntegrationWwebjsConsume(
          providerService as never,
          incomingMessageService as never,
          streamProducerService as never,
          kafkaServiceQueueService as never,
          planEntitlementService as never
        );

  return {
    consumer: consumer as unknown as ConsumerHarness,
    planEntitlementService,
    streamProducerService,
    providerService,
    connectionScope,
    incomingMessageService,
  };
}

describe.each(['baileys', 'wwebjs'] as const)(
  '%s webhook integration entitlement redrive',
  (kind) => {
    beforeEach(() => {
      process.env.WORKER_ID = 'worker-1';
      jest.clearAllMocks();
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('propagates technical entitlement failures for JetStream retry', async () => {
      const harness = makeHarness(kind);
      const technicalCause = new Error('primary database unavailable');
      harness.planEntitlementService.assertEntitled.mockRejectedValue(
        technicalCause
      );

      let wrappedError: unknown;
      try {
        await harness.consumer.hasCurrentIntegrationEntitlement(
          request,
          'received'
        );
      } catch (error) {
        wrappedError = error;
      }

      expect(wrappedError).toMatchObject({
        name: 'WebhookIntegrationEntitlementUnavailableError',
        reason: 'plan_entitlement_unavailable',
        stage: 'received',
        cause: technicalCause,
      });
    });

    it('terminally drops denial and does not park it', async () => {
      const harness = makeHarness(kind);
      const deniedEntitlement = {
        accountId: request.account_id,
        planProductId: EPlanProduct.integration,
        allowed: false,
        revision: '8',
      };
      harness.planEntitlementService.assertEntitled
        .mockRejectedValueOnce(
          new PlanEntitlementDeniedError(deniedEntitlement)
        )
        .mockRejectedValueOnce(
          new PlanEntitlementRevisionMismatchError(
            { ...deniedEntitlement, allowed: true },
            '7'
          )
        );

      await expect(
        harness.consumer.hasCurrentIntegrationEntitlement(request, 'received')
      ).resolves.toBe(false);
      await expect(
        harness.consumer.hasCurrentIntegrationEntitlement(request, 'publish')
      ).resolves.toBe(false);
      await expect(
        harness.consumer.hasCurrentIntegrationEntitlement(
          { ...request, integration_entitlement_revision: '' },
          'received'
        )
      ).resolves.toBe(false);
    });

    it('rechecks the revision immediately before contact validation publish', async () => {
      const harness = makeHarness(kind);
      harness.planEntitlementService.assertEntitled.mockRejectedValue(
        new PlanEntitlementDeniedError({
          accountId: request.account_id,
          planProductId: EPlanProduct.integration,
          allowed: false,
          revision: '8',
        })
      );

      await expect(
        harness.consumer.publishContactValidationUpdate(
          request,
          '5511999999999',
          true
        )
      ).resolves.toBe(false);
      expect(harness.streamProducerService.send).not.toHaveBeenCalled();
      expect(
        harness.planEntitlementService.assertEntitled
      ).toHaveBeenCalledWith(request.account_id, EPlanProduct.integration, {
        expectedRevision: request.integration_entitlement_revision,
      });

      harness.planEntitlementService.assertEntitled.mockRejectedValue(
        new Error('primary unavailable')
      );
      await expect(
        harness.consumer.publishContactValidationUpdate(
          request,
          '5511999999999',
          true
        )
      ).rejects.toMatchObject({
        name: 'WebhookIntegrationEntitlementUnavailableError',
        stage: 'publish',
      });
      expect(harness.streamProducerService.send).not.toHaveBeenCalled();
    });

    it('propagates the account, revision and webhook source to contact validation', async () => {
      const harness = makeHarness(kind);

      await expect(
        harness.consumer.publishContactValidationUpdate(
          request,
          '5511999999999',
          true,
          undefined,
          harness.connectionScope
        )
      ).resolves.toBe(true);

      expect(harness.streamProducerService.send).toHaveBeenCalledWith(
        'contact.validation.update',
        {
          contact_id: request.contact_id,
          phone: '5511999999999',
          is_validated: true,
          account_id: request.account_id,
          integration_entitlement_revision:
            request.integration_entitlement_revision,
          operation_id: request.operation_id,
          source: 'webhook_integration',
          worker_id: 'worker-1',
          source_provider: kind,
          runtime_generation: 17,
          connection_epoch: `connection-${kind}-17`,
        },
        `${request.account_id}:${request.contact_id}`
      );
    });

    it('derives one physical stanza from operation_id without using content', () => {
      const harness = makeHarness(kind);
      const resolvedJids = {
        remoteJid: '5511999999999@s.whatsapp.net',
      };

      const first = harness.consumer.buildUpsertMessage(request, resolvedJids);
      const retried = harness.consumer.buildUpsertMessage(
        { ...request },
        resolvedJids
      );
      const intentionalRepeat = harness.consumer.buildUpsertMessage(
        { ...request, operation_id: 'webhook-operation-2' },
        resolvedJids
      );

      expect(first?.message.key.id).toEqual(retried?.message.key.id);
      expect(intentionalRepeat?.message.key.id).not.toEqual(
        first?.message.key.id
      );
    });

    it('stops before publishing when assignment is revoked after provider validation', async () => {
      const harness = makeHarness(kind);
      harness.planEntitlementService.assertEntitled.mockResolvedValue({
        revision: request.integration_entitlement_revision,
      });
      let revoked = false;
      harness.providerService.validatePhone.mockImplementationOnce(async () => {
        revoked = true;
        return {
          valid: true,
          jid: '5511999999999@s.whatsapp.net',
          phone: '5511999999999',
        };
      });

      await expect(
        harness.consumer.processWebhookIntegration(request, () => {
          if (revoked) {
            throw new Error('assignment_revoked');
          }
        })
      ).rejects.toThrow('assignment_revoked');
      expect(harness.streamProducerService.send).not.toHaveBeenCalled();
    });

    it('stops before publishing when the provider connection is replaced', async () => {
      const harness = makeHarness(kind);
      harness.planEntitlementService.assertEntitled.mockResolvedValue({
        revision: request.integration_entitlement_revision,
      });
      harness.incomingMessageService.captureActiveConnectionScope
        .mockResolvedValueOnce(harness.connectionScope)
        .mockResolvedValueOnce(harness.connectionScope)
        .mockResolvedValue({
          ...harness.connectionScope,
          connection_epoch: `connection-${kind}-18`,
        });

      await expect(
        harness.consumer.processWebhookIntegration(request)
      ).rejects.toThrow('Webhook integration runtime is stale');

      expect(harness.providerService.validatePhone).toHaveBeenCalledTimes(1);
      expect(harness.streamProducerService.send).not.toHaveBeenCalled();
    });
  }
);
