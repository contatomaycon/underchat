import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { CreateSectorResponse } from '@core/schema/sector/createSector/response.schema';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class SectorCreatorUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateSectorRequest,
    accountId: string
  ): Promise<CreateSectorResponse | null> {
    await this.validate(t, accountId);

    const sectorCreator = await this.sectorService.createSector(
      t,
      input,
      accountId
    );

    if (!sectorCreator) {
      throw new Error(t('sector_creator_error'));
    }

    return sectorCreator;
  }
}
