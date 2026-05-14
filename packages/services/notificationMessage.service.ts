import { injectable, inject } from 'tsyringe';
import { NotificationMessageViewerRepository } from '@core/repositories/notifications/NotificationMessageViewer.repository';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { notificationMappings } from '@core/mappings/notification.mappings';
import { UserService } from './user.service';
import { UserInfoViewerRepository } from '@core/repositories/user/UserInfoViewer.repository';
import { WorkerNameViewerRepository } from '@core/repositories/worker/WorkerNameViewer.repository';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';
import {
  ENotificationType,
  ENotificationTypeId,
} from '@core/common/enums/ENotificationType';
import { webcrypto, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { EmailService } from './email.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';
import { TwoFactorCreatorRepository } from '@core/repositories/auth/TwoFactorCreator.repository';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { EncryptService } from './encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { centrifugoEnvironment } from '@core/config/environments';
import { registerValidationCentrifugo } from '@core/common/functions/centrifugoQueue';
import {
  ActiveWhatsappValidationContext,
  IActiveWhatsappValidationResponse,
} from '@core/common/interfaces/IActiveWhatsappValidation';

@injectable()
export class NotificationMessageService {
  constructor(
    @inject(NotificationMessageViewerRepository)
    private readonly notificationMessageViewerRepository: NotificationMessageViewerRepository,
    @inject(UserMasterViewerRepository)
    private readonly userMasterViewerRepository: UserMasterViewerRepository,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(UserInfoViewerRepository)
    private readonly userInfoViewerRepository: UserInfoViewerRepository,
    @inject(WorkerNameViewerRepository)
    private readonly workerNameViewerRepository: WorkerNameViewerRepository,
    @inject(PlanCurrentInvoiceViewerRepository)
    private readonly planCurrentInvoiceViewerRepository: PlanCurrentInvoiceViewerRepository,
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(TwoFactorCreatorRepository)
    private readonly twoFactorCreatorRepository: TwoFactorCreatorRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async prepareNotificationMessages(
    notification: any,
    notificationTypeName: string,
    fullName: string | null,
    accountId: string,
    channels: {
      whatsapp: boolean;
      email: boolean;
    }
  ): Promise<{
    whatsappMessage: string | null;
    emailMessage: string | null;
    emailSubject: string | null;
  }> {
    let whatsappMessage: string | null = null;
    let emailMessage: string | null = null;
    let emailSubject: string | null = null;

    if (channels.whatsapp && notification.message_whatsapp) {
      whatsappMessage = await this.replaceNotificationParameters(
        notification.message_whatsapp,
        notificationTypeName,
        fullName,
        accountId
      );
    }

    if (channels.email && notification.message_email) {
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

    await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.notification,
      notificationId,
      notificationMessage as unknown as Record<string, unknown>,
      {
        upsert: true,
      }
    );
  }

  private async sendWhatsAppNotification(
    notification: any,
    phone: string | null,
    workerId: string | null,
    notificationMessage: INotificationMessage
  ): Promise<void> {
    if (
      notification.whatsapp_enabled !== true ||
      !notificationMessage.message_whatsapp ||
      !phone ||
      !workerId
    ) {
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
    if (
      notification.email_enabled !== true ||
      !notification.message_email ||
      !userEmail ||
      !emailMessage
    ) {
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

    const hasWhatsappConfig =
      notification.whatsapp_enabled === true &&
      !!notification.message_whatsapp &&
      !!notification.worker_id;
    const hasEmailConfig =
      notification.email_enabled === true && !!notification.message_email;

    if (!hasWhatsappConfig && !hasEmailConfig) {
      return true;
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
    const remoteJid = this.userService.getUserPhoneJidDecrypted(
      userInfo.phone_jid
    );
    const userEmail = await this.getUserEmail(masterUser.user_id);

    let shouldSendWhatsapp = !!(
      hasWhatsappConfig &&
      phone &&
      userInfo.phone_ddi
    );
    const shouldSendEmail = !!(hasEmailConfig && userEmail);

    if (!shouldSendWhatsapp && !shouldSendEmail) {
      return true;
    }

    const { whatsappMessage, emailMessage, emailSubject } =
      await this.prepareNotificationMessages(
        notification,
        notificationTypeName,
        fullName,
        accountId,
        {
          whatsapp: shouldSendWhatsapp,
          email: shouldSendEmail,
        }
      );

    let workerId: string | null = null;
    let workerName: string | null = null;

    if (shouldSendWhatsapp && notification.worker_id) {
      workerId = notification.worker_id;

      workerName =
        await this.workerNameViewerRepository.findWorkerNameById(workerId);

      if (!workerName) {
        shouldSendWhatsapp = false;
        workerId = null;
      }
    }

    if (!shouldSendWhatsapp && !shouldSendEmail) {
      return true;
    }

    const notificationMessage: INotificationMessage = {
      id: notification.notification_id,
      user_id: masterUser.user_id,
      notification_id: notification.notification_id,
      message_key: {
        remote_jid: remoteJid,
        phone_ddi: userInfo.phone_ddi || '',
        phone_number: phone || '',
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
      message_whatsapp: shouldSendWhatsapp ? whatsappMessage : null,
      message_email: shouldSendEmail ? emailMessage : null,
      email_subject: shouldSendEmail ? emailSubject : null,
      name: fullName,
      phone: phone || null,
      email: userEmail || null,
      date: new Date().toISOString(),
    };

    await this.saveNotificationToElastic(
      notificationMessage,
      notification.notification_id
    );

    if (shouldSendWhatsapp) {
      await this.sendWhatsAppNotification(
        notification,
        phone,
        workerId,
        notificationMessage
      );
    }

    if (shouldSendEmail) {
      await this.sendEmailNotification(
        notification,
        userEmail,
        emailMessage,
        emailSubject
      );
    }

    return true;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomArray = new Uint32Array(6);
    webcrypto.getRandomValues(randomArray);
    return Array.from(randomArray, (value) => chars[value % chars.length]).join(
      ''
    );
  }

  private generateActiveValidationCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomArray = new Uint32Array(16);
    webcrypto.getRandomValues(randomArray);
    const raw = Array.from(
      randomArray,
      (value) => chars[value % chars.length]
    ).join('');
    const chunks = raw.match(/.{1,4}/g) ?? [raw];
    return `${chunks.join('-')}-UNDERCHAT`;
  }

  private buildValidationText(code: string): string {
    return `Código de Validação: ${code}`;
  }

  private buildWhatsappUrl(phone: string, text: string): string {
    const normalizedPhone = phone.replaceAll(/\D/g, '');
    const params = new URLSearchParams({
      phone: normalizedPhone,
      text,
      type: 'phone_number',
      app_absent: '0',
    });

    return `https://web.whatsapp.com/send/?${params.toString()}`;
  }

  private generateValidationCentrifugoToken(validationId: string): string {
    const exp = Math.floor(Date.now() / 1000) + 30 * 60;
    return jwt.sign(
      {
        sub: validationId,
        user: validationId,
        exp,
        params: {
          userID: validationId,
        },
      },
      centrifugoEnvironment.centrifugoHmacSecretKey,
      { algorithm: 'HS256' }
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

    const planValue =
      planInvoice.current_total_cycle_value ??
      planInvoice.plan_account_value ??
      planInvoice.plan_price ??
      planInvoice.last_paid_invoice_value ??
      null;

    const value =
      planValue !== null
        ? new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(Number(planValue))
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
      notificationTypeName === ENotificationType.plan_new ||
      notificationTypeName === ENotificationType.plan_renewal ||
      notificationTypeName === ENotificationType.plan_expiration ||
      notificationTypeName === ENotificationType.plan_cancellation ||
      notificationTypeName === ENotificationType.recurring_payment_failure ||
      notificationTypeName === ENotificationType.test_plan_new ||
      notificationTypeName === ENotificationType.test_plan_expiration
    ) {
      const planData = await this.getPlanData(accountId);
      const isTestNotification =
        notificationTypeName === ENotificationType.test_plan_new ||
        notificationTypeName === ENotificationType.test_plan_expiration;

      replacedMessage = replacedMessage.replaceAll(
        '{{plan}}',
        planData.plan || ''
      );
      replacedMessage = replacedMessage.replaceAll('{{name}}', userName || '');
      replacedMessage = replacedMessage.replaceAll(
        '{{expiration_date}}',
        planData.expiration_date || ''
      );

      if (!isTestNotification) {
        replacedMessage = replacedMessage.replaceAll(
          '{{value}}',
          planData.value || ''
        );
      } else {
        replacedMessage = replacedMessage.replaceAll('{{value}}', '');
      }
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

  async sendPlanNotification(
    accountId: string,
    planId: string,
    notificationTypeId: string
  ): Promise<void> {
    const lockKey = `notification:${accountId}:${planId}:${notificationTypeId}`;

    await withLock(
      this.redis,
      lockKey,
      async () => {
        const topic = this.kafkaServiceQueueService.notificationMessage();
        await this.streamProducerService.send(topic, {
          notification_type_id: notificationTypeId,
          account_id: accountId,
        });
      },
      {
        ttlMs: 60000,
        preventDuplicate: true,
        duplicateTtlSeconds: 300,
      }
    ).catch((error) => {
      console.error('Erro ao enviar notificação de plano liberado:', error);
    });
  }

  async sendTwoFactorCodeWithChannels(input: {
    email?: string | null;
    userId?: string | null;
    phone?: string | null;
    phoneDdi?: string | null;
    name?: string | null;
    context?: ActiveWhatsappValidationContext;
  }): Promise<
    {
      code: string;
      sent_via_email: boolean;
      sent_via_whatsapp: boolean;
    } & IActiveWhatsappValidationResponse
  > {
    const notification =
      await this.notificationMessageViewerRepository.findNotificationByTypeId(
        ENotificationTypeId.two_factor
      );

    if (!notification) {
      throw new Error('Two factor notification not found');
    }

    const email = input.email?.trim() || null;
    const phone = input.phone?.trim() || null;
    const phoneDdi = input.phoneDdi?.trim() || null;
    const context = input.context ?? 'register';

    const hasWhatsappValidationConfig = !!(
      notification.whatsapp_enabled === true &&
      notification.worker_id &&
      notification.nwr?.number &&
      phone &&
      phoneDdi
    );

    if (!hasWhatsappValidationConfig) {
      throw new Error('Two factor notification channels not configured');
    }

    const workerId = notification.worker_id;
    const workerNumber = notification.nwr?.number?.replaceAll(/\D/g, '') ?? '';

    if (!workerId || !workerNumber) {
      throw new Error('Two factor notification channels not configured');
    }

    const workerName =
      await this.workerNameViewerRepository.findWorkerNameById(workerId);

    if (!workerName) {
      throw new Error('Two factor notification channels not configured');
    }

    const code = this.generateActiveValidationCode();
    const token = randomUUID();

    const phoneEncrypted = phone
      ? this.passwordEncryptorService.encrypt(phone)
      : null;
    const phoneC = phone ? this.encryptService.encrypt(phone) : null;
    const phonePartial = phone
      ? this.encryptService
          .sanitize(phone, ETypeSanetize.phone)
          ?.slice(0, 15) || null
      : null;

    const emailEncrypted = email
      ? this.passwordEncryptorService.encrypt(email)
      : null;
    const emailC = email ? this.encryptService.encrypt(email) : null;
    const emailPartial = email
      ? this.encryptService
          .sanitize(email, ETypeSanetize.email)
          ?.slice(0, 50) || null
      : null;

    const validationId = await this.twoFactorCreatorRepository.createTwoFactor({
      userId: input.userId ?? null,
      phoneDdi,
      phone: phoneEncrypted,
      phonePartial,
      phoneC,
      email: emailEncrypted,
      emailPartial,
      emailC,
      code,
      token,
      workerId,
      workerNumber,
      validationContext: context,
    });

    const validationText = this.buildValidationText(code);
    const channel = registerValidationCentrifugo(validationId);
    const centrifugoToken =
      this.generateValidationCentrifugoToken(validationId);

    return {
      code,
      sent_via_email: false,
      sent_via_whatsapp: true,
      validation_id: validationId,
      validation_text: validationText,
      whatsapp_url: this.buildWhatsappUrl(workerNumber, validationText),
      target_phone: workerNumber,
      centrifugo_url: centrifugoEnvironment.centrifugoWsUrl,
      centrifugo_token: centrifugoToken,
      centrifugo_channel: channel,
    };
  }

  async sendTwoFactorCodeByWhatsApp(
    phone: string,
    phoneDdi: string,
    name: string | null = null,
    email?: string | null
  ): Promise<string> {
    const result = await this.sendTwoFactorCodeWithChannels({
      email,
      userId: null,
      phone,
      phoneDdi,
      name,
    });

    return result.code;
  }

  async sendTwoFactorCodeByEmail(
    email: string,
    userId: string,
    phone: string | null = null,
    phoneDdi: string | null = null,
    name: string | null = null
  ): Promise<string> {
    const result = await this.sendTwoFactorCodeWithChannels({
      email,
      userId,
      phone,
      phoneDdi,
      name,
    });
    return result.code;
  }

  async sendTwoFactorCodeByEmailWithChannels(
    email: string,
    userId: string,
    phone: string | null = null,
    phoneDdi: string | null = null,
    name: string | null = null
  ): Promise<{
    code: string;
    sent_via_email: boolean;
    sent_via_whatsapp: boolean;
  }> {
    return this.sendTwoFactorCodeWithChannels({
      email,
      userId,
      phone,
      phoneDdi,
      name,
    });
  }
}
