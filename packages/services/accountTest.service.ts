import { injectable, inject } from 'tsyringe';
import { AccountTestRepository } from '@core/repositories/account/AccountTest.repository';
import { EncryptService } from './encrypt.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { PlanReleaseRepository } from '@core/repositories/plan/PlanRelease.repository';
import { NotificationMessageService } from './notificationMessage.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import { PlanEntitlementService } from './planEntitlement.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class AccountTestService {
  constructor(
    @inject(AccountTestRepository)
    private readonly accountTestRepository: AccountTestRepository,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(PlanReleaseRepository)
    private readonly planReleaseRepository: PlanReleaseRepository,
    @inject(NotificationMessageService)
    private readonly notificationMessageService: NotificationMessageService,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  private readonly restoreIntegrationEntitlementAfterFailure = async (
    accountId: string,
    denyFenceOwnerToken?: string
  ): Promise<void> => {
    try {
      await (denyFenceOwnerToken
        ? this.planEntitlementService.refreshAfterMutation(
            accountId,
            EPlanProduct.integration,
            denyFenceOwnerToken
          )
        : this.planEntitlementService.refreshAfterMutation(
            accountId,
            EPlanProduct.integration
          ));
    } catch (error) {
      console.error(
        'Could not restore integration entitlement after a failed test plan mutation.',
        error
      );
    }
  };

  private readonly createTestPlanAccount = async (data: {
    accountId: string;
    planId: string;
    daysTrial: number;
  }): Promise<void> => {
    const [currentEntitlement, hasPotentialGrant] = await Promise.all([
      this.planEntitlementService.resolveAuthoritatively(
        data.accountId,
        EPlanProduct.integration
      ),
      this.planEntitlementService.willGrantAfterPlanAssignment({
        accountId: data.accountId,
        planId: data.planId,
        planProductId: EPlanProduct.integration,
        prospectiveLastPaymentDate: new Date().toISOString(),
        includeExistingAddons: true,
      }),
    ]);

    const hasIntegrationImpact =
      currentEntitlement.allowed || hasPotentialGrant;

    if (!hasIntegrationImpact) {
      await this.planReleaseRepository.createTestPlanAccount(data);
      return;
    }

    let denyFenceOwnerToken: string | null | undefined;
    if (currentEntitlement.allowed && !hasPotentialGrant) {
      try {
        denyFenceOwnerToken =
          await this.planEntitlementService.installDenyFence(
            data.accountId,
            EPlanProduct.integration
          );
      } catch (error) {
        throw error;
      }
    }

    let mutationCompleted = false;

    try {
      await this.planReleaseRepository.createTestPlanAccount(data);
      mutationCompleted = true;
      await (denyFenceOwnerToken
        ? this.planEntitlementService.refreshAfterMutation(
            data.accountId,
            EPlanProduct.integration,
            denyFenceOwnerToken
          )
        : this.planEntitlementService.refreshAfterMutation(
            data.accountId,
            EPlanProduct.integration
          ));
    } catch (error) {
      await this.restoreIntegrationEntitlementAfterFailure(
        data.accountId,
        denyFenceOwnerToken ?? undefined
      );

      if (mutationCompleted) {
        console.error(
          'The test plan mutation completed, but its integration entitlement could not be reconciled.',
          error
        );
      }

      throw error;
    }
  };

  checkExistingTest = async (data: {
    document: string;
    phone: string;
    email: string;
  }): Promise<boolean> => {
    const documentC = this.encryptService.encrypt(data.document);
    const phoneC = this.encryptService.encrypt(data.phone);
    const emailC = this.encryptService.encrypt(data.email);

    return this.accountTestRepository.findExistingTest({
      documentC,
      phoneC,
      emailC,
    });
  };

  checkExistingCreatedTest = async (data: {
    document: string;
    phone: string;
    email: string;
  }): Promise<boolean> => {
    const documentC = this.encryptService.encrypt(data.document);
    const phoneC = this.encryptService.encrypt(data.phone);
    const emailC = this.encryptService.encrypt(data.email);

    return this.accountTestRepository.findExistingCreatedTest({
      documentC,
      phoneC,
      emailC,
    });
  };

  checkExistingTestByPhone = async (phone: string): Promise<boolean> => {
    const phoneC = this.encryptService.encrypt(phone);

    return this.accountTestRepository.findExistingTestByPhone(phoneC);
  };

  checkExistingTestByEmail = async (email: string): Promise<boolean> => {
    const emailC = this.encryptService.encrypt(email);

    return this.accountTestRepository.findExistingTestByEmail(emailC);
  };

  createTestPlan = async (data: {
    accountId: string;
    planId: string;
    daysTrial: number;
    document: string;
    phone: string;
    email: string;
  }): Promise<void> => {
    const documentEncrypted = this.passwordEncryptorService.encrypt(
      data.document
    );
    const phoneEncrypted = this.passwordEncryptorService.encrypt(data.phone);
    const emailEncrypted = this.passwordEncryptorService.encrypt(data.email);

    const documentC = this.encryptService.encrypt(data.document);
    const phoneC = this.encryptService.encrypt(data.phone);
    const emailC = this.encryptService.encrypt(data.email);

    await this.createTestPlanAccount({
      accountId: data.accountId,
      planId: data.planId,
      daysTrial: data.daysTrial,
    });

    await this.accountTestRepository.deleteValidatedReservationsByContact({
      phoneC,
      emailC,
    });

    await this.accountTestRepository.createAccountTest({
      document: documentEncrypted,
      documentC,
      phone: phoneEncrypted,
      phoneC,
      email: emailEncrypted,
      emailC,
    });

    await this.notificationMessageService.sendPlanNotification(
      data.accountId,
      data.planId,
      ENotificationTypeId.test_plan_new
    );
  };
}
