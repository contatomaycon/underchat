import { PlanExpirationReminderService } from '@core/services/planExpirationReminder.service';
import { injectable, inject } from 'tsyringe';

export interface IPlanExpirationReminderActivity {
  processPlanExpirationReminders(): Promise<void>;
}

@injectable()
export class PlanExpirationReminderActivity implements IPlanExpirationReminderActivity {
  constructor(
    @inject(PlanExpirationReminderService)
    private readonly planExpirationReminderService: PlanExpirationReminderService
  ) {}

  processPlanExpirationReminders = async (): Promise<void> => {
    await this.planExpirationReminderService.processExpirationReminders();
  };
}
