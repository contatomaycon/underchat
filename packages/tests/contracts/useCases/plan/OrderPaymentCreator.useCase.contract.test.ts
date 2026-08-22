import 'reflect-metadata';

jest.mock('@core/services/payment.service', () => ({
  PaymentService: class {},
}));
jest.mock('@core/services/plan.service', () => ({
  PlanService: class {},
}));
jest.mock('@core/services/planRelease.service', () => ({
  PlanReleaseService: class {},
}));
jest.mock('@core/services/accountTest.service', () => ({
  AccountTestService: class {},
}));
jest.mock('@core/repositories/user/UserMasterViewer.repository', () => ({
  UserMasterViewerRepository: class {},
}));
jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
jest.mock('@core/services/creditCardFee.service', () => ({
  CreditCardFeeService: class {},
}));
jest.mock('@core/services/methodPayment.service', () => ({
  MethodPaymentService: class {},
}));
jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(() => 'order-id-1'),
}));

import { OrderPaymentCreatorUseCase } from '@core/useCases/plan/OrderPaymentCreator.useCase';
import { CreditCardSourceSelectionError } from '@core/common/exceptions/UserCardError';

describe('OrderPaymentCreatorUseCase', () => {
  const t = jest.fn((key: string) => key);

  const buildInput = () => ({
    plan_id: 'plan-test',
    billing_period: 'monthly',
    addons: [],
    payment_method: 'pix',
  });

  const userContext = {
    document: '12345678900',
    phone: '6195999040',
    email: 'user@example.com',
  };

  const buildDeps = (overrides: Record<string, unknown> = {}) => {
    const paymentService = {
      ...((overrides.paymentService as object) ?? {}),
    };
    const planService = {
      getPlan: jest.fn(async () => ({
        is_test: true,
        days_trial: 7,
      })),
      ...((overrides.planService as object) ?? {}),
    };
    const planReleaseService = {
      ...((overrides.planReleaseService as object) ?? {}),
    };
    const accountTestService = {
      checkExistingCreatedTest: jest.fn(async () => false),
      createTestPlan: jest.fn(async () => undefined),
      ...((overrides.accountTestService as object) ?? {}),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(),
    };
    const userService = {
      getUserSensitiveDataDecrypted: jest.fn(),
    };
    const creditCardFeeService = {
      ...((overrides.creditCardFeeService as object) ?? {}),
    };
    const methodPaymentService = {
      ...((overrides.methodPaymentService as object) ?? {}),
    };

    const useCase = new OrderPaymentCreatorUseCase(
      paymentService as never,
      planService as never,
      planReleaseService as never,
      accountTestService as never,
      userMasterViewerRepository as never,
      userService as never,
      creditCardFeeService as never,
      methodPaymentService as never
    );

    return {
      useCase,
      planService,
      paymentService,
      planReleaseService,
      accountTestService,
      userMasterViewerRepository,
      userService,
      methodPaymentService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates account_test.created only when finalizing a test plan', async () => {
    const { useCase, accountTestService } = buildDeps();

    await expect(
      useCase.execute(
        t as never,
        'account-1',
        buildInput() as never,
        '127.0.0.1',
        userContext
      )
    ).resolves.toEqual({
      order_id: 'order-id-1',
      order_type: 'plan',
      total_amount: 0,
      plan_price: 0,
      addons_total: 0,
      upgrade_discount: 0,
      payment_method: 'pix',
      pix_payment: undefined,
      credit_card_payment: undefined,
      boleto_payment: undefined,
    });

    expect(accountTestService.checkExistingCreatedTest).toHaveBeenCalledWith(
      userContext
    );
    expect(accountTestService.createTestPlan).toHaveBeenCalledWith({
      accountId: 'account-1',
      planId: 'plan-test',
      daysTrial: 7,
      ...userContext,
    });
  });

  it('blocks test plan finalization when account_test.created already exists', async () => {
    const { useCase, accountTestService } = buildDeps({
      accountTestService: {
        checkExistingCreatedTest: jest.fn(async () => true),
        createTestPlan: jest.fn(async () => undefined),
      },
    });

    await expect(
      useCase.execute(
        t as never,
        'account-1',
        buildInput() as never,
        '127.0.0.1',
        userContext
      )
    ).rejects.toThrow('test_plan_already_used');

    expect(accountTestService.checkExistingCreatedTest).toHaveBeenCalledWith(
      userContext
    );
    expect(accountTestService.createTestPlan).not.toHaveBeenCalled();
  });

  it('persists the payment and selected add-ons atomically before returning PIX data', async () => {
    const createAccountPaymentWithCrossSells = jest.fn(async () => 'ap-1');
    const { useCase } = buildDeps({
      paymentService: {
        getOrCreateCustomer: jest.fn(async () => ({
          user_customer_id: 'customer-row-1',
          user_customer: 'asaas-customer-1',
        })),
        createPixPayment: jest.fn(async () => ({
          payment: {
            id: 'pay-1',
            netValue: 100,
            pixTransaction: null,
            invoiceUrl: 'https://invoice.test/pay-1',
          },
          qrCode: {
            encodedImage: 'encoded',
            payload: 'payload',
            expirationDate: '2026-07-12T00:00:00.000Z',
          },
        })),
      },
      planService: {
        getPlan: jest.fn(async () => ({
          is_test: false,
          days_trial: 0,
        })),
        calculateOrderPayment: jest.fn(async () => ({
          planPrice: 100,
          addonsTotal: 0,
          discountAmount: 0,
          totalAmount: 100,
        })),
        getCurrentActivePlanAccount: jest.fn(async () => null),
        getBillingPeriodId: jest.fn(() => 'monthly-id'),
        createAccountPaymentWithCrossSells,
      },
      methodPaymentService: {
        viewMethodPaymentByType: jest.fn(async () => ({ status: true })),
      },
    });

    await expect(
      useCase.execute(
        t as never,
        'account-1',
        {
          plan_id: 'plan-1',
          billing_period: 'monthly',
          addons: [],
          payment_method: 'pix',
        } as never,
        '127.0.0.1'
      )
    ).resolves.toEqual(
      expect.objectContaining({
        order_type: 'plan',
        pix_payment: expect.objectContaining({ payment_id: 'pay-1' }),
      })
    );

    expect(createAccountPaymentWithCrossSells).toHaveBeenCalledWith({
      payment: expect.objectContaining({
        accountId: 'account-1',
        billing: 'pay-1',
        isAddonOnly: false,
      }),
      addons: [],
      billingPeriod: 'monthly',
    });
  });

  it.each([
    [
      'both a saved card and new card',
      {
        credit_card_id: 'card-1',
        new_card: {
          number: '4111111111111111',
          holder_name: 'John Doe',
          expiry_month: '12',
          expiry_year: '2030',
          cvv: '123',
        },
      },
    ],
    ['neither a saved card nor a new card', {}],
  ])(
    'rejects credit-card orders with %s before creating a card payment',
    async (_description, cardSource) => {
      const getOrCreateCustomer = jest.fn(async () => ({
        user_customer_id: 'customer-row-1',
        user_customer: 'asaas-customer-1',
      }));
      const createCreditCardPayment = jest.fn();
      const createAccountPaymentWithCrossSells = jest.fn();
      const { useCase } = buildDeps({
        paymentService: {
          getOrCreateCustomer,
          createCreditCardPayment,
        },
        planService: {
          getPlan: jest.fn(async () => ({
            is_test: false,
            days_trial: 0,
          })),
          calculateOrderPayment: jest.fn(async () => ({
            planPrice: 100,
            addonsTotal: 0,
            discountAmount: 0,
            totalAmount: 100,
          })),
          getCurrentActivePlanAccount: jest.fn(async () => null),
          createAccountPaymentWithCrossSells,
        },
        creditCardFeeService: {
          viewCreditCardFee: jest.fn(async () => ({
            installment_3_rate: 0,
          })),
        },
        methodPaymentService: {
          viewMethodPaymentByType: jest.fn(async () => ({ status: true })),
        },
      });

      await expect(
        useCase.execute(
          t as never,
          'account-1',
          {
            plan_id: 'plan-1',
            billing_period: 'monthly',
            addons: [],
            payment_method: 'credit_card',
            ...cardSource,
          } as never,
          '127.0.0.1'
        )
      ).rejects.toBeInstanceOf(CreditCardSourceSelectionError);

      expect(getOrCreateCustomer).not.toHaveBeenCalled();
      expect(createCreditCardPayment).not.toHaveBeenCalled();
      expect(createAccountPaymentWithCrossSells).not.toHaveBeenCalled();
    }
  );
});
