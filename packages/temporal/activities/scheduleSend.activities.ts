import { ScheduleSendService } from '@core/services/scheduleSend.service';
import { injectable, inject } from 'tsyringe';

export interface IScheduleSendActivity {
  processScheduleSends(): Promise<void>;
}

@injectable()
export class ScheduleSendActivity implements IScheduleSendActivity {
  constructor(
    @inject(ScheduleSendService)
    private readonly scheduleSendService: ScheduleSendService
  ) {}

  processScheduleSends = async (): Promise<void> => {
    await this.scheduleSendService.processSchedules();
  };
}
