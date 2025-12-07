import { injectable } from 'tsyringe';
import { NotificationMessageViewerRepository } from '@core/repositories/notifications/NotificationMessageViewer.repository';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { notificationMappings } from '@core/mappings/notification.mappings';
import { WorkerActiveByAccountViewerRepository } from '@core/repositories/worker/WorkerActiveByAccountViewer.repository';
import { UserService } from './user.service';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { UserInfoViewerRepository } from '@core/repositories/user/UserInfoViewer.repository';
import { WorkerNameViewerRepository } from '@core/repositories/worker/WorkerNameViewer.repository';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';
import { ENotificationType } from '@core/common/enums/ENotificationType';
import { webcrypto } from 'node:crypto';
import { EmailService } from './email.service';

@injectable()
export class NotificationMessageService {
  constructor(
    private readonly notificationMessageViewerRepository: NotificationMessageViewerRepository,
    private readonly userMasterViewerRepository: UserMasterViewerRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly workerActiveByAccountViewerRepository: WorkerActiveByAccountViewerRepository,
    private readonly userService: UserService,
    private readonly userInfoViewerRepository: UserInfoViewerRepository,
    private readonly workerNameViewerRepository: WorkerNameViewerRepository,
    private readonly planCurrentInvoiceViewerRepository: PlanCurrentInvoiceViewerRepository,
    private readonly emailService: EmailService
  ) {}

  private async prepareNotificationMessages(
    notification: any,
    notificationTypeName: string,
    fullName: string | null,
    accountId: string
  ): Promise<{
    whatsappMessage: string | null;
    emailMessage: string | null;
    emailSubject: string | null;
  }> {
    let whatsappMessage: string | null = null;
    let emailMessage: string | null = null;
    let emailSubject: string | null = null;

    if (notification.message_whatsapp) {
      whatsappMessage = await this.replaceNotificationParameters(
        notification.message_whatsapp,
        notificationTypeName,
        fullName,
        accountId
      );
    }

    if (notification.message_email) {
      emailMessage = await this.replaceNotificationParameters(
        notification.message_email,
        notificationTypeName,
        fullName,
        accountId
      );

      if (notification.email_subject) {
        emailSubject = await this.replaceNotificationParameters(
          notification.email_subject,
          notificationTypeName,
          fullName,
          accountId
        );
      }
    }

    return { whatsappMessage, emailMessage, emailSubject };
  }

