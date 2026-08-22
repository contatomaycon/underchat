import 'reflect-metadata';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { AccountPlanProductsListerRepository } from '@core/repositories/accountSettings/AccountPlanProductsLister.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

jest.mock('@core/repositories/dashboard/DashboardStats.repository', () => ({
  DashboardStatsRepository: class DashboardStatsRepository {},
}));

jest.mock('@core/repositories/dashboard/DashboardSchedules.repository', () => ({
  DashboardSchedulesRepository: class DashboardSchedulesRepository {},
}));

jest.mock('@core/repositories/dashboard/DashboardChatbots.repository', () => ({
  DashboardChatbotsRepository: class DashboardChatbotsRepository {},
}));

describe('AccountPlanProductsListerRepository', () => {
  it('returns empty array when there are no plan items and cross sells', async () => {
    const repository = new AccountPlanProductsListerRepository(
      {
        query: {
          planAccount: {
            findFirst: jest.fn(async () => null),
          },
          planCrossSellAccount: {
            findMany: jest.fn(async () => []),
          },
        },
      } as never,
      {
        totalWorkerByAccountId: jest.fn(async () => 0),
      } as never,
      {
        totalUserByAccount: jest.fn(async () => 0),
      } as never,
      {
        totalRoleByAccount: jest.fn(async () => 0),
      } as never,
      {
        getContactsTotal: jest.fn(async () => 0),
      } as never,
      {
        getSchedulesSent: jest.fn(async () => 0),
      } as never,
      {
        getChatbotsTotal: jest.fn(async () => 0),
      } as never,
      {
        totalAccountInfoByAccountId: jest.fn(async () => 0),
      } as never,
      {
        totalAiAgentByAccountId: jest.fn(async () => 0),
      } as never
    );

    await expect(repository.listAccountPlanProducts('acc-1')).resolves.toEqual(
      []
    );
  });

  it('maps products from plan items and addons with quantity used by product type', async () => {
    const repository = new AccountPlanProductsListerRepository(
      {
        query: {
          planAccount: {
            findFirst: jest.fn(async () => ({
              ppl: {
                ppi: [
                  {
                    plan_item_id: 'item-1',
                    quantity: 2,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.worker,
                      ppd: { name: 'Workers' },
                    },
                  },
                  {
                    plan_item_id: 'item-2',
                    quantity: 1,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.user,
                      ppd: { name: 'Users' },
                    },
                  },
                  {
                    plan_item_id: 'item-3',
                    quantity: 1,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.role,
                      ppd: { name: 'Roles' },
                    },
                  },
                  {
                    plan_item_id: 'item-4',
                    quantity: 5,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.contact,
                      ppd: { name: 'Contacts' },
                    },
                  },
                  {
                    plan_item_id: 'item-5',
                    quantity: 6,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.mass_sending,
                      ppd: { name: 'Mass Sending' },
                    },
                  },
                  {
                    plan_item_id: 'item-6',
                    quantity: 3,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.chatbot,
                      ppd: { name: 'Chatbots' },
                    },
                  },
                  {
                    plan_item_id: 'item-7',
                    quantity: 1,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.personalization,
                      ppd: { name: 'Personalization' },
                    },
                  },
                  {
                    plan_item_id: 'item-8',
                    quantity: 4,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.ai_agent,
                      ppd: { name: 'AI Agent' },
                    },
                  },
                  {
                    plan_item_id: 'item-9',
                    quantity: 8,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.integration,
                      ppd: { name: 'Integration' },
                    },
                  },
                  {
                    plan_item_id: 'item-invalid',
                    quantity: 1,
                    deleted_at: '2026-01-01',
                    ppr: {
                      plan_product_id: 'invalid',
                      ppd: { name: 'Invalid' },
                    },
                  },
                ],
              },
            })),
          },
          planCrossSellAccount: {
            findMany: jest.fn(async () => [
              {
                pca: {
                  quantity: 1,
                  ppt: {
                    plan_product_id: EPlanProduct.worker,
                    ppd: { name: 'Workers' },
                  },
                },
              },
              {
                pca: {
                  quantity: 2,
                  ppt: {
                    plan_product_id: 'unknown-product',
                    ppd: { name: 'Other' },
                  },
                },
              },
              {
                pca: {
                  quantity: 4,
                  ppt: {
                    plan_product_id: EPlanProduct.integration,
                    ppd: { name: 'Integration' },
                  },
                },
              },
            ]),
          },
        },
      } as never,
      {
        totalWorkerByAccountId: jest.fn(async () => 7),
      } as never,
      {
        totalUserByAccount: jest.fn(async () => 5),
      } as never,
      {
        totalRoleByAccount: jest.fn(async () => 4),
      } as never,
      {
        getContactsTotal: jest.fn(async () => 30),
      } as never,
      {
        getSchedulesSent: jest.fn(async () => 40),
      } as never,
      {
        getChatbotsTotal: jest.fn(async () => 2),
      } as never,
      {
        totalAccountInfoByAccountId: jest.fn(async () => 1),
      } as never,
      {
        totalAiAgentByAccountId: jest.fn(async () => 9),
      } as never
    );

    const result = await repository.listAccountPlanProducts('acc-1');

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan_product_id: EPlanProduct.worker,
          quantity_plan: 2,
          quantity_addon: 1,
          quantity_total: 3,
          quantity_used: 7,
          source: 'plan',
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.user,
          quantity_plan: 1,
          quantity_addon: 0,
          quantity_total: 1,
          quantity_used: 4,
          source: 'plan',
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.role,
          quantity_used: 4,
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.contact,
          quantity_used: 30,
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.mass_sending,
          quantity_used: 40,
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.chatbot,
          quantity_used: 2,
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.personalization,
          quantity_used: 1,
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.ai_agent,
          quantity_used: 9,
        }),
        expect.objectContaining({
          plan_product_id: EPlanProduct.integration,
          quantity_plan: 1,
          quantity_addon: 1,
          quantity_total: 1,
          quantity_used: 1,
          source: 'plan',
        }),
        expect.objectContaining({
          plan_product_id: 'unknown-product',
          quantity_plan: 0,
          quantity_addon: 2,
          quantity_total: 2,
          quantity_used: 0,
          source: 'addon',
        }),
      ])
    );
  });

  it('uses zero when total users is not greater than zero', async () => {
    const repository = new AccountPlanProductsListerRepository(
      {
        query: {
          planAccount: {
            findFirst: jest.fn(async () => ({
              ppl: {
                ppi: [
                  {
                    plan_item_id: 'item-user',
                    quantity: 1,
                    deleted_at: null,
                    ppr: {
                      plan_product_id: EPlanProduct.user,
                      ppd: { name: 'Users' },
                    },
                  },
                ],
              },
            })),
          },
          planCrossSellAccount: {
            findMany: jest.fn(async () => []),
          },
        },
      } as never,
      {
        totalWorkerByAccountId: jest.fn(async () => 0),
      } as never,
      {
        totalUserByAccount: jest.fn(async () => 0),
      } as never,
      {
        totalRoleByAccount: jest.fn(async () => 0),
      } as never,
      {
        getContactsTotal: jest.fn(async () => 0),
      } as never,
      {
        getSchedulesSent: jest.fn(async () => 0),
      } as never,
      {
        getChatbotsTotal: jest.fn(async () => 0),
      } as never,
      {
        totalAccountInfoByAccountId: jest.fn(async () => 0),
      } as never,
      {
        totalAiAgentByAccountId: jest.fn(async () => 0),
      } as never
    );

    const result = await repository.listAccountPlanProducts('acc-1');
    expect(result).toEqual([
      expect.objectContaining({
        plan_product_id: EPlanProduct.user,
        quantity_used: 0,
      }),
    ]);
  });
});
