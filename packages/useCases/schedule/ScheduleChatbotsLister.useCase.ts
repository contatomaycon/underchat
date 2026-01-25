import { injectable } from 'tsyringe';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleChatbotsFinalResponse } from '@core/schema/schedule/listScheduleChatbots/response.schema';

@injectable()
export class ScheduleChatbotsListerUseCase {
  constructor(private readonly scheduleService: ScheduleService) {}

  async execute(accountId: string): Promise<ListScheduleChatbotsFinalResponse> {
    return this.scheduleService.listScheduleChatbots(accountId);
  }
}
