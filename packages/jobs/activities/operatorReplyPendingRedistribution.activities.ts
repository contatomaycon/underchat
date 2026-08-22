import { inject, injectable } from 'tsyringe';
import { OperatorReplyPendingRedistributionService } from '@core/services/operatorReplyPendingRedistribution.service';

@injectable()
export class OperatorReplyPendingRedistributionActivity {
  constructor(
    @inject(OperatorReplyPendingRedistributionService)
    private readonly service: OperatorReplyPendingRedistributionService
  ) {}

  processScheduledRedistributions = async (): Promise<void> => {
    await this.service.processScheduledRedistributions();
  };
}
