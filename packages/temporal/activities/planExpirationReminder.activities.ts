import { PlanExpirationReminderService } from '@core/services/planExpirationReminder.service';
import { container } from 'tsyringe';

export interface IPlanExpirationReminderActivity {
  processPlanExpirationReminders(): Promise<void>;
}

export async function processPlanExpirationReminders(): Promise<void> {
  const planExpirationReminderService = container.resolve(
    PlanExpirationReminderService
  );

  await planExpirationReminderService.processExpirationReminders();
}
