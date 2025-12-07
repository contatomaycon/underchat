import { injectable } from 'tsyringe';
import { AccountTestService } from '@core/services/accountTest.service';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { UserService } from '@core/services/user.service';
import { TFunction } from 'i18next';

@injectable()
export class TestPlanAlreadyUsedCheckerUseCase {
  constructor(
    private readonly accountTestService: AccountTestService,
    private readonly userMasterViewerRepository: UserMasterViewerRepository,
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<boolean> {
    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        accountId
      );

    if (!masterUser) {
      return false;
    }

    const sensitiveData = await this.userService.getUserSensitiveDataDecrypted(
      masterUser.user_id
    );

    if (!sensitiveData) {
      return false;
    }

    if (
      !sensitiveData.document ||
      !sensitiveData.phone ||
      !sensitiveData.email
    ) {
      return false;
    }

    return this.accountTestService.checkExistingTest({
      document: sensitiveData.document,
      phone: sensitiveData.phone,
      email: sensitiveData.email,
    });
  }
}
