import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { SectorService } from '@core/services/sector.service';
import { CreateSectorRoleRequest } from '@core/schema/sector/createSectorRole/request.schema';
import { PermissionService } from '@core/services/permission.service';

@injectable()
export class SectorRoleCreatorUseCase {
  constructor(
    private readonly sectorService: SectorService,
    private readonly accountService: AccountService,
    private readonly permissionService: PermissionService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateSectorRoleRequest,
    sectorId: string
  ): Promise<void> {
    const sectorExists = await this.sectorService.sectorByIdExists(
      sectorId,
      accountId
    );

    if (!sectorExists) {
      throw new Error(t('sector_not_found'));
    }

    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const countRolesSector = await this.permissionService.countRolesSector(
      accountId,
      input
    );

    if (!countRolesSector) {
      throw new Error(t('permission_role_count_sector_incompatible'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    sectorId: string,
    input: CreateSectorRoleRequest,
    accountId: string
  ): Promise<boolean> {
    await this.validate(t, accountId, input, sectorId);

    const sectorRoleCreator = await this.sectorService.createSectorRole(
      t,
      sectorId,
      input
    );

    if (!sectorRoleCreator) {
      throw new Error(t('sector_role_creator_error'));
    }

    return sectorRoleCreator;
  }
}
