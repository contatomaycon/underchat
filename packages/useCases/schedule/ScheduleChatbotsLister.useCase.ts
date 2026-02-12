import { injectable, inject } from 'tsyringe';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleChatbotsFinalResponse } from '@core/schema/schedule/listScheduleChatbots/response.schema';

@injectable()
export class ScheduleChatbotsListerUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(accountId: string): Promise<ListScheduleChatbotsFinalResponse> {
    return this.scheduleService.listScheduleChatbots(accountId);
  }
}
