import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { HolidayService } from '@core/services/holiday.service';

@injectable()
export class LocalHolidayDeleterUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(HolidayService)
    private readonly holidayService: HolidayService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatbotHolidayId: string
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const deleted = await this.holidayService.deleteLocalHoliday(
      accountId,
      chatbotHolidayId
    );

    if (!deleted) {
      throw new Error(t('chatbot_holiday_delete_error'));
    }

    return true;
  }
}
