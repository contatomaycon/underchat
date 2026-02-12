import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListReportConversationHistorySectorsResponse } from '@core/schema/reportConversationHistory/listReportConversationHistorySectors/response.schema';
import { SectorService } from '@core/services/sector.service';
import { AccountService } from '@core/services/account.service';

@injectable()
export class ReportConversationHistorySectorsListerUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListReportConversationHistorySectorsResponse> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const sectors = await this.sectorService.listAllSectorsForReport(accountId);

    return {
      sectors,
    };
  }
}
