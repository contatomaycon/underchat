import { injectable, inject } from 'tsyringe';
import { PlanExpirationReminderRepository } from '@core/repositories/planAccount/PlanExpirationReminder.repository';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';
import Redis from 'ioredis';

@injectable()
export class PlanExpirationReminderService {
  constructor(
    private readonly planExpirationReminderRepository: PlanExpirationReminderRepository,
    private readonly notificationMessageService: NotificationMessageService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private getCacheKey(
    accountId: string,
    planAccountId: string,
    days: number
  ): string {
    return `plan-expiration-reminder:${accountId}:${planAccountId}:${days}days`;
  }

  private async hasNotificationBeenSent(
    accountId: string,
    planAccountId: string,
    days: number
  ): Promise<boolean> {
    const cacheKey = this.getCacheKey(accountId, planAccountId, days);
    const exists = await this.redis.get(cacheKey);
    return exists !== null;
  }

  private async markNotificationAsSent(
    accountId: string,
    planAccountId: string,
    days: number
  ): Promise<void> {
    const cacheKey = this.getCacheKey(accountId, planAccountId, days);
    const ttlSeconds = days === 0 ? 86400 : days * 86400;
    await this.redis.setex(cacheKey, ttlSeconds, '1');
  }

  private async sendReminderNotification(
    accountId: string,
    planAccountId: string,
    days: number
  ): Promise<void> {
    const alreadySent = await this.hasNotificationBeenSent(
      accountId,
      planAccountId,
      days
    );

    if (alreadySent) {
      console.log(
        `Notificação já enviada para account ${accountId}, plan ${planAccountId}, ${days} dias`
      );
      return;
    }

    try {
      await this.notificationMessageService.sendPlanNotification(
        accountId,
        planAccountId,
        ENotificationTypeId.plan_expiration
      );

      await this.markNotificationAsSent(accountId, planAccountId, days);

      console.log(
        `Notificação de vencimento enviada: account ${accountId}, plan ${planAccountId}, ${days} dias restantes`
      );
    } catch (error) {
      console.error(
        `Erro ao enviar notificação de vencimento para account ${accountId}:`,
        error
      );
    }
  }

  async processExpirationReminders(): Promise<void> {
    try {
      const daysToCheck = [3, 0];

      const allPlansPromises = daysToCheck.map(async (days) => {
        const expiringPlans =
          await this.planExpirationReminderRepository.findPlansExpiringInDays(
            days
          );

        console.log(
          `Encontrados ${expiringPlans.length} planos expirando em ${days} dias`
        );

        const notificationPromises = expiringPlans.map((plan) =>
          this.sendReminderNotification(
            plan.account_id,
            plan.plan_account_id,
            days
          )
        );

        return Promise.allSettled(notificationPromises);
      });

      await Promise.all(allPlansPromises);

      console.log('Processamento de lembretes de vencimento concluído');
    } catch (error) {
      console.error('Erro ao processar lembretes de vencimento:', error);
      throw error;
    }
  }
}
