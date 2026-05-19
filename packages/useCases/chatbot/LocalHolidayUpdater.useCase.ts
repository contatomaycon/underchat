import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { HolidayService } from '@core/services/holiday.service';
import { CreateLocalHolidayRequest } from '@core/schema/chatbot/createLocalHoliday/request.schema';

@injectable()
export class LocalHolidayUpdaterUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(HolidayService)
    private readonly holidayService: HolidayService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatbotHolidayId: string,
    input: CreateLocalHolidayRequest
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const updated = await this.holidayService.updateLocalHoliday(
      accountId,
      chatbotHolidayId,
      input
    );

    if (!updated) {
      throw new Error(t('chatbot_holiday_update_error'));
    }

    return true;
  }
}
