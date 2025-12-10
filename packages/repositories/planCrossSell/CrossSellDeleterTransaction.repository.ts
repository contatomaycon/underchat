import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { CrossSellAccountDeleterRepository } from './CrossSellAccountDeleter.repository';
import { CrossSellAccountViewerExistsRepository } from './CrossSellAccountViewerExists.repository';
import { CrossSellDeleterRepository } from './CrossSellDeleter.repository';

@injectable()
export class CrossSellDeleterTransactionRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly crossSellAccountDeleterRepository: CrossSellAccountDeleterRepository,
    private readonly crossSellDeleterRepository: CrossSellDeleterRepository,
    private readonly crossSellAccountViewerExistsRepository: CrossSellAccountViewerExistsRepository
  ) {}

  deleteCrossSell = async (
    t: TFunction<'translation', undefined>,
    crossSellId: string
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      const existsCrossSellAccounts =
        await this.crossSellAccountViewerExistsRepository.existsCrossSellAccountsByCrossSellId(
          tx,
          crossSellId
        );

      if (existsCrossSellAccounts) {
        const crossSellAccountsDeleted =
          await this.crossSellAccountDeleterRepository.deleteCrossSellAccountsByCrossSellId(
            tx,
            crossSellId
          );

        if (!crossSellAccountsDeleted) {
          throw new Error(t('cross_sell_accounts_deleter_error'));
        }
      }

      const crossSellDeleted =
        await this.crossSellDeleterRepository.deleteCrossSellById(
          tx,
          crossSellId
        );

      if (!crossSellDeleted) {
        throw new Error(t('cross_sell_deleter_error'));
      }
    });

    return true;
  };
}
