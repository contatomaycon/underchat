import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { container } from 'tsyringe';

export interface IProfileStatusRenewalActivity {
  renewPermanentStatuses(): Promise<void>;
}

export async function renewPermanentStatuses(): Promise<void> {
  const workerProfileStatusService = container.resolve(
    WorkerProfileStatusService
  );

  await workerProfileStatusService.renewPermanentStatuses();
}
