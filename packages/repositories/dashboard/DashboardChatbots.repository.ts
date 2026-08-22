import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { EChatbotStatus } from '@core/common/enums/EChatbotStatus';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq } from 'drizzle-orm';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class DashboardChatbotsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(AccountQuantityProductViewerRepository)
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository
  ) {}

  getChatbotsTotal = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(chatbot)
      .where(
        and(
          eq(chatbot.account_id, accountId),
          eq(chatbot.status, EChatbotStatus.active)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getChatbotsActive = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(chatbot)
      .where(
        and(
          eq(chatbot.account_id, accountId),
          eq(chatbot.status, EChatbotStatus.active)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getChatbotsAllowed = async (accountId: string): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      EPlanProduct.chatbot
    );
  };
}
