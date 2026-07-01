import * as schema from '@core/models';
import { worker, workerConfig } from '@core/models';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';

export interface ILinkedChatbotWorkerType {
  worker_id: string;
  worker_type_id: string;
}

@injectable()
export class ChatbotOfficialCompatibilityRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listActiveLinkedWorkerTypes = async (
    accountId: string,
    chatbotId: string
  ): Promise<ILinkedChatbotWorkerType[]> => {
    const rows = await this.dbRo
      .select({
        worker_id: worker.worker_id,
        worker_type_id: worker.worker_type_id,
      })
      .from(workerConfig)
      .innerJoin(worker, eq(worker.worker_id, workerConfig.worker_id))
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          eq(workerConfig.chatbot_id, chatbotId),
          eq(workerConfig.worker_config_status_id, EWorkerConfigStatus.active),
          inArray(workerConfig.worker_config_type_id, [
            EWorkerConfigType.chatbot_id,
            EWorkerConfigType.chatbot_output_id,
            EWorkerConfigType.chatbot_working_hours_rule,
          ])
        )
      )
      .execute();

    const unique = new Map<string, ILinkedChatbotWorkerType>();
    for (const row of rows) {
      unique.set(row.worker_id, row);
    }

    return Array.from(unique.values());
  };
}
