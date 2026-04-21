import 'reflect-metadata';

jest.mock('@core/repositories/plan/PlanLister.repository', () => ({
  PlanListerRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanAllLister.repository', () => ({
  PlanAllListerRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanCreator.repository', () => ({
  PlanCreatorRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanUpdater.repository', () => ({
  PlanUpdaterRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanDeleterTransaction.repository', () => ({
  PlanDeleterTransactionRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanItemCreator.repository', () => ({
  PlanItemCreatorRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanItemDeleter.repository', () => ({
  PlanItemDeleterRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanItemsLister.repository', () => ({
  PlanItemsListerRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanProductAllLister.repository', () => ({
  PlanProductAllListerRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanSalesLister.repository', () => ({
  PlanSalesListerRepository: class {},
}));
jest.mock('@core/repositories/plan/PlanWithItemsLister.repository', () => ({
  PlanWithItemsListerRepository: class {},
}));
jest.mock(
  '@core/repositories/plan/PlanProductWithPriceLister.repository',
  () => ({
    PlanProductWithPriceListerRepository: class {},
  })
);
jest.mock('@core/repositories/plan/UserCardsLister.repository', () => ({
  UserCardsListerRepository: class {},
}));
jest.mock('@core/repositories/plan/UserInfoViewer.repository', () => ({
  UserInfoViewerRepository: class {},
}));
jest.mock(
  '@core/repositories/plan/UpgradeDiscountCalculator.repository',
  () => ({
    UpgradeDiscountCalculatorRepository: class {},
  })
);
jest.mock('@core/services/payment.service', () => ({
  PaymentService: class {},
}));
jest.mock(
  '@core/repositories/planCrossSell/CrossSellLister.repository',
  () => ({
    CrossSellListerRepository: class {},
  })
);
jest.mock('@core/repositories/plan/OrderPaymentCreator.repository', () => ({
  OrderPaymentCreatorRepository: class {},
}));

import { PlanService } from '@core/services/plan.service';

