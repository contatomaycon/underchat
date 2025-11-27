import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class WorkerConfigViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerConfigByWorkerId = async (
    workerId: string
  ): Promise<typeof workerConfig.$inferSelect | null> => {
    const result = await this.db
      .select({
        worker_config_id: workerConfig.worker_config_id,
        worker_id: workerConfig.worker_id,
        is_automatic_attendance: workerConfig.is_automatic_attendance,
        show_attendee_name: workerConfig.show_attendee_name,
        show_worker_name: workerConfig.show_worker_name,
        allow_attendance_only_online: workerConfig.allow_attendance_only_online,
        simultaneous_attendance: workerConfig.simultaneous_attendance,
        generate_protocol_at_ura: workerConfig.generate_protocol_at_ura,
        generate_protocol_at_start: workerConfig.generate_protocol_at_start,
        generate_protocol_at_transfer:
          workerConfig.generate_protocol_at_transfer,
        created_at: workerConfig.created_at,
        updated_at: workerConfig.updated_at,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0] || null;
  };
}
