import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserCardDeleterRepository } from '@core/repositories/accountSettings/UserCardDeleter.repository';
import { PlanRecurringUpdaterRepository } from '@core/repositories/accountSettings/PlanRecurringUpdater.repository';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';
import { UserCardDefaultUpdaterRepository } from '@core/repositories/accountSettings/UserCardDefaultUpdater.repository';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class UserCardDeleterUseCase {
  constructor(
    @inject(UserCardDeleterRepository)
    private readonly userCardDeleterRepository: UserCardDeleterRepository,
    @inject(PlanRecurringUpdaterRepository)
    private readonly planRecurringUpdaterRepository: PlanRecurringUpdaterRepository,
    @inject(PlanCurrentInvoiceViewerRepository)
    private readonly planCurrentInvoiceViewerRepository: PlanCurrentInvoiceViewerRepository,
    @inject(UserCardsListerRepository)
    private readonly userCardsListerRepository: UserCardsListerRepository,
    @inject(UserCardDefaultUpdaterRepository)
    private readonly userCardDefaultUpdaterRepository: UserCardDefaultUpdaterRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    userCardId: string,
    userId: string,
    accountId: string
  ): Promise<boolean> => {
    const planInvoice =
      await this.planCurrentInvoiceViewerRepository.viewCurrentPlanInvoice(
        accountId
      );

    const cards = await this.userCardsListerRepository.listUserCards(userId);
    const cardToDelete = cards.find((c) => c.user_card_id === userCardId);

    if (!cardToDelete) {
      throw new Error(t('card_not_found'));
    }

    const isPlanCancelled = this.checkIfPlanIsCancelled(planInvoice);
    const hasRecurringPayment = planInvoice?.recurring_payment === true;

    if (!isPlanCancelled && hasRecurringPayment && cards.length === 1) {
      throw new Error(t('cannot_delete_last_card'));
    }

    const isDefault = cardToDelete.default;

    const deleted = await this.userCardDeleterRepository.deleteUserCard(
      userCardId,
      userId
    );

    if (!deleted) {
      throw new Error(t('card_not_found'));
    }

    if (isDefault) {
      const remainingCards =
        await this.userCardsListerRepository.listUserCards(userId);
      if (remainingCards.length > 0) {
        await this.userCardDefaultUpdaterRepository.setFirstCardAsDefault(
          userId
        );
      }
    }

    if (hasRecurringPayment) {
      await this.planRecurringUpdaterRepository.updatePlanRecurring(
        accountId,
        false
      );
    }

    return true;
  };

  private checkIfPlanIsCancelled(
    planInvoice: {
      cancellation_date: string | null;
      next_payment_date: string | null;
      account_status_id: string | null;
    } | null
  ): boolean {
    if (!planInvoice) return false;

    const hasCancellationDate = !!planInvoice.cancellation_date;
    const isAccountInactive =
      planInvoice.account_status_id &&
      planInvoice.account_status_id !== EAccountStatus.active;

    if (!hasCancellationDate && !isAccountInactive) return false;

    const nextPaymentDateStr = planInvoice.next_payment_date;
    if (nextPaymentDateStr) {
      const nextPaymentDate = new Date(nextPaymentDateStr);
      const now = new Date();
      return nextPaymentDate <= now;
    }

    return true;
  }
}