describe('PlanService', () => {
  const makeService = () => {
    const planListerRepository = {
      listPlans: jest.fn(async () => [{ plan_id: 'p1' }]),
      listPlansTotal: jest.fn(async () => 1),
    };
    const planAllListerRepository = {
      listPlanAll: jest.fn(async () => [{ plan_id: 'p1' }]),
    };
    const planCreatorRepository = {
      createPlan: jest.fn(async () => 'p1'),
    };
    const planUpdaterRepository = {
      updatePlan: jest.fn(async () => true),
    };
    const planDeleterTransactionRepository = {
      deletePlan: jest.fn(async () => true),
    };
    const planItemCreatorRepository = {
      createPlanItem: jest.fn(async () => 'pi1'),
    };
    const planItemDeleterRepository = {
      deletePlanItemById: jest.fn(async () => true),
    };
    const planItemsListerRepository = {
      listPlanItems: jest.fn(async () => [{ plan_item_id: 'pi1' }]),
    };
    const planProductAllListerRepository = {
      listPlanProductAll: jest.fn(async () => [{ plan_product_id: 'pp1' }]),
    };
    const planSalesListerRepository = {
      listPlanSales: jest.fn(async () => [{ sale_id: 's1' }]),
    };
    const planWithItemsListerRepository = {
      listPlanWithItems: jest.fn(async () => [{ plan_id: 'p1', items: [] }]),
    };
    const planProductWithPriceListerRepository = {
      listPlanProductWithPrice: jest.fn(async () => [{ id: 'pwp1' }]),
    };
    const userCardsListerRepository = {
      listUserCards: jest.fn(async () => [{ user_card_id: 'uc1' }]),
    };
    const userInfoViewerRepository = {
      viewUserInfo: jest.fn(async () => ({ user_id: 'u1' })),
    };
    const upgradeDiscountCalculatorRepository = {
      calculateUpgradeDiscount: jest.fn(async () => ({ discount: 10 })),
    };
    const paymentService = {
      getOrCreateCustomer: jest.fn(async () => ({ customer_id: 'cust-1' })),
    };
    const crossSellListerRepository = {
      listAvailableCrossSells: jest.fn(async () => [
        { plan_cross_sell_id: 'cs1' },
      ]),
    };
    const orderPaymentCreatorRepository = {
      calculateOrderPayment: jest.fn(async () => ({
        planPrice: 100,
        addonsTotal: 10,
        discountAmount: 5,
        totalAmount: 105,
      })),
      getBillingPeriodId: jest.fn(
        (billingPeriod: string) => `bp:${billingPeriod}`
      ),
      createAccountPayment: jest.fn(async () => 'ap-1'),
      createAccountPaymentCrossSells: jest.fn(async () => undefined),
      getPlan: jest.fn<Promise<any>, any[]>(async () => ({
        plan_id: 'p1',
        price: '100',
        annual_discount: null,
        is_test: false,
        days_trial: null,
      })),
      getCurrentActivePlanAccount: jest.fn(async () => ({
        plan_account_id: 'pa1',
      })),
    };

    const service = new PlanService(
      planListerRepository as never,
      planAllListerRepository as never,
      planCreatorRepository as never,
      planUpdaterRepository as never,
      planDeleterTransactionRepository as never,
      planItemCreatorRepository as never,
      planItemDeleterRepository as never,
      planItemsListerRepository as never,
      planProductAllListerRepository as never,
      planSalesListerRepository as never,
      planWithItemsListerRepository as never,
      planProductWithPriceListerRepository as never,
      userCardsListerRepository as never,
      userInfoViewerRepository as never,
      upgradeDiscountCalculatorRepository as never,
      paymentService as never,
      crossSellListerRepository as never,
      orderPaymentCreatorRepository as never
    );

    return {
      service,
      planListerRepository,
      planAllListerRepository,
      planCreatorRepository,
      planUpdaterRepository,
      planDeleterTransactionRepository,
      planItemCreatorRepository,
      planItemDeleterRepository,
      planItemsListerRepository,
      planProductAllListerRepository,
      planSalesListerRepository,
      planWithItemsListerRepository,
      planProductWithPriceListerRepository,
      userCardsListerRepository,
      userInfoViewerRepository,
      upgradeDiscountCalculatorRepository,
      paymentService,
      crossSellListerRepository,
      orderPaymentCreatorRepository,
    };
  };

  it('delegates list and CRUD methods for plans and plan items', async () => {
    const {
      service,
      planListerRepository,
      planAllListerRepository,
      planCreatorRepository,
      planUpdaterRepository,
      planDeleterTransactionRepository,
      planItemCreatorRepository,
      planItemDeleterRepository,
      planItemsListerRepository,
      planProductAllListerRepository,
      planSalesListerRepository,
      planWithItemsListerRepository,
      planProductWithPriceListerRepository,
      userCardsListerRepository,
      userInfoViewerRepository,
      upgradeDiscountCalculatorRepository,
      paymentService,
      crossSellListerRepository,
    } = makeService();

    await expect(
      service.listPlans(10, 1, { search: 'x' } as never)
    ).resolves.toEqual([[{ plan_id: 'p1' }], 1]);
    expect(planListerRepository.listPlans).toHaveBeenCalledWith(10, 1, {
      search: 'x',
    });
    expect(planListerRepository.listPlansTotal).toHaveBeenCalledWith({
      search: 'x',
    });

    await expect(service.listPlanAll()).resolves.toEqual([{ plan_id: 'p1' }]);
    await expect(service.createPlan({ name: 'Plan' } as never)).resolves.toBe(
      'p1'
    );
    await expect(
      service.updatePlan('p1', { name: 'Updated' } as never)
    ).resolves.toBe(true);
    await expect(service.deletePlan('tx', 'p1')).resolves.toBe(true);

    await expect(
      service.createPlanItem({ plan_id: 'p1' } as never)
    ).resolves.toBe('pi1');
    await expect(service.deletePlanItem('pi1')).resolves.toBe(true);
    await expect(service.listPlanItems('p1')).resolves.toEqual([
      { plan_item_id: 'pi1' },
    ]);

    await expect(service.listPlanProductAll()).resolves.toEqual([
      { plan_product_id: 'pp1' },
    ]);
    await expect(service.listPlanProductWithPrice()).resolves.toEqual([
      { id: 'pwp1' },
    ]);
    await expect(
      service.listPlanSales({ search: 'x' } as never)
    ).resolves.toEqual([{ sale_id: 's1' }]);
    await expect(service.listPlanWithItems(null)).resolves.toEqual([
      { plan_id: 'p1', items: [] },
    ]);

    await expect(service.listUserCards('u1')).resolves.toEqual([
      { user_card_id: 'uc1' },
    ]);
    await expect(service.viewUserInfo('u1')).resolves.toEqual({
      user_id: 'u1',
    });
    await expect(
      service.calculateUpgradeDiscount('acc-1', 'plan-new', 'annual')
    ).resolves.toEqual({ discount: 10 });
    await expect(
      service.getOrCreateCustomer(((k: string) => k) as never, 'acc-1')
    ).resolves.toEqual({ customer_id: 'cust-1' });
    await expect(service.listAvailableCrossSells()).resolves.toEqual([
      { plan_cross_sell_id: 'cs1' },
    ]);

    expect(planAllListerRepository.listPlanAll).toHaveBeenCalled();
    expect(planCreatorRepository.createPlan).toHaveBeenCalledWith({
      name: 'Plan',
    });
    expect(planUpdaterRepository.updatePlan).toHaveBeenCalledWith('p1', {
      name: 'Updated',
    });
    expect(planDeleterTransactionRepository.deletePlan).toHaveBeenCalledWith(
      'tx',
      'p1'
    );
    expect(planItemCreatorRepository.createPlanItem).toHaveBeenCalledWith({
      plan_id: 'p1',
    });
    expect(planItemDeleterRepository.deletePlanItemById).toHaveBeenCalledWith(
      'pi1'
    );
    expect(planItemsListerRepository.listPlanItems).toHaveBeenCalledWith('p1');
    expect(
      planProductAllListerRepository.listPlanProductAll
    ).toHaveBeenCalled();
    expect(planSalesListerRepository.listPlanSales).toHaveBeenCalledWith({
      search: 'x',
    });
    expect(
      planWithItemsListerRepository.listPlanWithItems
    ).toHaveBeenCalledWith(null);
    expect(
      planProductWithPriceListerRepository.listPlanProductWithPrice
    ).toHaveBeenCalled();
    expect(userCardsListerRepository.listUserCards).toHaveBeenCalledWith('u1');
    expect(userInfoViewerRepository.viewUserInfo).toHaveBeenCalledWith('u1');
    expect(
      upgradeDiscountCalculatorRepository.calculateUpgradeDiscount
    ).toHaveBeenCalledWith('acc-1', 'plan-new', 'annual');
    expect(paymentService.getOrCreateCustomer).toHaveBeenCalledWith(
      expect.any(Function),
      'acc-1'
    );
    expect(
      crossSellListerRepository.listAvailableCrossSells
    ).toHaveBeenCalledWith({
      accountId: undefined,
      pricingMode: undefined,
    });
  });

  it('delegates order payment operations and normalizes getPlan null response', async () => {
    const {
      service,
      orderPaymentCreatorRepository,
      crossSellListerRepository,
    } = makeService();

    await expect(
      service.listAvailableCrossSells({
        accountId: 'acc-1',
        pricingMode: 'full',
      })
    ).resolves.toEqual([{ plan_cross_sell_id: 'cs1' }]);
    expect(
      crossSellListerRepository.listAvailableCrossSells
    ).toHaveBeenCalledWith({
      accountId: 'acc-1',
      pricingMode: 'full',
    });

    await expect(
      service.calculateOrderPayment('acc-1', { planId: 'p1' } as never)
    ).resolves.toEqual({
      planPrice: 100,
      addonsTotal: 10,
      discountAmount: 5,
      totalAmount: 105,
    });
    expect(
      orderPaymentCreatorRepository.calculateOrderPayment
    ).toHaveBeenCalledWith('acc-1', { planId: 'p1' });

    expect(service.getBillingPeriodId('monthly')).toBe('bp:monthly');
    expect(
      orderPaymentCreatorRepository.getBillingPeriodId
    ).toHaveBeenCalledWith('monthly');

    await expect(
      service.createAccountPayment({ accountId: 'acc-1' } as never)
    ).resolves.toBe('ap-1');
    expect(
      orderPaymentCreatorRepository.createAccountPayment
    ).toHaveBeenCalledWith({
      accountId: 'acc-1',
    });

    await expect(
      service.createAccountPaymentCrossSells({
        accountPaymentId: 'ap-1',
        addons: [],
        billingPeriod: 'monthly',
      })
    ).resolves.toBeUndefined();

    await expect(service.getPlan('p1')).resolves.toEqual({
      plan_id: 'p1',
      price: '100',
      annual_discount: null,
      is_test: false,
      days_trial: null,
    });

    orderPaymentCreatorRepository.getPlan.mockResolvedValueOnce(undefined);
    await expect(service.getPlan('p2')).resolves.toBeNull();

    await expect(service.getCurrentActivePlanAccount('acc-1')).resolves.toEqual(
      {
        plan_account_id: 'pa1',
      }
    );
  });
});
