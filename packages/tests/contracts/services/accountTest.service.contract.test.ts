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

describe('AccountTestService', () => {
  it('encrypts values for existence checks', async () => {
    const encrypt = jest.fn((value: string) => `enc:${value}`);
    const service = new AccountTestService(
      {
        findExistingTest: jest.fn(async () => true),
        findExistingTestByPhone: jest.fn(async () => false),
        findExistingTestByEmail: jest.fn(async () => true),
        createAccountTest: jest.fn(),
      } as never,
      { encrypt } as never,
      { encrypt: jest.fn() } as never,
      { createTestPlanAccount: jest.fn() } as never,
      { sendPlanNotification: jest.fn() } as never
    );

    await expect(
      service.checkExistingTest({ document: '1', phone: '2', email: '3' })
    ).resolves.toBe(true);
    await expect(service.checkExistingTestByPhone('2')).resolves.toBe(false);
    await expect(service.checkExistingTestByEmail('3')).resolves.toBe(true);

    expect(encrypt).toHaveBeenCalledWith('1');
    expect(encrypt).toHaveBeenCalledWith('2');
    expect(encrypt).toHaveBeenCalledWith('3');
  });

  it('creates test plan, stores encrypted data and sends notification', async () => {
    const createTestPlanAccount = jest.fn(async () => undefined);
    const createAccountTest = jest.fn(async () => undefined);
    const sendPlanNotification = jest.fn(async () => undefined);

    const service = new AccountTestService(
      {
        findExistingTest: jest.fn(),
        findExistingTestByPhone: jest.fn(),
        findExistingTestByEmail: jest.fn(),
        createAccountTest,
      } as never,
      { encrypt: jest.fn((value: string) => `hash:${value}`) } as never,
      { encrypt: jest.fn((value: string) => `secure:${value}`) } as never,
      { createTestPlanAccount } as never,
      { sendPlanNotification } as never
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
  });
});
