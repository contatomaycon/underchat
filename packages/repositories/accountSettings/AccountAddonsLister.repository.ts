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
    if (planProductId === EPlanProduct.internal_chat) {
      return 1;
    }
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
        cancellation_date: true,
      },
      with: {
        pca: {
          columns: {
            plan_cross_sell_id: true,
            quantity: true,
            price: true,
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

    const addonTotalByProduct = new Map<string, number>();

    for (const crossSell of crossSells) {
      if (!crossSell.pca?.ppt?.plan_product_id) {
        continue;
      }

      const productId = crossSell.pca.ppt.plan_product_id;
      const current = addonTotalByProduct.get(productId) || 0;
      addonTotalByProduct.set(
        productId,
        current + (crossSell.pca.quantity || 0)
      );
    }

    const planQuantityByProduct = new Map<string, number>();
    const quantityUsedByProduct = new Map<string, number>();
    const results: ListAccountAddonsResponse[] = [];

    for (const crossSell of crossSells) {
      if (!crossSell.pca?.ppt?.plan_product_id || !crossSell.pca.ppt.ppd) {
        continue;
      }

      const planProductId = crossSell.pca.ppt.plan_product_id;
      const isBooleanProduct = planProductId === EPlanProduct.internal_chat;
      const addonQuantityRaw = crossSell.pca.quantity || 0;
      const addonQuantity = isBooleanProduct
        ? addonQuantityRaw > 0
          ? 1
          : 0
        : addonQuantityRaw;
      const planQuantityRaw = planQuantityByProduct.has(planProductId)
        ? planQuantityByProduct.get(planProductId) || 0
        : await this.getPlanQuantityForProduct(accountId, planProductId);
      if (!planQuantityByProduct.has(planProductId)) {
        planQuantityByProduct.set(planProductId, planQuantityRaw);
      }
      const planQuantity = isBooleanProduct
        ? planQuantityRaw > 0
          ? 1
          : 0
        : planQuantityRaw;

      const quantityUsedRaw = quantityUsedByProduct.has(planProductId)
        ? quantityUsedByProduct.get(planProductId) || 0
        : await this.getQuantityUsed(accountId, planProductId);
      if (!quantityUsedByProduct.has(planProductId)) {
        quantityUsedByProduct.set(planProductId, quantityUsedRaw);
      }
      const totalAddonQuantityRaw = addonTotalByProduct.get(planProductId) || 0;
      const totalAddonQuantity = isBooleanProduct
        ? totalAddonQuantityRaw > 0
          ? 1
          : 0
        : totalAddonQuantityRaw;
      const quantityTotal = isBooleanProduct
        ? planQuantity > 0 || totalAddonQuantity > 0
          ? 1
          : 0
        : planQuantity + totalAddonQuantity;
      const quantityUsed =
        isBooleanProduct && quantityTotal > 0 ? 1 : quantityUsedRaw;

      const source = planQuantity > 0 ? ('plan' as const) : ('addon' as const);

      results.push({
        plan_cross_sell_account_id: crossSell.plan_cross_sell_account_id,
        plan_cross_sell_id: crossSell.plan_cross_sell_id,
        plan_product_id: planProductId,
        name: crossSell.pca.ppt.ppd.name || '',
        quantity: addonQuantity,
        price: Number(crossSell.pca.price),
        price_per_cycle: Number(crossSell.pca.price),
        cancellation_date: crossSell.cancellation_date || null,
        renewal_status: crossSell.cancellation_date
          ? 'scheduled_cancellation'
          : 'active',
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
