import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { SectorUserCreatorRepository } from '../sector/SectorUserCreator.repository';
import { SectorUserUpdaterRepository } from '../sector/SectorUserUpdater.repository';
import { eq } from 'drizzle-orm';

@injectable()
export class UserSectorsUpdaterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(SectorUserCreatorRepository)
    private readonly sectorUserCreatorRepository: SectorUserCreatorRepository,
    @inject(SectorUserUpdaterRepository)
    private readonly sectorUserUpdaterRepository: SectorUserUpdaterRepository
  ) {}

  updateUserSectors = async (
    t: TFunction<'translation', undefined>,
    userId: string,
    sectorIds: string[]
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const currentSectorIds =
        await this.sectorUserUpdaterRepository.listUserSectorsInTransaction(
          tx,
          userId
        );

      const allUserSectors = await tx
        .select({
          sector_id: schema.sectorUser.sector_id,
          deleted_at: schema.sectorUser.deleted_at,
        })
        .from(schema.sectorUser)
        .where(eq(schema.sectorUser.user_id, userId))
        .execute();

      const sectorsToRestore = sectorIds.filter((id) => {
        const existing = allUserSectors.find((s) => s.sector_id === id);
        return existing && existing.deleted_at !== null;
      });

      const sectorsToAdd = sectorIds.filter((id) => {
        const existing = allUserSectors.find((s) => s.sector_id === id);
        return !existing;
      });

      const sectorsToRemove = currentSectorIds.filter(
        (id) => !sectorIds.includes(id)
      );

      if (sectorsToRemove.length > 0) {
        await this.sectorUserUpdaterRepository.markSectorUsersAsDeletedInTransaction(
          tx,
          userId,
          sectorsToRemove
        );
      }

      if (sectorsToRestore.length > 0) {
        await this.sectorUserUpdaterRepository.restoreSectorUsersInTransaction(
          tx,
          userId,
          sectorsToRestore
        );
      }

      if (sectorsToAdd.length > 0) {
        await Promise.all(
          sectorsToAdd.map((sectorId) =>
            this.sectorUserCreatorRepository.createSectorUserInTransaction(
              tx,
              userId,
              sectorId
            )
          )
        );
      }

      return true;
    });
  };
}
