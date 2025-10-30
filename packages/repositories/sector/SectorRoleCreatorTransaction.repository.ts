import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { SectorRoleDeleterRepository } from './SectorRoleDeleter.repository';
import { SectorRoleCreatorRepository } from './SectorRoleCreator.repository';
import { CreateSectorRoleRequest } from '@core/schema/sector/createSectorRole/request.schema';

@injectable()
export class SectorRoleTransactionCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly sectorRoleDeleterRepository: SectorRoleDeleterRepository,
    private readonly sectorRoleCreatorRepository: SectorRoleCreatorRepository
  ) {}

  createSectorRole = async (
    t: TFunction<'translation', undefined>,
    sectorId: string,
    input: CreateSectorRoleRequest
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      const deleteSectorRole =
        await this.sectorRoleDeleterRepository.deleteSectorRoleById(
          tx,
          sectorId
        );

      if (!deleteSectorRole) {
        throw new Error(t('sector_role_deleted_failed'));
      }

      await Promise.all(
        input.permission_role_id.map((permissionRoleId) =>
          this.sectorRoleCreatorRepository.createSectorRole(
            tx,
            sectorId,
            permissionRoleId
          )
        )
      );
    });
    return true;
  };
}
