import 'reflect-metadata';

const mockRunnerOptions: Array<Record<string, unknown>> = [];

jest.mock('@core/common/functions/kafkaConsumerRunner', () => ({
  KafkaConsumerRunner: class KafkaConsumerRunner {
    public consumer = null;

    constructor(options: Record<string, unknown>) {
      mockRunnerOptions.push(options);
    }

    async start(onConnected?: () => void): Promise<void> {
      onConnected?.();
    }

    async close(): Promise<void> {}
  },
}));

import { ContactValidationUpdateConsume } from '@core/consumer/contact/ContactValidationUpdate.consume';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
} from '@core/common/exceptions/PlanEntitlementError';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import type { IContactValidationUpdate } from '@core/common/interfaces/IContactValidationUpdate';
import type {
  KafkaConsumerRunnerContext,
  KafkaConsumerRunnerDiscardReason,
  KafkaConsumerRunnerErrorDecision,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import { StaleWhatsappRuntimeDatabaseFenceError } from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';

type ConsumerHarness = {
  execute(): Promise<void>;
  processValidationUpdate(
    data: IContactValidationUpdate,
    assertActive?: () => void
  ): Promise<void>;
  classifyConsumerError(error: unknown): KafkaConsumerRunnerErrorDecision;
  parkExhaustedEntitlementFailure(
    data: IContactValidationUpdate,
    context: KafkaConsumerRunnerContext<IContactValidationUpdate>,
    error: unknown,
    reason: KafkaConsumerRunnerDiscardReason
  ): Promise<void>;
};

describe('ContactValidationUpdateConsume outbound webhook context', () => {
  const accountId = '01900000-0000-7000-8000-000000000001';
  const contactId = '01900000-0000-7000-8000-000000000002';
  const scheduleRuntime = {
    account_id: accountId,
    worker_id: 'worker-1',
    source_provider: 'baileys',
    runtime_generation: 7,
    connection_epoch: 'connection-7',
  } as const;

  function makeConsumer() {
    const kafkaServiceQueueService = {
      contactValidationUpdate: jest.fn(() => 'contact.validation.update'),
    };
    const contactService = {
      getContactById: jest.fn(),
      updateContactIsValided: jest.fn(async () => true),
      updateContactValidation: jest.fn(async () => true),
    };
    const planEntitlementService = {
      assertEntitled: jest.fn(async () => ({
        revision: '7',
        source: 'plan',
      })),
    };
    const inboundMessageSpoolService = {
      parkConsumerMessage: jest.fn(async () => undefined),
    };
    const runtimeFence = {
      isCurrent: jest.fn(async () => true),
    };
    const consumer = new ContactValidationUpdateConsume(
      {} as never,
      kafkaServiceQueueService as never,
      contactService as never,
      planEntitlementService as never,
      inboundMessageSpoolService as never,
      runtimeFence as never
    );
    const harness = consumer as unknown as ConsumerHarness;
    const processValidationUpdate =
      harness.processValidationUpdate.bind(consumer);
    return {
      consumer: harness,
      kafkaServiceQueueService,
      contactService,
      planEntitlementService,
      inboundMessageSpoolService,
      runtimeFence,
      processValidationUpdate,
    };
  }

  beforeEach(() => {
    mockRunnerOptions.length = 0;
    jest.clearAllMocks();
  });

  it('uses one normalized contact mutation when the worker supplies a phone', async () => {
    const { contactService, processValidationUpdate } = makeConsumer();

    await processValidationUpdate({
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: false,
      operation_id: 'worker-operation-1',
      source: 'schedule',
      ...scheduleRuntime,
    });

    expect(contactService.updateContactIsValided).not.toHaveBeenCalled();
    expect(contactService.updateContactValidation).toHaveBeenCalledWith(
      contactId,
      '5511999991234',
      false,
      accountId,
      {
        source: 'schedule',
        idempotencyKey: 'contact-validation-consumer:worker-operation-1',
        actor: { type: 'system' },
        changes: { validation_origin: 'async_worker' },
        runtimeFence: {
          account_id: accountId,
          worker_id: 'worker-1',
          source_provider: 'baileys',
          runtime_generation: 7,
          connection_epoch: 'connection-7',
        },
      },
      null
    );
    expect(contactService.getContactById).not.toHaveBeenCalled();
  });

  it('updates only validation status when an invalid worker result has no phone', async () => {
    const { contactService, processValidationUpdate } = makeConsumer();

    await processValidationUpdate({
      contact_id: contactId,
      phone: '',
      is_validated: false,
      source: 'schedule',
      ...scheduleRuntime,
    });

    expect(contactService.updateContactValidation).not.toHaveBeenCalled();
    expect(contactService.updateContactIsValided).toHaveBeenCalledWith(
      contactId,
      false,
      accountId,
      expect.objectContaining({
        source: 'schedule',
        actor: { type: 'system' },
        runtimeFence: {
          account_id: accountId,
          worker_id: 'worker-1',
          source_provider: 'baileys',
          runtime_generation: 7,
          connection_epoch: 'connection-7',
        },
      })
    );
    expect(contactService.getContactById).not.toHaveBeenCalled();
  });

  it('propagates account context when a producer supplies it', async () => {
    const { contactService, processValidationUpdate } = makeConsumer();

    await processValidationUpdate({
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: true,
      source: 'schedule',
      ...scheduleRuntime,
    });

    expect(contactService.updateContactValidation).toHaveBeenCalledWith(
      contactId,
      '5511999991234',
      true,
      accountId,
      expect.any(Object),
      'whatsapp_lookup'
    );
  });

  it('terminally discards a schedule update from a stale connection epoch', async () => {
    const { consumer, contactService, runtimeFence, processValidationUpdate } =
      makeConsumer();
    runtimeFence.isCurrent.mockResolvedValue(false);
    const payload: IContactValidationUpdate = {
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: true,
      source: 'schedule',
      ...scheduleRuntime,
      connection_epoch: 'connection-stale',
    };

    let error: unknown;
    try {
      await processValidationUpdate(payload);
    } catch (cause) {
      error = cause;
    }

    expect(runtimeFence.isCurrent).toHaveBeenCalledWith(payload);
    expect(error).toMatchObject({
      name: 'ContactValidationRuntimeStaleError',
      reason: 'contact_validation_runtime_stale',
    });
    expect(consumer.classifyConsumerError(error)).toBe('terminal');
    expect(contactService.updateContactValidation).not.toHaveBeenCalled();
    expect(contactService.updateContactIsValided).not.toHaveBeenCalled();
  });

  it('rechecks the schedule runtime immediately before the contact mutation', async () => {
    const { contactService, runtimeFence, processValidationUpdate } =
      makeConsumer();
    runtimeFence.isCurrent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      processValidationUpdate({
        contact_id: contactId,
        phone: '5511999991234',
        is_validated: true,
        source: 'schedule',
        ...scheduleRuntime,
      })
    ).rejects.toMatchObject({
      name: 'ContactValidationRuntimeStaleError',
    });

    expect(runtimeFence.isCurrent).toHaveBeenCalledTimes(2);
    expect(contactService.updateContactValidation).not.toHaveBeenCalled();
  });

  it('terminally discards a mutation fenced by a newer database generation', async () => {
    const { consumer, contactService, processValidationUpdate } =
      makeConsumer();
    contactService.updateContactValidation.mockRejectedValueOnce(
      new StaleWhatsappRuntimeDatabaseFenceError()
    );

    let error: unknown;
    try {
      await processValidationUpdate({
        contact_id: contactId,
        phone: '5511999991234',
        is_validated: true,
        source: 'schedule',
        ...scheduleRuntime,
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);
    expect(consumer.classifyConsumerError(error)).toBe('terminal');
  });

  it('revalidates webhook integration revision immediately before the contact effect', async () => {
    const { contactService, planEntitlementService, processValidationUpdate } =
      makeConsumer();
    const payload: IContactValidationUpdate = {
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: true,
      integration_entitlement_revision: '7',
      source: 'webhook_integration',
      ...scheduleRuntime,
    };

    await processValidationUpdate(payload);

    expect(planEntitlementService.assertEntitled).toHaveBeenCalledWith(
      accountId,
      EPlanProduct.integration,
      { expectedRevision: '7' }
    );
    expect(contactService.updateContactValidation).toHaveBeenCalledTimes(1);
    expect(
      planEntitlementService.assertEntitled.mock.invocationCallOrder[0]
    ).toBeLessThan(
      contactService.updateContactValidation.mock.invocationCallOrder[0]
    );
  });

  it('terminally discards a webhook integration update from a replaced runtime', async () => {
    const { consumer, contactService, runtimeFence, processValidationUpdate } =
      makeConsumer();
    runtimeFence.isCurrent.mockResolvedValue(false);
    const payload: IContactValidationUpdate = {
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: true,
      integration_entitlement_revision: '7',
      source: 'webhook_integration',
      ...scheduleRuntime,
      connection_epoch: 'connection-stale',
    };

    let error: unknown;
    try {
      await processValidationUpdate(payload);
    } catch (cause) {
      error = cause;
    }

    expect(runtimeFence.isCurrent).toHaveBeenCalledWith(payload);
    expect(error).toMatchObject({
      name: 'ContactValidationRuntimeStaleError',
      reason: 'contact_validation_runtime_stale',
    });
    expect(consumer.classifyConsumerError(error)).toBe('terminal');
    expect(contactService.updateContactValidation).not.toHaveBeenCalled();
  });

  it('terminally discards a webhook integration update without a revision', async () => {
    const { consumer, contactService, processValidationUpdate } =
      makeConsumer();
    const payload: IContactValidationUpdate = {
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: true,
      account_id: accountId,
      source: 'webhook_integration',
    };

    let error: unknown;
    try {
      await processValidationUpdate(payload);
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      name: 'ContactValidationEntitlementMissingError',
      reason: 'integration_entitlement_missing',
    });
    expect(consumer.classifyConsumerError(error)).toBe('terminal');
    expect(contactService.updateContactValidation).not.toHaveBeenCalled();
    expect(contactService.updateContactIsValided).not.toHaveBeenCalled();
  });

  it('terminally discards ambiguous untagged legacy backlog', async () => {
    const { consumer, contactService, processValidationUpdate } =
      makeConsumer();
    const payload: IContactValidationUpdate = {
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: true,
      account_id: accountId,
    };

    let error: unknown;
    try {
      await processValidationUpdate(payload);
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      reason: 'integration_entitlement_missing',
    });
    expect(consumer.classifyConsumerError(error)).toBe('terminal');
    expect(contactService.updateContactValidation).not.toHaveBeenCalled();
  });

  it('terminally discards tagged legacy events without a runtime fence', async () => {
    const { consumer, contactService, processValidationUpdate } =
      makeConsumer();

    let error: unknown;
    try {
      await processValidationUpdate({
        contact_id: contactId,
        phone: '5511999991234',
        is_validated: true,
        account_id: accountId,
        source: 'legacy_worker',
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      name: 'ContactValidationRuntimeStaleError',
      reason: 'contact_validation_runtime_stale',
    });
    expect(consumer.classifyConsumerError(error)).toBe('terminal');
    expect(contactService.updateContactValidation).not.toHaveBeenCalled();
    expect(contactService.updateContactIsValided).not.toHaveBeenCalled();
  });

  it.each(['denied', 'mismatch'] as const)(
    'terminally discards a webhook integration update when entitlement is %s',
    async (failure) => {
      const {
        consumer,
        contactService,
        planEntitlementService,
        processValidationUpdate,
      } = makeConsumer();
      const entitlement = {
        accountId,
        planProductId: EPlanProduct.integration,
        allowed: failure === 'mismatch',
        revision: '8',
      };
      planEntitlementService.assertEntitled.mockRejectedValue(
        failure === 'denied'
          ? new PlanEntitlementDeniedError(entitlement)
          : new PlanEntitlementRevisionMismatchError(entitlement, '7')
      );

      let error: unknown;
      try {
        await processValidationUpdate({
          contact_id: contactId,
          phone: '5511999991234',
          is_validated: true,
          account_id: accountId,
          integration_entitlement_revision: '7',
          source: 'webhook_integration',
        });
      } catch (cause) {
        error = cause;
      }

      expect(error).toMatchObject({
        reason: 'integration_entitlement_missing',
      });
      expect(consumer.classifyConsumerError(error)).toBe('terminal');
      expect(contactService.updateContactValidation).not.toHaveBeenCalled();
    }
  );

  it('retries technical entitlement failures and parks them durably after exhaustion', async () => {
    const {
      consumer,
      contactService,
      planEntitlementService,
      inboundMessageSpoolService,
      processValidationUpdate,
    } = makeConsumer();
    const payload: IContactValidationUpdate = {
      contact_id: contactId,
      phone: '5511999991234',
      is_validated: true,
      account_id: accountId,
      integration_entitlement_revision: '7',
      source: 'webhook_integration',
    };
    planEntitlementService.assertEntitled.mockRejectedValue(
      new Error('primary database unavailable')
    );

    let error: unknown;
    try {
      await processValidationUpdate(payload);
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      name: 'ContactValidationEntitlementUnavailableError',
      reason: 'plan_entitlement_unavailable',
    });
    expect(consumer.classifyConsumerError(error)).toBe('retryable');
    expect(contactService.updateContactValidation).not.toHaveBeenCalled();

    const context: KafkaConsumerRunnerContext<IContactValidationUpdate> = {
      topic: 'contact.validation.update',
      groupId: 'group-underchat-contact-validation-update',
      message: {
        value: Buffer.from(JSON.stringify(payload)),
        key: Buffer.from(contactId),
        partition: 1,
        offset: 12,
      },
      partition: 1,
      offset: 12,
      kafkaKey: contactId,
      entityKey: contactId,
      attempt: 3,
      payload,
      isActive: () => true,
      assertActive: () => undefined,
    };

    await consumer.parkExhaustedEntitlementFailure(
      payload,
      context,
      error,
      'retry_exhausted'
    );

    expect(inboundMessageSpoolService.parkConsumerMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'message_upsert_consumer',
        account_id: accountId,
        worker_id: 'contact-validation',
        event_source: 'webhook_integration',
        reason: 'plan_entitlement_unavailable',
        stage: 'contact_validation.entitlement',
        retry_count: 3,
        raw_meta: {
          source: 'webhook_integration',
          integration_entitlement_revision: '7',
        },
      })
    );
  });

  it('wires bounded retry and durable discarded handling into the Kafka runner', async () => {
    const { consumer } = makeConsumer();

    await consumer.execute();

    expect(mockRunnerOptions).toHaveLength(1);
    expect(mockRunnerOptions[0]).toMatchObject({
      maxRetries: 3,
      retryDelaysMs: [250, 1_000],
      failOnDiscardedHookError: true,
    });
    expect(mockRunnerOptions[0]).toEqual(
      expect.objectContaining({
        classifyError: expect.any(Function),
        onDiscarded: expect.any(Function),
      })
    );
  });
});
