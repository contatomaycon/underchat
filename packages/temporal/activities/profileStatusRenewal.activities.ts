import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { injectable, inject } from 'tsyringe';

export interface IProfileStatusRenewalActivity {
  renewPermanentStatuses(): Promise<void>;
}

@injectable()
export class ProfileStatusRenewalActivity implements IProfileStatusRenewalActivity {
  constructor(
    @inject(WorkerProfileStatusService)
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  renewPermanentStatuses = async (): Promise<void> => {
    await this.workerProfileStatusService.renewPermanentStatuses();
  };
}
