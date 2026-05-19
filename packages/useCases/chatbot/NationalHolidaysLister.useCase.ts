import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { HolidayService } from '@core/services/holiday.service';
import { ListNationalHolidaysResponse } from '@core/schema/chatbot/listNationalHolidays/response.schema';

@injectable()
export class NationalHolidaysListerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(HolidayService)
    private readonly holidayService: HolidayService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    year: number
  ): Promise<ListNationalHolidaysResponse> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    return this.holidayService.listNationalHolidays(year);
  }
}
