import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { EditSectorParamsBody } from '@core/schema/sector/editSector/request.schema';
import { SectorRoleDeleterRepository } from './SectorRoleDeleter.repository';
import { SectorRoleCreatorRepository } from './SectorRoleCreator.repository';

@injectable()
export class SectorUpdaterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly sectorRoleDeleterRepository: SectorRoleDeleterRepository,
    private readonly sectorRoleCreatorRepository: SectorRoleCreatorRepository
  ) {}

  private updateInput(
    input: EditSectorParamsBody
  ): Partial<typeof sector.$inferInsert> {
    const inputUpdate: Partial<typeof sector.$inferInsert> = {};

    if (input.sector_status_id) {
      inputUpdate.sector_status_id = input.sector_status_id;
    }

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if (input.color) {
      inputUpdate.color = input.color;
    }

    return inputUpdate;
  }

  updateSectorById = async (
    t: TFunction<'translation', undefined>,
    sectorId: string,
    input: EditSectorParamsBody,
    accountId: string
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const updateInput = this.updateInput(input);

      if (Object.keys(updateInput).length === 0 && !input.permission_role_id) {
        throw new Error(t('sector_update_error'));
      }

      if (Object.keys(updateInput).length > 0) {
        const result = await tx
          .update(sector)
          .set(updateInput)
          .where(
            and(
              eq(sector.sector_id, sectorId),
              eq(sector.account_id, accountId)
            )
          )
          .execute();

        if ((result.rowCount ?? 0) === 0) {
          throw new Error(t('sector_update_error'));
        }
      }

      if (input.permission_role_id && input.permission_role_id.length > 0) {
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
      }

      return true;
    });
  };
}
