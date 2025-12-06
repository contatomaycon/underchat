import { injectable } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';

@injectable()
export class UserCardsListerUseCase {
  constructor(private readonly planService: PlanService) {}

  execute = async (userId: string): Promise<ListUserCardResponse[]> => {
    return this.planService.listUserCards(userId);
  };
}
