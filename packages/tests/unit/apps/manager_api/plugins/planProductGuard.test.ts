import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { container } from 'tsyringe';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
}));

jest.mock('@core/services/planEntitlement.service', () => ({
  PlanEntitlementService: class PlanEntitlementService {},
}));

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

const { planProductGuard } = jest.requireActual<{
  planProductGuard: (
    product: EPlanProduct
  ) => (request: never, reply: never) => Promise<void>;
}>('../../../../../../apps/manager_api/src/plugins/planProductGuard');

function buildReply() {
  return {
    request: { id: 'request-1' },
    code: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe('planProductGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows the request when the account has the required product', async () => {
    jest.mocked(container.resolve).mockReturnValue({
      listActivePlanProductIds: jest.fn(async () => [
        EPlanProduct.internal_chat,
      ]),
    } as never);
    const guard = planProductGuard(EPlanProduct.internal_chat);
    const reply = buildReply();

    await guard(
      {
        tokenJwtData: { account_id: 'account-1' },
        t: (key: string) => key,
      } as never,
      reply as never
    );

    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('keeps non-Integration products on the uncached active-product lookup', async () => {
    const listActivePlanProductIds = jest.fn(async (_accountId: string) => []);
    jest.mocked(container.resolve).mockReturnValue({
      listActivePlanProductIds,
    } as never);
    const guard = planProductGuard(EPlanProduct.internal_chat);
    const reply = buildReply();

    await guard(
      {
        tokenJwtData: { account_id: 'account-1' },
        t: (key: string) => key,
      } as never,
      reply as never
    );

    expect(listActivePlanProductIds).toHaveBeenCalledWith('account-1');
    expect(reply.code).toHaveBeenCalledWith(402);
  });

  it('returns a structured 402 when Integration is not entitled', async () => {
    jest.mocked(container.resolve).mockReturnValue({
      assertEntitled: jest.fn(async () => {
        throw new PlanEntitlementDeniedError({
          accountId: 'account-1',
          planProductId: EPlanProduct.integration,
          allowed: false,
          revision: '2',
        });
      }),
    } as never);
    const guard = planProductGuard(EPlanProduct.integration);
    const reply = buildReply();

    await guard(
      {
        tokenJwtData: { account_id: 'account-1' },
        t: (key: string) => key,
        log: { error: jest.fn() },
      } as never,
      reply as never
    );

    expect(reply.code).toHaveBeenCalledWith(402);
    expect(reply.send).toHaveBeenCalledWith({
      id: 'request-1',
      status: false,
      message: 'integration_not_available',
      data: {
        reason: 'integration_plan_required',
        plan_product_id: EPlanProduct.integration,
      },
    });
  });

  it('fails closed with a structured 503 when entitlement cannot be resolved', async () => {
    jest.mocked(container.resolve).mockReturnValue({
      assertEntitled: jest.fn(async () => {
        throw new PlanEntitlementUnavailableError();
      }),
    } as never);
    const guard = planProductGuard(EPlanProduct.integration);
    const reply = buildReply();

    await guard(
      {
        tokenJwtData: { account_id: 'account-1' },
        t: (key: string) => key,
        log: { error: jest.fn() },
      } as never,
      reply as never
    );

    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({
      id: 'request-1',
      status: false,
      message: 'plan_entitlement_unavailable',
      data: {
        reason: 'plan_entitlement_unavailable',
        plan_product_id: EPlanProduct.integration,
      },
    });
  });
});
