import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { HolidayService } from '@core/services/holiday.service';
import { CreateLocalHolidayRequest } from '@core/schema/chatbot/createLocalHoliday/request.schema';

@injectable()
export class LocalHolidayCreatorUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(HolidayService)
    private readonly holidayService: HolidayService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateLocalHolidayRequest
  ): Promise<string> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const createdId = await this.holidayService.createLocalHoliday(
      accountId,
      input
    );

    if (!createdId) {
      throw new Error(t('chatbot_holiday_create_error'));
    }

    return createdId;
  }
}
