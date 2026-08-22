import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import {
  CreditCardAlreadyTokenizedError,
  CreditCardSourceSelectionError,
} from '@core/common/exceptions/UserCardError';
import { handleControllerError } from '@core/common/functions/handleControllerError';

describe('handleControllerError plan entitlement contract', () => {
  it('localizes lifecycle journal failures without exposing integrity details', () => {
    const send = jest.fn();
    const code = jest.fn();
    const reply = {
      request: { id: 'request-lifecycle-journal' },
      code: jest.fn((status: number) => {
        code(status);
        return { send };
      }),
    };

    handleControllerError(
      new Error(
        'worker_lifecycle_journal_invalid:fingerprint_integrity_mismatch'
      ),
      reply as never,
      ((key: string) => key) as never
    );

    expect(code).toHaveBeenCalledWith(409);
    expect(send).toHaveBeenCalledWith({
      id: 'request-lifecycle-journal',
      status: false,
      message: 'worker_lifecycle_journal_invalid',
      data: null,
    });
  });

  it('maps a guard-to-preflight downgrade race to a structured 402', () => {
    const send = jest.fn();
    const code = jest.fn();
    const reply = {
      request: { id: 'request-race' },
      code: jest.fn((status: number) => {
        code(status);
        return { send };
      }),
    };

    handleControllerError(
      new PlanEntitlementDeniedError({
        accountId: 'account-1',
        planProductId: EPlanProduct.integration,
        allowed: false,
        revision: '4',
      }),
      reply as never,
      ((key: string) => key) as never
    );

    expect(code).toHaveBeenCalledWith(402);
    expect(send).toHaveBeenCalledWith({
      id: 'request-race',
      status: false,
      message: 'integration_not_available',
      data: {
        reason: 'integration_plan_required',
        plan_product_id: EPlanProduct.integration,
      },
    });
  });

  it('returns a structured 503 for an unconfirmed revocation fence', () => {
    const send = jest.fn();
    const code = jest.fn();
    const reply: {
      request: { id: string };
      code: jest.Mock;
    } = {
      request: { id: 'request-1' },
      code: jest.fn(),
    };
    reply.code.mockImplementation((status: number) => {
      code(status);
      return { send };
    });

    handleControllerError(
      new PlanEntitlementUnavailableError('fence unavailable'),
      reply as never,
      ((key: string) => key) as never
    );

    expect(code).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith({
      id: 'request-1',
      status: false,
      message: 'plan_entitlement_unavailable',
      data: {
        reason: 'plan_entitlement_unavailable',
        plan_product_id: EPlanProduct.integration,
      },
    });
  });

  it('maps a deferred writer-fence SQLSTATE wrapped by Drizzle to 503', () => {
    const send = jest.fn();
    const code = jest.fn();
    const reply = {
      request: { id: 'request-2' },
      code: jest.fn((status: number) => {
        code(status);
        return { send };
      }),
    };
    const postgresError = Object.assign(
      new Error('plan_entitlement_deny_fence_required'),
      { code: 'UC001' }
    );
    const drizzleWrapper = Object.assign(new Error('Failed query'), {
      cause: postgresError,
    });

    handleControllerError(
      drizzleWrapper,
      reply as never,
      ((key: string) => key) as never
    );

    expect(code).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith({
      id: 'request-2',
      status: false,
      message: 'plan_entitlement_unavailable',
      data: {
        reason: 'plan_entitlement_unavailable',
        plan_product_id: EPlanProduct.integration,
      },
    });
  });

  it('maps an already tokenized card to a localized 409 without gateway detail', () => {
    const send = jest.fn();
    const code = jest.fn();
    const reply = {
      request: { id: 'request-card-conflict' },
      code: jest.fn((status: number) => {
        code(status);
        return { send };
      }),
    };

    handleControllerError(
      new CreditCardAlreadyTokenizedError(),
      reply as never,
      ((key: string) => key) as never
    );

    expect(code).toHaveBeenCalledWith(409);
    expect(send).toHaveBeenCalledWith({
      id: 'request-card-conflict',
      status: false,
      message: 'card_already_tokenized',
      data: null,
    });
  });

  it('maps an invalid card source selection to a localized 400', () => {
    const send = jest.fn();
    const code = jest.fn();
    const reply = {
      request: { id: 'request-card-source' },
      code: jest.fn((status: number) => {
        code(status);
        return { send };
      }),
    };

    handleControllerError(
      new CreditCardSourceSelectionError(),
      reply as never,
      ((key: string) => key) as never
    );

    expect(code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      id: 'request-card-source',
      status: false,
      message: 'credit_card_requires_exactly_one_source',
      data: null,
    });
  });
});
