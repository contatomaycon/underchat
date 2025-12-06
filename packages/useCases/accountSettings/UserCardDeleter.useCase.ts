import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserCardDeleterRepository } from '@core/repositories/accountSettings/UserCardDeleter.repository';
import { PlanRecurringUpdaterRepository } from '@core/repositories/accountSettings/PlanRecurringUpdater.repository';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';

@injectable()
export class UserCardDeleterUseCase {
  constructor(
    private readonly userCardDeleterRepository: UserCardDeleterRepository,
    private readonly planRecurringUpdaterRepository: PlanRecurringUpdaterRepository,
    private readonly planCurrentInvoiceViewerRepository: PlanCurrentInvoiceViewerRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    userCardId: string,
    userId: string,
    accountId: string
  ): Promise<boolean> => {
    const deleted = await this.userCardDeleterRepository.deleteUserCard(
      userCardId,
      userId
    );

    if (!deleted) {
      throw new Error(t('card_not_found'));
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
