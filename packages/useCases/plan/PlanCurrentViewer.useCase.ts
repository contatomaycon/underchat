import { inject, injectable } from 'tsyringe';
import { PlanCurrentViewerRepository } from '@core/repositories/plan/PlanCurrentViewer.repository';
import { ViewCurrentPlanResponse } from '@core/schema/plan/viewCurrentPlan/response.schema';

@injectable()
export class PlanCurrentViewerUseCase {
  constructor(
    @inject(PlanCurrentViewerRepository)
    private readonly planCurrentViewerRepository: PlanCurrentViewerRepository
  ) {}

  async execute(accountId: string): Promise<ViewCurrentPlanResponse> {
    return this.planCurrentViewerRepository.viewCurrentPlan(accountId);
  }
}
