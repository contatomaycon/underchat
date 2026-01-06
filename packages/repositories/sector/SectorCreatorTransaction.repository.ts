import { ESectorStatus } from '@core/common/enums/ESectorStatus';
import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { CreateSectorResponse } from '@core/schema/sector/createSector/response.schema';
import { v7 as uuidv7 } from 'uuid';
import { SectorRoleCreatorRepository } from './SectorRoleCreator.repository';

@injectable()
export class SectorCreatorTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly sectorRoleCreatorRepository: SectorRoleCreatorRepository
  ) {}

  createSector = async (
    t: TFunction<'translation', undefined>,
    input: CreateSectorRequest,
    accountId: string
  ): Promise<CreateSectorResponse | null> => {
    return this.dbRw.transaction(async (tx) => {
      const sectorId = uuidv7();

      const result = await tx
        .insert(sector)
        .values({
          sector_id: sectorId,
          sector_status_id: ESectorStatus.active,
          account_id: accountId,
          name: input.name,
          color: input.color,
        })
        .returning();

      if (!result?.length) {
        throw new Error(t('sector_creator_error'));
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

      return { sector_id: result[0].sector_id };
    });
  };
}
