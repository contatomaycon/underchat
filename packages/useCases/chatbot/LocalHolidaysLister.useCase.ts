import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { HolidayService } from '@core/services/holiday.service';
import { ListLocalHolidaysResponse } from '@core/schema/chatbot/listLocalHolidays/response.schema';

@injectable()
export class LocalHolidaysListerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(HolidayService)
    private readonly holidayService: HolidayService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListLocalHolidaysResponse> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const holidays = await this.holidayService.listLocalHolidays(accountId);

    return holidays.map((holiday) => ({
      ...holiday,
      scope: holiday.scope as 'state' | 'municipal',
    }));
  }
}
