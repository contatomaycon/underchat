import { inject, injectable } from 'tsyringe';
import { PlanCurrentInvoiceViewerRepository } from '@core/repositories/plan/PlanCurrentInvoiceViewer.repository';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/plan/viewCurrentPlanInvoice/response.schema';

@injectable()
export class PlanCurrentInvoiceViewerUseCase {
  constructor(
    @inject(PlanCurrentInvoiceViewerRepository)
    private readonly planCurrentInvoiceViewerRepository: PlanCurrentInvoiceViewerRepository
  ) {}

  async execute(accountId: string): Promise<ViewCurrentPlanInvoiceResponse> {
    return this.planCurrentInvoiceViewerRepository.viewCurrentPlanInvoice(
      accountId
    );
  }
}
