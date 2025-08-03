import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { CreateSectorResponse } from '@core/schema/sector/createSector/response.schema';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class SectorCreatorUseCase {
  constructor(
    private readonly sectorService: SectorService,
    private readonly accountService: AccountService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateSectorRequest
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const sectorStatusExists = await this.sectorService.existsSectorStatusById(
      input.sector_status_id
    );
    if (!sectorStatusExists) {
      throw new Error(t('sector_status_not_found'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateSectorRequest,
    accountId: string
  ): Promise<CreateSectorResponse | null> {
    await this.validate(t, accountId, input);

    const sectorCreator = await this.sectorService.createSector(
      input,
      accountId
    );

    if (!sectorCreator) {
      throw new Error(t('sector_creator_error'));
    }

    return sectorCreator;
  }
}
