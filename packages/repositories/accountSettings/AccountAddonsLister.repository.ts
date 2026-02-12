import * as schema from '@core/models';
import { planCrossSellAccount, planAccount, planItems } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import { ListAccountAddonsResponse } from '@core/schema/accountSettings/listAccountAddons/response.schema';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';
import { UserTotalViewerRepository } from '@core/repositories/user/UserTotalViewer.repository';
import { RoleTotalViewerRepository } from '@core/repositories/role/RoleTotalViewer.repository';
import { AiAgentService } from '@core/services/aiAgent.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class AccountAddonsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(WorkerTotalViewerRepository)
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    @inject(UserTotalViewerRepository)
    private readonly userTotalViewerRepository: UserTotalViewerRepository,
    @inject(RoleTotalViewerRepository)
    private readonly roleTotalViewerRepository: RoleTotalViewerRepository,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService
  ) {}

  private readonly getQuantityUsed = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    if (planProductId === EPlanProduct.worker) {
      return this.workerTotalViewerRepository.totalWorkerByAccountId(accountId);
    }
    if (planProductId === EPlanProduct.user) {
      return this.userTotalViewerRepository.totalUserByAccount(accountId);
    }
    if (planProductId === EPlanProduct.role) {
      return this.roleTotalViewerRepository.totalRoleByAccount(accountId);
    }
    if (planProductId === EPlanProduct.ai_agent) {
      return this.aiAgentService.totalAiAgentByAccountId(accountId);
    }
    return 0;
  };

  private readonly getPlanQuantityForProduct = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    const planResult = await this.dbRo
      .select({
        quantity: planItems.quantity,
      })
      .from(planAccount)
      .innerJoin(planItems, eq(planItems.plan_id, planAccount.plan_id))
      .where(
        and(
          eq(planAccount.account_id, accountId),
          gt(planAccount.next_payment_date, sql`NOW()`),
          eq(planItems.plan_product_id, planProductId),
          isNull(planAccount.cancellation_date)
        )
      )
      .execute();

    if (!planResult?.length) {
      return 0;
    }

    return planResult[0].quantity;
  };

  listAccountAddons = async (
    accountId: string
  ): Promise<ListAccountAddonsResponse[]> => {
    const crossSells = await this.dbRo.query.planCrossSellAccount.findMany({
      where: and(
        eq(planCrossSellAccount.account_id, accountId),
        isNull(planCrossSellAccount.deleted_at)
      ),
      columns: {
        plan_cross_sell_account_id: true,
        plan_cross_sell_id: true,
      },
      with: {
        pca: {
          columns: {
            plan_cross_sell_id: true,
            quantity: true,
          },
          with: {
            ppt: {
              columns: {
                plan_product_id: true,
              },
              with: {
                ppd: {
                  columns: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!crossSells.length) {
      return [];
    }

    const results: ListAccountAddonsResponse[] = [];

    for (const crossSell of crossSells) {
      if (!crossSell.pca?.ppt?.plan_product_id || !crossSell.pca.ppt.ppd) {
        continue;
      }

      const planProductId = crossSell.pca.ppt.plan_product_id;
      const addonQuantity = crossSell.pca.quantity || 0;
      const planQuantity = await this.getPlanQuantityForProduct(
        accountId,
        planProductId
      );
      const quantityTotal = planQuantity + addonQuantity;
      const quantityUsed = await this.getQuantityUsed(accountId, planProductId);

      const source = planQuantity > 0 ? ('plan' as const) : ('addon' as const);

      results.push({
        plan_cross_sell_id: crossSell.plan_cross_sell_id,
        plan_product_id: planProductId,
        name: crossSell.pca.ppt.ppd.name || '',
        quantity_total: quantityTotal,
        quantity_used: quantityUsed,
        quantity_plan: planQuantity,
        quantity_addon: addonQuantity,
        source,
      });
    }

    return results;
  };
}
