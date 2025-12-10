import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { PlanItemsDeleterRepository } from './PlanItemsDeleter.repository';
import { PlanItemsViewerExistsRepository } from './PlanItemsViewerExists.repository';
import { PlanDeleterRepository } from './PlanDeleter.repository';

@injectable()
export class PlanDeleterTransactionRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly planItemsDeleterRepository: PlanItemsDeleterRepository,
    private readonly planDeleterRepository: PlanDeleterRepository,
    private readonly planItemsViewerExistsRepository: PlanItemsViewerExistsRepository
  ) {}

  deletePlan = async (
    t: TFunction<'translation', undefined>,
    planId: string
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      const existsPlanItems =
        await this.planItemsViewerExistsRepository.existsPlanItemsByPlanId(
          tx,
          planId
        );

      if (existsPlanItems) {
        const planItemsDeleted =
          await this.planItemsDeleterRepository.deletePlanItemsByPlanId(
            tx,
            planId
          );

        if (!planItemsDeleted) {
          throw new Error(t('plan_items_deleter_error'));
        }
      }

      const planDeleted = await this.planDeleterRepository.deletePlanById(
        tx,
        planId
      );

      if (!planDeleted) {
        throw new Error(t('plan_deleter_error'));
      }
    });

    return true;
  };
}
