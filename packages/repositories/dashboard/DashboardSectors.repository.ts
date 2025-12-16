import * as schema from '@core/models';
import { sector } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';

@injectable()
export class DashboardSectorsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  getSectorsDistribution = async (
    accountId: string
  ): Promise<
    Array<{ sectorId: string; sectorName: string; count: number }>
  > => {
    const allSectors = await this.db
      .select({
        sector_id: sector.sector_id,
        name: sector.name,
      })
      .from(sector)
      .where(
        and(
          eq(sector.account_id, accountId),
          isNull(sector.deleted_at),
          eq(sector.sector_status_id, ESectorStatus.active)
        )
      )
      .orderBy(asc(sector.name))
      .execute();

    const sectorCountPromises = allSectors.map(async (sectorItem) => {
      const queryElastic = {
        size: 0,
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: {
                      'account.id': accountId,
                    },
                  },
                },
              },
              {
                nested: {
                  path: 'sector',
                  query: {
                    term: {
                      'sector.id': sectorItem.sector_id,
                    },
                  },
                },
              },
            ],
            filter: [
              {
                term: {
                  status: EChatStatus.closed,
                },
              },
            ],
          },
        },
      };

      const result = await this.elasticDatabaseService.select(
        EElasticIndex.chat,
        queryElastic
      );

      const total = result?.hits?.total;
      const count = typeof total === 'number' ? total : (total?.value ?? 0);

      return {
        sectorId: sectorItem.sector_id,
        sectorName: sectorItem.name,
        count,
      };
    });

    const sectors = await Promise.all(sectorCountPromises);

    const noSectorQuery = {
      size: 0,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                status: EChatStatus.closed,
              },
            },
            {
              bool: {
                must_not: {
                  exists: {
                    field: 'sector',
                  },
                },
              },
            },
          ],
        },
      },
    };

    const noSectorResult = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      noSectorQuery
    );

    const noSectorTotal = noSectorResult?.hits?.total;
    const noSectorCount =
      typeof noSectorTotal === 'number'
        ? noSectorTotal
        : (noSectorTotal?.value ?? 0);

    if (noSectorCount > 0) {
      sectors.push({
        sectorId: 'no-sector',
        sectorName: 'Sem Setor',
        count: noSectorCount,
      });
    }

    return sectors;
  };
}
