import 'reflect-metadata';

jest.mock('@core/services/accountTest.service', () => ({
  AccountTestService: class {},
}));
jest.mock('@core/repositories/user/UserMasterViewer.repository', () => ({
  UserMasterViewerRepository: class {},
}));
jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));

import { TestPlanAlreadyUsedCheckerUseCase } from '@core/useCases/plan/TestPlanAlreadyUsedChecker.useCase';

describe('TestPlanAlreadyUsedCheckerUseCase', () => {
  it('checks only created account_test rows', async () => {
    const accountTestService = {
      checkExistingTest: jest.fn(async () => true),
      checkExistingCreatedTest: jest.fn(async () => false),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => ({ user_id: 'user-1' })),
    };
    const userService = {
      getUserSensitiveDataDecrypted: jest.fn(async () => ({
        document: '12345678900',
        phone: '6195999040',
        email: 'user@example.com',
      })),
    };

    const useCase = new TestPlanAlreadyUsedCheckerUseCase(
      accountTestService as never,
      userMasterViewerRepository as never,
      userService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'account-1')
    ).resolves.toBe(false);

    expect(accountTestService.checkExistingCreatedTest).toHaveBeenCalledWith({
      document: '12345678900',
      phone: '6195999040',
      email: 'user@example.com',
    });
    expect(accountTestService.checkExistingTest).not.toHaveBeenCalled();
  });
});
