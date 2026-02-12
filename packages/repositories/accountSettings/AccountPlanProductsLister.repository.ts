import * as schema from '@core/models';
import { planAccount, planCrossSellAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import { ListAccountPlanProductsResponse } from '@core/schema/accountSettings/listAccountPlanProducts/response.schema';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';
import { UserTotalViewerRepository } from '@core/repositories/user/UserTotalViewer.repository';
import { RoleTotalViewerRepository } from '@core/repositories/role/RoleTotalViewer.repository';
import { DashboardStatsRepository } from '@core/repositories/dashboard/DashboardStats.repository';
import { DashboardSchedulesRepository } from '@core/repositories/dashboard/DashboardSchedules.repository';
import { DashboardChatbotsRepository } from '@core/repositories/dashboard/DashboardChatbots.repository';
import { AccountInfoViewerExistsRepository } from '@core/repositories/account/AccountInfoViewerExists.repository';
import { AiAgentService } from '@core/services/aiAgent.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class AccountPlanProductsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(WorkerTotalViewerRepository)
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    @inject(UserTotalViewerRepository)
    private readonly userTotalViewerRepository: UserTotalViewerRepository,
    @inject(RoleTotalViewerRepository)
    private readonly roleTotalViewerRepository: RoleTotalViewerRepository,
    @inject(DashboardStatsRepository)
    private readonly dashboardStatsRepository: DashboardStatsRepository,
    @inject(DashboardSchedulesRepository)
    private readonly dashboardSchedulesRepository: DashboardSchedulesRepository,
    @inject(DashboardChatbotsRepository)
    private readonly dashboardChatbotsRepository: DashboardChatbotsRepository,
    @inject(AccountInfoViewerExistsRepository)
    private readonly accountInfoViewerExistsRepository: AccountInfoViewerExistsRepository,
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
      const total =
        await this.userTotalViewerRepository.totalUserByAccount(accountId);
      return total > 0 ? total - 1 : 0;
    }
    if (planProductId === EPlanProduct.role) {
      return this.roleTotalViewerRepository.totalRoleByAccount(accountId);
    }
    if (planProductId === EPlanProduct.contact) {
      return this.dashboardStatsRepository.getContactsTotal(accountId);
    }
    if (planProductId === EPlanProduct.mass_sending) {
      return this.dashboardSchedulesRepository.getSchedulesSent(accountId);
    }
    if (planProductId === EPlanProduct.chatbot) {
      return this.dashboardChatbotsRepository.getChatbotsTotal(accountId);
    }
    if (planProductId === EPlanProduct.personalization) {
      return this.accountInfoViewerExistsRepository.totalAccountInfoByAccountId(
        accountId
      );
    }
    if (planProductId === EPlanProduct.ai_agent) {
      return this.aiAgentService.totalAiAgentByAccountId(accountId);
    }
    return 0;
  };

  private readonly fetchPlanItems = async (accountId: string) => {
    const planAccountResult = await this.dbRo.query.planAccount.findFirst({
      where: and(
        eq(planAccount.account_id, accountId),
        gt(planAccount.next_payment_date, sql`NOW()`),
        isNull(planAccount.cancellation_date)
      ),
      columns: {
        plan_account_id: true,
        plan_id: true,
      },
      with: {
        ppl: {
          columns: {
            plan_id: true,
          },
          with: {
            ppi: {
              columns: {
                plan_item_id: true,
                plan_product_id: true,
                quantity: true,
                deleted_at: true,
              },
              with: {
                ppr: {
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
        },
      },
    });

    return (
      planAccountResult?.ppl?.ppi?.filter(
        (item) => item.plan_item_id && !item.deleted_at && item.ppr?.ppd
      ) || []
    );
  };

  private readonly fetchCrossSells = async (accountId: string) => {
    return this.dbRo.query.planCrossSellAccount.findMany({
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
  };

  private readonly buildProductsMap = (
    planItemsResult: Awaited<ReturnType<typeof this.fetchPlanItems>>,
    crossSellsResult: Awaited<ReturnType<typeof this.fetchCrossSells>>
  ) => {
    const productsMap = new Map<
      string,
      {
        plan_product_id: string;
        name: string;
        quantity_plan: number;
        quantity_addon: number;
      }
    >();

    for (const planItem of planItemsResult) {
      if (!planItem.ppr?.plan_product_id || !planItem.ppr.ppd) {
        continue;
      }

      const planProductId = planItem.ppr.plan_product_id;
      const productName = planItem.ppr.ppd.name || '';

      const existing = productsMap.get(planProductId);
      if (existing) {
        existing.quantity_plan += planItem.quantity;
      } else {
        productsMap.set(planProductId, {
          plan_product_id: planProductId,
          name: productName,
          quantity_plan: planItem.quantity,
          quantity_addon: 0,
        });
      }
    }

    for (const crossSell of crossSellsResult) {
      if (!crossSell.pca?.ppt?.plan_product_id || !crossSell.pca.ppt.ppd) {
        continue;
      }

      const planProductId = crossSell.pca.ppt.plan_product_id;
      const addonQuantity = crossSell.pca.quantity || 0;
      const productName = crossSell.pca.ppt.ppd.name || '';

      const existing = productsMap.get(planProductId);
      if (existing) {
        existing.quantity_addon += addonQuantity;
      } else {
        productsMap.set(planProductId, {
          plan_product_id: planProductId,
          name: productName,
          quantity_plan: 0,
          quantity_addon: addonQuantity,
        });
      }
    }

    return productsMap;
  };

  private readonly buildResponse = async (
    accountId: string,
    productsMap: ReturnType<typeof this.buildProductsMap>
  ): Promise<ListAccountPlanProductsResponse[]> => {
    const results: ListAccountPlanProductsResponse[] = [];

    for (const [planProductId, product] of productsMap) {
      const quantityTotal = product.quantity_plan + product.quantity_addon;
      const quantityUsed = await this.getQuantityUsed(accountId, planProductId);
      const source =
        product.quantity_plan > 0 ? ('plan' as const) : ('addon' as const);

      results.push({
        plan_product_id: planProductId,
        name: product.name,
        quantity_total: quantityTotal,
        quantity_used: quantityUsed,
        quantity_plan: product.quantity_plan,
        quantity_addon: product.quantity_addon,
        source,
      });
    }

    return results;
  };

  listAccountPlanProducts = async (
    accountId: string
  ): Promise<ListAccountPlanProductsResponse[]> => {
    const [planItemsResult, crossSellsResult] = await Promise.all([
      this.fetchPlanItems(accountId),
      this.fetchCrossSells(accountId),
    ]);

    const productsMap = this.buildProductsMap(
      planItemsResult,
      crossSellsResult
    );

    return this.buildResponse(accountId, productsMap);
  };
}
