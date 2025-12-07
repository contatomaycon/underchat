import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanRecurringUpdaterRepository } from '@core/repositories/accountSettings/PlanRecurringUpdater.repository';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';
import { UpdatePlanRecurringRequest } from '@core/schema/accountSettings/updatePlanRecurring/request.schema';

@injectable()
export class PlanRecurringUpdaterUseCase {
  constructor(
    private readonly planRecurringUpdaterRepository: PlanRecurringUpdaterRepository,
    private readonly userCardsListerRepository: UserCardsListerRepository,
    private readonly planCurrentInvoiceViewerRepository: PlanCurrentInvoiceViewerRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    input: UpdatePlanRecurringRequest
  ): Promise<boolean> => {
    if (input.recurring_payment) {
      const planInvoice =
        await this.planCurrentInvoiceViewerRepository.viewCurrentPlanInvoice(
          accountId
        );

      if (!planInvoice?.plan_id) {
        throw new Error(t('no_plan_found'));
      }

      const cards = await this.userCardsListerRepository.listUserCards(userId);

      if (cards.length === 0) {
        throw new Error(t('no_cards_found'));
      }

      const hasDefaultCard = cards.some((card) => card.default);

      if (!hasDefaultCard) {
        throw new Error(t('no_default_card_found'));
      }
    }

    return this.planRecurringUpdaterRepository.updatePlanRecurring(
      accountId,
      input.recurring_payment
    );
  };
}
