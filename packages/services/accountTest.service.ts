import { injectable } from 'tsyringe';
import { AccountTestRepository } from '@core/repositories/account/AccountTest.repository';
import { EncryptService } from './encrypt.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { PlanReleaseRepository } from '@core/repositories/plan/PlanRelease.repository';
import { NotificationMessageService } from './notificationMessage.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';

@injectable()
export class AccountTestService {
  constructor(
    private readonly accountTestRepository: AccountTestRepository,
    private readonly encryptService: EncryptService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly planReleaseRepository: PlanReleaseRepository,
    private readonly notificationMessageService: NotificationMessageService
  ) {}

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

    await this.planReleaseRepository.createTestPlanAccount({
      accountId: data.accountId,
      planId: data.planId,
      daysTrial: data.daysTrial,
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
