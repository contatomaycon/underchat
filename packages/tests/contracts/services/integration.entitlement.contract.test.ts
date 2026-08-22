import 'reflect-metadata';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementDeniedError } from '@core/common/exceptions/PlanEntitlementError';
import { IntegrationService } from '@core/services/integration.service';

const accountId = '01900000-0000-7000-8000-000000000101';
const workerId = '01900000-0000-7000-8000-000000000102';
const revision = '7';
const operationId = 'request-operation-1';

const createService = (assertEntitled: jest.Mock) => {
  const service = Reflect.construct(
    IntegrationService,
    Array.from({ length: 48 }, () => ({}))
  ) as IntegrationService;
  const saveWebhookData = jest.fn(async () => true);
  const getWebhookMapping = jest.fn(async () => ({
    account_id: accountId,
    worker_id: workerId,
    mapping: { phone: 'phone' },
  }));
  const getOrCreateContact = jest.fn(async () => ({
    contactId: '01900000-0000-7000-8000-000000000103',
    phone: '5511999999999',
    phoneDdi: '55',
  }));
  const sendToWebhookIntegrationConsumer = jest.fn(async () => undefined);

  Object.assign(service, {
    planEntitlementService: { assertEntitled },
    saveWebhookData,
    getWebhookMapping,
    mapWebhookData: jest.fn(() => ({ phone: '11999999999' })),
    extractPhoneAndDdiFromMappedData: jest.fn(() => ({
      phone: '11999999999',
      phone_ddi: '55',
    })),
    getOrCreateContact,
    resolveInteractionPhoneAndDdi: jest.fn(() => ({
      phone: '11999999999',
      phone_ddi: '55',
    })),
    sendToWebhookIntegrationConsumer,
  });

  return {
    service,
    saveWebhookData,
    getOrCreateContact,
    sendToWebhookIntegrationConsumer,
  };
};

describe('IntegrationService inbound entitlement boundaries', () => {
  it('revalidates the same revision before payload, contact and Kafka effects', async () => {
    const assertEntitled = jest.fn(async () => ({ revision }));
    const {
      service,
      saveWebhookData,
      getOrCreateContact,
      sendToWebhookIntegrationConsumer,
    } = createService(assertEntitled);

    await expect(
      service.processWebhook(
        ((key: string) => key) as never,
        accountId,
        workerId,
        { phone: '11999999999' },
        revision,
        operationId
      )
    ).resolves.toBe(true);

    expect(assertEntitled).toHaveBeenCalledTimes(3);
    expect(assertEntitled.mock.calls).toEqual(
      Array.from({ length: 3 }, () => [
        accountId,
        EPlanProduct.integration,
        { expectedRevision: revision },
      ])
    );
    expect(assertEntitled.mock.invocationCallOrder[0]).toBeLessThan(
      saveWebhookData.mock.invocationCallOrder[0]
    );
    expect(assertEntitled.mock.invocationCallOrder[1]).toBeLessThan(
      getOrCreateContact.mock.invocationCallOrder[0]
    );
    expect(assertEntitled.mock.invocationCallOrder[2]).toBeLessThan(
      sendToWebhookIntegrationConsumer.mock.invocationCallOrder[0]
    );
    expect(sendToWebhookIntegrationConsumer).toHaveBeenCalledWith(
      accountId,
      workerId,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      revision,
      operationId
    );
  });

  it('does not create a contact when access is revoked after payload capture', async () => {
    const denied = new PlanEntitlementDeniedError({
      accountId,
      planProductId: EPlanProduct.integration,
      allowed: false,
      revision: '8',
    });
    const assertEntitled = jest
      .fn()
      .mockResolvedValueOnce({ revision })
      .mockRejectedValueOnce(denied);
    const { service, getOrCreateContact, sendToWebhookIntegrationConsumer } =
      createService(assertEntitled);

    await expect(
      service.processWebhook(
        ((key: string) => key) as never,
        accountId,
        workerId,
        { phone: '11999999999' },
        revision,
        operationId
      )
    ).rejects.toBe(denied);

    expect(getOrCreateContact).not.toHaveBeenCalled();
    expect(sendToWebhookIntegrationConsumer).not.toHaveBeenCalled();
  });

  it('publishes the accepted operation id with a stable contact key', async () => {
    const service = Reflect.construct(
      IntegrationService,
      Array.from({ length: 48 }, () => ({}))
    ) as IntegrationService;
    const admit = jest.fn(async () => ({
      envelope: {},
      receipt: {},
    }));
    Object.assign(service, {
      workerCommandAdmissionService: { admit },
    });

    await (
      service as unknown as {
        sendToWebhookIntegrationConsumer(
          accountId: string,
          workerId: string,
          contact: { contactId: string; is_valided: boolean },
          mappedData: Record<string, unknown>,
          mapping: Record<string, string | string[]>,
          body: Record<string, unknown>,
          phoneAndDdi: { phone: string; phone_ddi: string | null },
          revision: string,
          operationId: string
        ): Promise<void>;
      }
    ).sendToWebhookIntegrationConsumer(
      accountId,
      workerId,
      {
        contactId: '01900000-0000-7000-8000-000000000103',
        is_valided: false,
      },
      { message: 'hello', message_type: 'message' },
      {},
      { payload: true },
      { phone: '11999999999', phone_ddi: '55' },
      revision,
      operationId
    );

    expect(admit).toHaveBeenCalledWith({
      accountId,
      workerId,
      commandType: 'webhook_integration',
      entityKey:
        'webhook-integration:01900000-0000-7000-8000-000000000101:01900000-0000-7000-8000-000000000102:01900000-0000-7000-8000-000000000103',
      operationId,
      payload: expect.objectContaining({
        operation_id: operationId,
        account_id: accountId,
        worker_id: workerId,
      }),
      source: 'webhook_integration',
    });
  });
});
