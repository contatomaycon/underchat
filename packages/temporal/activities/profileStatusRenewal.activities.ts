import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { injectable } from 'tsyringe';

export interface IProfileStatusRenewalActivity {
  renewPermanentStatuses(): Promise<void>;
}

@injectable()
export class ProfileStatusRenewalActivity implements IProfileStatusRenewalActivity {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  renewPermanentStatuses = async (): Promise<void> => {
    await this.workerProfileStatusService.renewPermanentStatuses();
  };
}
