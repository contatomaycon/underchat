import { WorkerMonitorService } from '@core/services/workerMonitor.service';
import { ILockLeaseContext } from '@core/common/functions/withLock';
import { injectable, inject } from 'tsyringe';

export interface IWorkerMonitorActivity {
  monitor(context: ILockLeaseContext): Promise<void>;
  monitorLiveness(context: ILockLeaseContext): Promise<void>;
}

@injectable()
export class WorkerMonitorActivity implements IWorkerMonitorActivity {
  constructor(
    @inject(WorkerMonitorService)
    private readonly workerMonitorService: WorkerMonitorService
  ) {}

  monitor = async (context: ILockLeaseContext): Promise<void> => {
    context.assertActive();
    await this.workerMonitorService.run(context);
  };

  monitorLiveness = async (context: ILockLeaseContext): Promise<void> => {
    context.assertActive();
    await this.workerMonitorService.runLiveness(context);
  };
}
