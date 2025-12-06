import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserCardDeleterRepository } from '@core/repositories/accountSettings/UserCardDeleter.repository';
import { PlanRecurringUpdaterRepository } from '@core/repositories/accountSettings/PlanRecurringUpdater.repository';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';
import { UserCardDefaultUpdaterRepository } from '@core/repositories/accountSettings/UserCardDefaultUpdater.repository';

@injectable()
export class UserCardDeleterUseCase {
  constructor(
    private readonly userCardDeleterRepository: UserCardDeleterRepository,
    private readonly planRecurringUpdaterRepository: PlanRecurringUpdaterRepository,
    private readonly planCurrentInvoiceViewerRepository: PlanCurrentInvoiceViewerRepository,
    private readonly userCardsListerRepository: UserCardsListerRepository,
    private readonly userCardDefaultUpdaterRepository: UserCardDefaultUpdaterRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    userCardId: string,
    userId: string,
    accountId: string
  ): Promise<boolean> => {
    const cards = await this.userCardsListerRepository.listUserCards(userId);
    const cardToDelete = cards.find((c) => c.user_card_id === userCardId);

    if (!cardToDelete) {
      throw new Error(t('card_not_found'));
    }

    if (cards.length === 1) {
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
      await this.userCardDefaultUpdaterRepository.setFirstCardAsDefault(userId);
    }

    const planInvoice =
      await this.planCurrentInvoiceViewerRepository.viewCurrentPlanInvoice(
        accountId
      );

    if (planInvoice?.recurring_payment) {
      await this.planRecurringUpdaterRepository.updatePlanRecurring(
        accountId,
        false
      );
    }

    return true;
  };
}
