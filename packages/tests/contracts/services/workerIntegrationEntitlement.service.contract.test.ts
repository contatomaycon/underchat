import 'reflect-metadata';

import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import { WorkerIntegrationEntitlementService } from '@core/services/workerIntegrationEntitlement.service';

const accountId = '01900000-0000-7000-8000-000000000001';
const validUntil = '2099-01-01T00:00:00.000Z';

const serializeEntitlement = (
  overrides: Record<string, unknown> = {}
): string =>
  JSON.stringify({
    account_id: accountId,
    plan_product_id: EPlanProduct.integration,
    allowed: true,
    revision: '7',
    valid_until: validUntil,
    plan_is_active: true,
    source: 'plan',
    ...overrides,
  });

const createService = (mget: jest.Mock): WorkerIntegrationEntitlementService =>
  new WorkerIntegrationEntitlementService({ mget } as never);

describe('WorkerIntegrationEntitlementService', () => {
  it('admits a current entitlement from the published Redis epoch', async () => {
    const service = createService(
      jest.fn(async () => [null, serializeEntitlement()])
    );

    await expect(
      service.assertEntitled(accountId, EPlanProduct.integration, {
        expectedRevision: '7',
      })
    ).resolves.toMatchObject({
      accountId,
      revision: '7',
      source: 'plan',
    });
  });

  it('fails closed when a deny fence is present', async () => {
    const service = createService(
      jest.fn(async () => [
        serializeEntitlement({
          allowed: false,
          valid_until: null,
          plan_is_active: false,
          source: null,
        }),
        serializeEntitlement(),
      ])
    );

    await expect(
      service.assertEntitled(accountId, EPlanProduct.integration, {
        expectedRevision: '7',
      })
    ).rejects.toBeInstanceOf(PlanEntitlementDeniedError);
  });

  it('rejects a stale event revision without consulting PostgreSQL', async () => {
    const service = createService(
      jest.fn(async () => [null, serializeEntitlement({ revision: '8' })])
    );

    await expect(
      service.assertEntitled(accountId, EPlanProduct.integration, {
        expectedRevision: '7',
      })
    ).rejects.toBeInstanceOf(PlanEntitlementRevisionMismatchError);
  });

  it('treats an unavailable epoch as a retryable resolution failure', async () => {
    const service = createService(jest.fn(async () => [null, null]));

    await expect(
      service.assertEntitled(accountId, EPlanProduct.integration, {
        expectedRevision: '7',
      })
    ).rejects.toBeInstanceOf(PlanEntitlementUnavailableError);
  });
});
