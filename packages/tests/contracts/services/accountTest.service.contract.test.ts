import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(async () => null),
  }),
  { virtual: true }
);
import { AccountTestService } from '@core/services/accountTest.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

const deniedIntegrationEntitlement = {
  accountId: 'a1',
  planProductId: EPlanProduct.integration,
  allowed: false,
  revision: '1',
  validUntil: null,
  planIsActive: true,
  source: null,
} as const;

const createPlanEntitlementMock = (input?: {
  allowed?: boolean;
  hasPotentialGrant?: boolean;
}) => ({
  resolveAuthoritatively: jest.fn(async () => ({
    ...deniedIntegrationEntitlement,
    allowed: input?.allowed ?? false,
    source: input?.allowed ? ('plan' as const) : null,
  })),
  willGrantAfterPlanAssignment: jest.fn(
    async () => input?.hasPotentialGrant ?? false
  ),
  installDenyFence: jest.fn(async () => undefined),
  refreshAfterMutation: jest.fn(async () => deniedIntegrationEntitlement),
});

describe('AccountTestService', () => {
  it('encrypts values for existence checks', async () => {
    const encrypt = jest.fn((value: string) => `enc:${value}`);
    const service = new AccountTestService(
      {
        findExistingTest: jest.fn(async () => true),
        findExistingCreatedTest: jest.fn(async () => false),
        findExistingTestByPhone: jest.fn(async () => false),
        findExistingTestByEmail: jest.fn(async () => true),
        createAccountTest: jest.fn(),
        deleteValidatedReservationsByContact: jest.fn(async () => 0),
      } as never,
      { encrypt } as never,
      { encrypt: jest.fn() } as never,
      { createTestPlanAccount: jest.fn() } as never,
      { sendPlanNotification: jest.fn() } as never,
      createPlanEntitlementMock() as never
    );

    await expect(
      service.checkExistingTest({ document: '1', phone: '2', email: '3' })
    ).resolves.toBe(true);
    await expect(service.checkExistingTestByPhone('2')).resolves.toBe(false);
    await expect(service.checkExistingTestByEmail('3')).resolves.toBe(true);
    await expect(
      service.checkExistingCreatedTest({
        document: '1',
        phone: '2',
        email: '3',
      })
    ).resolves.toBe(false);

    expect(encrypt).toHaveBeenCalledWith('1');
    expect(encrypt).toHaveBeenCalledWith('2');
    expect(encrypt).toHaveBeenCalledWith('3');
  });

  it('creates test plan, stores encrypted data and sends notification', async () => {
    const createTestPlanAccount = jest.fn(async () => undefined);
    const createAccountTest = jest.fn(async () => undefined);
    const deleteValidatedReservationsByContact = jest.fn(async () => 1);
    const sendPlanNotification = jest.fn(async () => undefined);
    const planEntitlement = createPlanEntitlementMock();

    const service = new AccountTestService(
      {
        findExistingTest: jest.fn(),
        findExistingCreatedTest: jest.fn(),
        findExistingTestByPhone: jest.fn(),
        findExistingTestByEmail: jest.fn(),
        createAccountTest,
        deleteValidatedReservationsByContact,
      } as never,
      { encrypt: jest.fn((value: string) => `hash:${value}`) } as never,
      { encrypt: jest.fn((value: string) => `secure:${value}`) } as never,
      { createTestPlanAccount } as never,
      { sendPlanNotification } as never,
      planEntitlement as never
    );

    await expect(
      service.createTestPlan({
        accountId: 'a1',
        planId: 'p1',
        daysTrial: 7,
        document: 'doc',
        phone: 'phone',
        email: 'mail',
      })
    ).resolves.toBeUndefined();

    expect(createTestPlanAccount).toHaveBeenCalledWith({
      accountId: 'a1',
      planId: 'p1',
      daysTrial: 7,
    });
    expect(deleteValidatedReservationsByContact).toHaveBeenCalledWith({
      phoneC: 'hash:phone',
      emailC: 'hash:mail',
    });
    expect(createAccountTest).toHaveBeenCalledWith({
      document: 'secure:doc',
      documentC: 'hash:doc',
      phone: 'secure:phone',
      phoneC: 'hash:phone',
      email: 'secure:mail',
      emailC: 'hash:mail',
    });
    expect(sendPlanNotification).toHaveBeenCalledWith(
      'a1',
      'p1',
      ENotificationTypeId.test_plan_new
    );
    expect(planEntitlement.installDenyFence).not.toHaveBeenCalled();
    expect(planEntitlement.refreshAfterMutation).not.toHaveBeenCalled();
  });

  it('installs a deny fence before replacing a currently entitled plan', async () => {
    const createTestPlanAccount = jest.fn(async () => undefined);
    const planEntitlement = createPlanEntitlementMock({ allowed: true });
    const service = new AccountTestService(
      {
        deleteValidatedReservationsByContact: jest.fn(async () => 0),
        createAccountTest: jest.fn(async () => undefined),
      } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { createTestPlanAccount } as never,
      { sendPlanNotification: jest.fn(async () => undefined) } as never,
      planEntitlement as never
    );

    await service.createTestPlan({
      accountId: 'a1',
      planId: 'p2',
      daysTrial: 7,
      document: 'doc',
      phone: 'phone',
      email: 'mail',
    });

    expect(planEntitlement.resolveAuthoritatively).toHaveBeenCalledWith(
      'a1',
      EPlanProduct.integration
    );
    expect(planEntitlement.willGrantAfterPlanAssignment).toHaveBeenCalledWith({
      accountId: 'a1',
      planId: 'p2',
      planProductId: EPlanProduct.integration,
      prospectiveLastPaymentDate: expect.any(String),
      includeExistingAddons: true,
    });
    expect(planEntitlement.installDenyFence).toHaveBeenCalledWith(
      'a1',
      EPlanProduct.integration
    );
    expect(planEntitlement.refreshAfterMutation).toHaveBeenCalledWith(
      'a1',
      EPlanProduct.integration
    );
    expect(
      planEntitlement.installDenyFence.mock.invocationCallOrder[0]
    ).toBeLessThan(createTestPlanAccount.mock.invocationCallOrder[0]);
    expect(createTestPlanAccount.mock.invocationCallOrder[0]).toBeLessThan(
      planEntitlement.refreshAfterMutation.mock.invocationCallOrder[0]
    );
  });

  it('reconciles a potential grant without installing a deny fence', async () => {
    const createTestPlanAccount = jest.fn(async () => undefined);
    const planEntitlement = createPlanEntitlementMock({
      hasPotentialGrant: true,
    });
    const service = new AccountTestService(
      {
        deleteValidatedReservationsByContact: jest.fn(async () => 0),
        createAccountTest: jest.fn(async () => undefined),
      } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { createTestPlanAccount } as never,
      { sendPlanNotification: jest.fn(async () => undefined) } as never,
      planEntitlement as never
    );

    await service.createTestPlan({
      accountId: 'a1',
      planId: 'p1',
      daysTrial: 7,
      document: 'doc',
      phone: 'phone',
      email: 'mail',
    });

    expect(planEntitlement.installDenyFence).not.toHaveBeenCalled();
    expect(planEntitlement.refreshAfterMutation).toHaveBeenCalledTimes(1);
    expect(createTestPlanAccount.mock.invocationCallOrder[0]).toBeLessThan(
      planEntitlement.refreshAfterMutation.mock.invocationCallOrder[0]
    );
  });

  it('keeps the same epoch when an entitled account moves to another entitled plan', async () => {
    const createTestPlanAccount = jest.fn(async () => undefined);
    const planEntitlement = createPlanEntitlementMock({
      allowed: true,
      hasPotentialGrant: true,
    });
    const service = new AccountTestService(
      {
        deleteValidatedReservationsByContact: jest.fn(async () => 0),
        createAccountTest: jest.fn(async () => undefined),
      } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { createTestPlanAccount } as never,
      { sendPlanNotification: jest.fn(async () => undefined) } as never,
      planEntitlement as never
    );

    await service.createTestPlan({
      accountId: 'a1',
      planId: 'p-with-integration',
      daysTrial: 7,
      document: 'doc',
      phone: 'phone',
      email: 'mail',
    });

    expect(planEntitlement.installDenyFence).not.toHaveBeenCalled();
    expect(planEntitlement.refreshAfterMutation).toHaveBeenCalledTimes(1);
    expect(createTestPlanAccount).toHaveBeenCalledTimes(1);
  });

  it('restores the previous entitlement when the fenced mutation fails', async () => {
    const mutationError = new Error('mutation failed');
    const createTestPlanAccount = jest.fn(async () => {
      throw mutationError;
    });
    const planEntitlement = createPlanEntitlementMock({ allowed: true });
    const createAccountTest = jest.fn(async () => undefined);
    const service = new AccountTestService(
      {
        deleteValidatedReservationsByContact: jest.fn(async () => 0),
        createAccountTest,
      } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { encrypt: jest.fn((value: string) => value) } as never,
      { createTestPlanAccount } as never,
      { sendPlanNotification: jest.fn(async () => undefined) } as never,
      planEntitlement as never
    );

    await expect(
      service.createTestPlan({
        accountId: 'a1',
        planId: 'p2',
        daysTrial: 7,
        document: 'doc',
        phone: 'phone',
        email: 'mail',
      })
    ).rejects.toBe(mutationError);

    expect(planEntitlement.installDenyFence).toHaveBeenCalledTimes(1);
    expect(planEntitlement.refreshAfterMutation).toHaveBeenCalledTimes(1);
    expect(createAccountTest).not.toHaveBeenCalled();
  });
});
