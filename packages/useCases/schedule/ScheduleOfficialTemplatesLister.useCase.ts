import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ScheduleOfficialMessageService } from '@core/services/scheduleOfficialMessage.service';
import { ScheduleOfficialTemplatesRequest } from '@core/schema/schedule/officialTemplates/request.schema';
import { ScheduleOfficialTemplatesResponse } from '@core/schema/schedule/officialTemplates/response.schema';

@injectable()
export class ScheduleOfficialTemplatesListerUseCase {
  constructor(
    @inject(ScheduleOfficialMessageService)
    private readonly scheduleOfficialMessageService: ScheduleOfficialMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: ScheduleOfficialTemplatesRequest,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ScheduleOfficialTemplatesResponse> {
    return this.scheduleOfficialMessageService.listApprovedTemplatesForWorker({
      t,
      accountId,
      workerId: input.worker_id,
      userChannels,
    });
  }
}
