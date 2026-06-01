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
    const paymentService = {};
    const planService = {
      getPlan: jest.fn(async () => ({
        is_test: true,
        days_trial: 7,
      })),
      ...((overrides.planService as object) ?? {}),
    };
    const planReleaseService = {};
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
    const creditCardFeeService = {};
    const methodPaymentService = {};

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
      accountTestService,
      userMasterViewerRepository,
      userService,
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
});