  private async saveNotificationToElastic(
    notificationMessage: INotificationMessage,
    notificationId: string
  ): Promise<void> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.notification,
      notificationMappings()
    );

    await this.elasticDatabaseService.update(
      EElasticIndex.notification,
      notificationMessage,
      notificationId
    );
  }

  private async sendWhatsAppNotification(
    notification: any,
    phone: string | null,
    workerId: string,
    notificationMessage: INotificationMessage
  ): Promise<void> {
    if (!notification.message_whatsapp || !phone) {
      return;
    }

    const kafkaTopic =
      this.kafkaBaileysQueueService.workerNotificationMessage(workerId);
    await this.streamProducerService.send(kafkaTopic, notificationMessage);
  }

  private async sendEmailNotification(
    notification: any,
    userEmail: string | null,
    emailMessage: string | null,
    emailSubject: string | null
  ): Promise<void> {
    if (!notification.message_email || !userEmail || !emailMessage) {
      return;
    }

    await this.emailService.sendEmail({
      to: userEmail,
      subject: emailSubject || '',
      html: emailMessage,
      text: emailMessage,
    });
  }

  async sendNotificationMessage(
    notificationTypeId: string,
    accountId: string
  ): Promise<boolean> {
    const notification =
      await this.notificationMessageViewerRepository.findNotificationByTypeId(
        notificationTypeId
      );

    if (!notification) {
      throw new Error('Notification not found');
    }

    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        accountId
      );

    if (!masterUser) {
      throw new Error('Master user not found for account');
    }

    const notificationTypeName = notification.nnt?.name || '';

    const userInfo = await this.userInfoViewerRepository.findUserInfoByUserId(
      masterUser.user_id
    );

    if (!userInfo) {
      throw new Error('User info not found');
    }

    const fullName = userInfo.name || userInfo.last_name || null;
    const phone = this.userService.getUserPhoneDecrypted(userInfo.phone);
    const userEmail = await this.getUserEmail(masterUser.user_id);

    const workerId =
      notification.worker_id || (await this.getFirstActiveWorkerId(accountId));

    if (!workerId) {
      throw new Error('No active worker found for account');
    }

    const workerName =
      await this.workerNameViewerRepository.findWorkerNameById(workerId);

    if (!workerName) {
      throw new Error('Worker not found');
    }

    const { whatsappMessage, emailMessage, emailSubject } =
      await this.prepareNotificationMessages(
        notification,
        notificationTypeName,
        fullName,
        accountId
      );

    if (!notification.message_whatsapp && !notification.message_email) {
      return true;
    }

    const remoteJid = phone
      ? normalizePhoneToJid(phone, userInfo.phone_ddi) || null
      : null;

    const notificationMessage: INotificationMessage = {
      id: notification.notification_id,
      notification_id: notification.notification_id,
      message_key: {
        remote_jid: remoteJid,
      },
      account: {
        id: accountId,
        name: masterUser.account_name,
      },
      worker: {
        id: workerId,
        name: workerName || null,
      },
      notification_type: {
        id: notification.notification_type_id,
        name: notificationTypeName,
      },
      message_whatsapp: whatsappMessage,
      message_email: emailMessage,
      email_subject: emailSubject,
      name: fullName,
      phone: phone || null,
      email: userEmail || null,
      date: new Date().toISOString(),
    };

    await this.saveNotificationToElastic(
      notificationMessage,
      notification.notification_id
    );

    await this.sendWhatsAppNotification(
      notification,
      phone,
      workerId,
      notificationMessage
    );

    await this.sendEmailNotification(
      notification,
      userEmail,
      emailMessage,
      emailSubject
    );

    return true;
  }

  private async getFirstActiveWorkerId(
    accountId: string
  ): Promise<string | null> {
    const workers =
      await this.workerActiveByAccountViewerRepository.viewWorkerActiveByAccount(
        accountId
      );

    if (!workers || workers.length === 0) {
      return null;
    }

    return workers[0].worker_id;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomArray = new Uint32Array(8);
    webcrypto.getRandomValues(randomArray);
    return Array.from(randomArray, (value) => chars[value % chars.length]).join(
      ''
    );
  }

  private async getPlanData(accountId: string): Promise<{
    plan: string | null;
    expiration_date: string | null;
    value: string | null;
  }> {
    const planInvoice =
      await this.planCurrentInvoiceViewerRepository.viewCurrentPlanInvoice(
        accountId
      );

    if (!planInvoice.plan_name) {
      return {
        plan: null,
        expiration_date: null,
        value: null,
      };
    }

    const expirationDate = planInvoice.next_payment_date
      ? new Date(planInvoice.next_payment_date).toLocaleDateString('pt-BR')
      : null;

    const value = planInvoice.plan_account_value
      ? new Intl.NumberFormat('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(planInvoice.plan_account_value))
      : null;

    return {
      plan: planInvoice.plan_name || null,
      expiration_date: expirationDate,
      value: value,
    };
  }

  private async replaceNotificationParameters(
    message: string | null,
    notificationTypeName: string,
    userName: string | null,
    accountId: string
  ): Promise<string | null> {
    if (!message) {
      return null;
    }

    let replacedMessage = message;

    if (notificationTypeName === ENotificationType.two_factor) {
      const code = this.generateCode();
      replacedMessage = replacedMessage.replaceAll('{{code}}', code);
      replacedMessage = replacedMessage.replaceAll('{{name}}', userName || '');
      return replacedMessage;
    }

    if (
      notificationTypeName === ENotificationType.plan ||
      notificationTypeName === ENotificationType.plan_expiration
    ) {
      const planData = await this.getPlanData(accountId);
      replacedMessage = replacedMessage.replaceAll(
        '{{plan}}',
        planData.plan || ''
      );
      replacedMessage = replacedMessage.replaceAll('{{name}}', userName || '');
      replacedMessage = replacedMessage.replaceAll(
        '{{expiration_date}}',
        planData.expiration_date || ''
      );
      replacedMessage = replacedMessage.replaceAll(
        '{{value}}',
        planData.value || ''
      );
    }

    return replacedMessage;
  }

  private async getUserEmail(userId: string): Promise<string | null> {
    try {
      const sensitiveData =
        await this.userService.getUserSensitiveDataDecrypted(userId);
      return sensitiveData?.email || null;
    } catch (error) {
      console.error('Erro ao obter email do usuário:', error);
      return null;
    }
  }
}
