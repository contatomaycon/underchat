import { WorkerMonitorService } from '@core/services/workerMonitor.service';
import { injectable, inject } from 'tsyringe';

export interface IWorkerMonitorActivity {
  monitor(): Promise<void>;
}

@injectable()
export class WorkerMonitorActivity implements IWorkerMonitorActivity {
  constructor(
    @inject(WorkerMonitorService)
    private readonly workerMonitorService: WorkerMonitorService
  ) {}

  monitor = async (): Promise<void> => {
    await this.workerMonitorService.run();
  };
}
