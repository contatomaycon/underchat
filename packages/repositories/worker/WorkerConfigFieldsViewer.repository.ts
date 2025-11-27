import * as schema from '@core/models';
import { workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IWorkerConfigFields } from '@core/common/interfaces/IWorkerConfigFields';

@injectable()
export class WorkerConfigFieldsViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewWorkerConfigFieldsByWorkerId = async (
    workerId: string
  ): Promise<IWorkerConfigFields | null> => {
    const result = await this.db
      .select({
        is_automatic_attendance: workerConfig.is_automatic_attendance,
        show_attendee_name: workerConfig.show_attendee_name,
        show_worker_name: workerConfig.show_worker_name,
        allow_attendance_only_online: workerConfig.allow_attendance_only_online,
        generate_protocol_at_ura: workerConfig.generate_protocol_at_ura,
        generate_protocol_at_start: workerConfig.generate_protocol_at_start,
        generate_protocol_at_transfer:
          workerConfig.generate_protocol_at_transfer,
        simultaneous_attendance: workerConfig.simultaneous_attendance,
      })
      .from(workerConfig)
      .where(eq(workerConfig.worker_id, workerId))
      .limit(1)
      .execute();

    return result[0] || null;
  };
}
