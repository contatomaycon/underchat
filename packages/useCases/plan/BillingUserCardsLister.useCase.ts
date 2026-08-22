import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { PlanService } from '@core/services/plan.service';
import { inject, injectable } from 'tsyringe';

/** Lists cards for the account's billing owner, matching PaymentService. */
@injectable()
export class BillingUserCardsListerUseCase {
  constructor(
    @inject(PlanService)
    private readonly planService: PlanService,
    @inject(UserMasterViewerRepository)
    private readonly userMasterViewerRepository: UserMasterViewerRepository
  ) {}

  execute = async (accountId: string): Promise<ListUserCardResponse[]> => {
    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        accountId
      );

    if (!masterUser) {
      return [];
    }

    return this.planService.listUserCards(masterUser.user_id);
  };
}
