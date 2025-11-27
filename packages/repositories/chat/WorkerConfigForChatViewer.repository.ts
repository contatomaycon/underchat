import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';

@injectable()
export class WorkerConfigForChatViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerConfigForChatByWorkerId = async (
    workerId: string
  ): Promise<ViewWorkerConfigForChatResponse> => {
    const result = await this.db
      .select({
        show_worker_name: workerConfig.show_worker_name,
        show_attendee_name: workerConfig.show_attendee_name,
        is_automatic_attendance: workerConfig.is_automatic_attendance,
        allow_attendance_only_online: workerConfig.allow_attendance_only_online,
        simultaneous_attendance: workerConfig.simultaneous_attendance,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    if (!result || result.length === 0) {
      return null;
    }

    return result[0] as ViewWorkerConfigForChatResponse;
  };
}
