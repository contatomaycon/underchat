import { ScheduleSendService } from '@core/services/scheduleSend.service';
import { injectable } from 'tsyringe';

export interface IScheduleSendActivity {
  processScheduleSends(): Promise<void>;
}

@injectable()
export class ScheduleSendActivity implements IScheduleSendActivity {
  constructor(private readonly scheduleSendService: ScheduleSendService) {}

  processScheduleSends = async (): Promise<void> => {
    await this.scheduleSendService.processSchedules();
  };
}
